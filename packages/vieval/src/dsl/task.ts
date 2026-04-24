import type { TaskConcurrencyConfig, TaskExecutionPolicy, TaskRunContext, TaskRunOutput } from '../config'
import type { RunScoreKind } from '../core/runner'

import { errorMessageFrom } from '@moeru/std'

import { defineEval, defineTask } from '../config'
import { createSchedulerQueue } from '../core/scheduler/queue'
import { registerEvalDefinition } from './registry'

/**
 * Runtime context provided to a task case callback.
 */
export interface CaseRunContext<TInput> extends TaskRunContext {
  /**
   * Case-scoped matrix payload.
   */
  matrix: TaskRunContext['task']['matrix'] & { inputs: TInput }
  /**
   * Overrides one case score family with a custom normalized value.
   *
   * Use when:
   * - one case computes a benchmark-native score that should flow into run aggregation
   *
   * Expects:
   * - `score` to stay in the `0..1` range
   */
  score: (score: number, kind?: RunScoreKind) => void
  /**
   * Emits one custom case metric into report events.
   *
   * Use when:
   * - tasks need structured benchmark metadata beyond exact/judge score families
   *
   * Expects:
   * - `name` to be a stable metric identifier
   * - `value` to be JSON-serializable
   */
  metric: (name: string, value: boolean | number | string | null) => void
  /**
   * Cooperative abort signal for the current case execution.
   */
  signal: AbortSignal
}

/**
 * Callback for one task case.
 */
export type CaseRunner<TInput> = (context: CaseRunContext<TInput>) => Promise<void> | void

interface RegisteredCase<TInput> {
  concurrency?: number
  executionPolicy?: TaskExecutionPolicy
  input: TInput
  name: string
  queueKey?: object
  run: CaseRunner<TInput>
}

/**
 * Per-group options for `casesFromInputs`.
 *
 * Use when:
 * - one generated case group should run with a lower case concurrency than the task default
 * - a task should keep a broader task-level cap while one expensive case family stays bounded
 *
 * Expects:
 * - `concurrency` to be a positive integer when provided
 *
 * Returns:
 * - one partial case-group execution descriptor
 */
export interface CasesFromInputsOptions extends TaskExecutionPolicy {
  /**
   * Case-level concurrency cap for cases registered by one `casesFromInputs(...)` call.
   */
  concurrency?: number
}

/**
 * Per-case registration options for `caseOf`.
 */
export interface CaseRegistrationOptions<TInput> extends TaskExecutionPolicy {
  /**
   * Optional case input payload.
   */
  input: TInput
}

interface CaseExecutionOutcome {
  errorMessage?: string
  scoresByKind: Map<RunScoreKind, number>
  state: 'failed' | 'passed' | 'timeout'
}

function cloneCaseMatrix(matrix: TaskRunContext['task']['matrix']): TaskRunContext['task']['matrix'] {
  return {
    eval: {
      ...matrix.eval,
    },
    meta: {
      ...matrix.meta,
    },
    run: {
      ...matrix.run,
    },
  }
}

function createTaskCaseReporterId(index: number, name: string): string {
  return `${index}:${encodeURIComponent(name)}`
}

function assertValidScore(score: number): void {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error(`Case score must be a finite number in range 0..1, got "${score}".`)
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}: ${String(value)}`)
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label}: ${String(value)}`)
  }
}

function emitCaseStart(
  hooks: TaskRunContext['reporterHooks'] | undefined,
  payload: {
    index: number
    name: string
    total: number
  },
): void {
  try {
    hooks?.onCaseStart?.(payload)
  }
  catch {
    // Reporter hooks must never affect task scoring.
  }
}

function emitCaseEnd(
  hooks: TaskRunContext['reporterHooks'] | undefined,
  payload: {
    index: number
    state: 'passed' | 'failed' | 'timeout'
    name: string
    total: number
    errorMessage?: string
  },
): void {
  try {
    hooks?.onCaseEnd?.(payload)
  }
  catch {
    // Reporter hooks must never affect task scoring.
  }
}

function createCaseTimeoutError(timeout: number): Error {
  const error = new Error(`Case timed out after ${timeout}ms.`)
  error.name = 'TimeoutError'
  return error
}

function normalizeExecutionPolicy(policy: TaskExecutionPolicy | undefined, label: string): TaskExecutionPolicy | undefined {
  if (policy == null) {
    return undefined
  }

  if (policy.autoAttempt != null) {
    assertNonNegativeInteger(policy.autoAttempt, `${label} autoAttempt`)
  }

  if (policy.autoRetry != null) {
    assertNonNegativeInteger(policy.autoRetry, `${label} autoRetry`)
  }

  if (policy.timeout != null) {
    assertPositiveInteger(policy.timeout, `${label} timeout`)
  }

  const normalized = {
    autoAttempt: policy.autoAttempt,
    autoRetry: policy.autoRetry,
    timeout: policy.timeout,
  }

  return Object.values(normalized).some(value => value != null)
    ? normalized
    : undefined
}

function resolveCaseExecutionPolicy(
  taskCase: RegisteredCase<unknown>,
  taskExecutionPolicy: TaskExecutionPolicy | undefined,
): Required<Pick<TaskExecutionPolicy, 'autoAttempt' | 'autoRetry'>> & Pick<TaskExecutionPolicy, 'timeout'> {
  return {
    autoAttempt: taskCase.executionPolicy?.autoAttempt ?? taskExecutionPolicy?.autoAttempt ?? 0,
    autoRetry: taskCase.executionPolicy?.autoRetry ?? taskExecutionPolicy?.autoRetry ?? 0,
    timeout: taskCase.executionPolicy?.timeout ?? taskExecutionPolicy?.timeout,
  }
}

async function runCaseOnce(
  context: TaskRunContext,
  taskCase: RegisteredCase<unknown>,
  index: number,
  timeout: number | undefined,
): Promise<CaseExecutionOutcome> {
  const customScoresByKind = new Map<RunScoreKind, number>()
  const abortController = new AbortController()
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let settled = false

  try {
    const runPromise = Promise.resolve(taskCase.run({
      ...context,
      matrix: {
        ...cloneCaseMatrix(context.task.matrix),
        inputs: taskCase.input,
      },
      metric(name, value) {
        if (abortController.signal.aborted || settled) {
          return
        }

        context.reporterHooks?.onEvent?.({
          caseId: createTaskCaseReporterId(index, taskCase.name),
          data: {
            name,
            value,
          },
          event: 'task.case.metric',
        })
      },
      score(score, kind = 'exact') {
        if (abortController.signal.aborted || settled) {
          return
        }

        assertValidScore(score)
        customScoresByKind.set(kind, score)
      },
      signal: abortController.signal,
    }))

    if (timeout != null) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true
          abortController.abort(createCaseTimeoutError(timeout))
          reject(createCaseTimeoutError(timeout))
        }, timeout)
      })

      await Promise.race([runPromise, timeoutPromise])
    }
    else {
      await runPromise
    }

    settled = true
    return {
      scoresByKind: customScoresByKind,
      state: 'passed',
    }
  }
  catch (error) {
    settled = true
    return {
      errorMessage: errorMessageFrom(error) ?? (timedOut && timeout != null ? `Case timed out after ${timeout}ms.` : 'Unknown case failure.'),
      scoresByKind: customScoresByKind,
      state: timedOut ? 'timeout' : 'failed',
    }
  }
  finally {
    if (timeoutHandle != null) {
      clearTimeout(timeoutHandle)
    }
  }
}

async function executeRegisteredCase(
  context: TaskRunContext,
  taskCase: RegisteredCase<unknown>,
  index: number,
  taskExecutionPolicy: TaskExecutionPolicy | undefined,
): Promise<CaseExecutionOutcome> {
  const resolvedPolicy = resolveCaseExecutionPolicy(taskCase, taskExecutionPolicy)
  let lastOutcome: CaseExecutionOutcome | undefined

  for (let retryIndex = 0; retryIndex <= resolvedPolicy.autoRetry; retryIndex += 1) {
    lastOutcome = await runCaseOnce(context, taskCase, index, resolvedPolicy.timeout)
    if (lastOutcome.state === 'passed') {
      return lastOutcome
    }
  }

  return lastOutcome ?? {
    errorMessage: 'Unknown case failure.',
    scoresByKind: new Map(),
    state: 'failed',
  }
}

function collectCaseOutcomeScores(
  outcome: CaseExecutionOutcome,
  scoreBucketsByKind: Record<RunScoreKind, number[]>,
): void {
  if (outcome.state !== 'passed') {
    scoreBucketsByKind.exact.push(0)
    return
  }

  if (outcome.scoresByKind.size === 0) {
    scoreBucketsByKind.exact.push(1)
    return
  }

  scoreBucketsByKind.exact.push(outcome.scoresByKind.get('exact') ?? 1)
  const judgeScore = outcome.scoresByKind.get('judge')
  if (judgeScore != null) {
    scoreBucketsByKind.judge.push(judgeScore)
  }
}

/**
 * Builder callbacks passed into `describeTask`.
 */
export interface DescribeTaskBuilder {
  /**
   * Registers one explicit case.
   */
  caseOf: {
    (name: string, run: CaseRunner<undefined>): void
    <TInput>(name: string, run: CaseRunner<TInput>, options: CaseRegistrationOptions<TInput>): void
  }
  /**
   * Registers multiple cases from input list.
   */
  casesFromInputs: <TInput>(
    namePrefix: string,
    inputs: readonly TInput[],
    run: CaseRunner<TInput>,
    options?: CasesFromInputsOptions,
  ) => void
}

/**
 * Options for `describeTask`.
 */
export interface DescribeTaskOptions extends TaskExecutionPolicy {
  /**
   * Optional description override.
   */
  description?: string
  /**
   * Optional task-local concurrency overrides.
   *
   * Use when:
   * - one task should cap attempt fan-out independently from the surrounding project
   * - one task should cap case fan-out without changing global scheduling defaults
   *
   * Expects:
   * - each provided value to be a positive integer
   *
   * @default inherited from project or CLI concurrency settings
   */
  concurrency?: TaskConcurrencyConfig
}

function createCaseBuilder(registeredCases: RegisteredCase<unknown>[]): DescribeTaskBuilder {
  function registerCase(name: string, run: CaseRunner<undefined>): void
  function registerCase<TInput>(name: string, run: CaseRunner<TInput>, options: CaseRegistrationOptions<TInput>): void
  function registerCase<TInput>(
    name: string,
    run: CaseRunner<TInput> | CaseRunner<undefined>,
    options?: CaseRegistrationOptions<TInput>,
  ): void {
    registeredCases.push({
      executionPolicy: normalizeExecutionPolicy(options, 'task case'),
      input: options?.input,
      name,
      run: run as CaseRunner<unknown>,
    })
  }

  return {
    caseOf: registerCase,
    casesFromInputs(namePrefix, inputs, run, options) {
      const queueKey = options?.concurrency == null ? undefined : {}

      inputs.forEach((input, index) => {
        registeredCases.push({
          concurrency: options?.concurrency,
          executionPolicy: normalizeExecutionPolicy(options, 'casesFromInputs'),
          input,
          name: `${namePrefix} #${index + 1}`,
          queueKey,
          run: run as CaseRunner<unknown>,
        })
      })
    },
  }
}

let activeCasesStack: RegisteredCase<unknown>[][] = []

function withActiveCases<T>(cases: RegisteredCase<unknown>[], callback: () => T): T {
  activeCasesStack = [...activeCasesStack, cases]

  try {
    return callback()
  }
  finally {
    activeCasesStack = activeCasesStack.slice(0, -1)
  }
}

function getActiveCases(): RegisteredCase<unknown>[] {
  const active = activeCasesStack.at(-1)
  if (active == null) {
    throw new Error('caseOf/casesFromInputs must be called inside describeTask/describeEval.')
  }

  return active
}

/**
 * Registers one case in the currently active task scope.
 */
export function caseOf(
  name: string,
  run: CaseRunner<undefined>,
): void

export function caseOf<TInput>(
  name: string,
  run: CaseRunner<TInput>,
  options: CaseRegistrationOptions<TInput>,
): void

export function caseOf<TInput>(
  name: string,
  run: CaseRunner<TInput> | CaseRunner<undefined>,
  options?: CaseRegistrationOptions<TInput>,
): void {
  getActiveCases().push({
    executionPolicy: normalizeExecutionPolicy(options, 'task case'),
    input: options?.input,
    name,
    run: run as CaseRunner<unknown>,
  })
}

/**
 * Registers multiple cases in the currently active task scope.
 */
export function casesFromInputs<TInput>(
  namePrefix: string,
  inputs: readonly TInput[],
  run: CaseRunner<TInput>,
  options?: CasesFromInputsOptions,
): void {
  const queueKey = options?.concurrency == null ? undefined : {}

  inputs.forEach((input, index) => {
    getActiveCases().push({
      concurrency: options?.concurrency,
      executionPolicy: normalizeExecutionPolicy(options, 'casesFromInputs'),
      input,
      name: `${namePrefix} #${index + 1}`,
      queueKey,
      run: run as CaseRunner<unknown>,
    })
  })
}

/**
 * Resolves the effective case concurrency for one registered task case.
 *
 * Before:
 * - registered case override `2`, task default `4`
 * - registered case override `undefined`, task default `3`
 *
 * After:
 * - `2`
 * - `3`
 */
function resolveCaseConcurrency(
  taskCase: RegisteredCase<unknown>,
  taskConcurrency: TaskConcurrencyConfig | undefined,
): number | undefined {
  const concurrency = taskCase.concurrency ?? taskConcurrency?.case
  if (concurrency == null) {
    return undefined
  }

  if (!Number.isFinite(concurrency) || !Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error(`Invalid task case concurrency: ${String(concurrency)}`)
  }

  return concurrency
}

function resolveCaseQueueKey(taskCase: RegisteredCase<unknown>, defaultQueueKey: object): object {
  return taskCase.queueKey ?? defaultQueueKey
}

/**
 * Defines one eval task with task/case semantics similar to Vitest.
 *
 * Use when:
 * - task behavior should be declared with `caseOf` and `casesFromInputs`
 * - business agent code should be imported and run from eval task files
 */
export function describeTask(
  name: string,
  build: ((builder: DescribeTaskBuilder) => void) | (() => void),
  options: DescribeTaskOptions = {},
) {
  const registeredCases: RegisteredCase<unknown>[] = []
  const builder = createCaseBuilder(registeredCases)
  withActiveCases(registeredCases, () => {
    if (build.length > 0) {
      (build as (builder: DescribeTaskBuilder) => void)(builder)
      return
    }

    ;(build as () => void)()
  })

  const description = options.description ?? name
  const taskExecutionPolicy = normalizeExecutionPolicy(options, 'describeTask')

  const definition = defineEval({
    description,
    name,
    task: defineTask({
      concurrency: options.concurrency,
      executionPolicy: taskExecutionPolicy,
      id: name,
      async run(context): Promise<TaskRunOutput> {
        if (registeredCases.length === 0) {
          return {
            scores: [{ kind: 'exact', score: 1 }],
          }
        }

        const totalCases = registeredCases.length
        const scoreBucketsByKind: Record<RunScoreKind, number[]> = {
          exact: [],
          judge: [],
        }
        const defaultCaseQueueKey = {}
        const caseQueues = new Map<object, ReturnType<typeof createSchedulerQueue>>()
        const hasAutoAttempt = registeredCases.some(taskCase => resolveCaseExecutionPolicy(taskCase, taskExecutionPolicy).autoAttempt > 0)

        if (!hasAutoAttempt) {
          await Promise.all(
            registeredCases.map(async (taskCase, index) => {
              emitCaseStart(context.reporterHooks, {
                index,
                name: taskCase.name,
                total: totalCases,
              })

              const executeCase = async () => {
                const outcome = await executeRegisteredCase(context, taskCase, index, taskExecutionPolicy)
                emitCaseEnd(context.reporterHooks, {
                  ...(outcome.errorMessage == null ? {} : { errorMessage: outcome.errorMessage }),
                  index,
                  state: outcome.state,
                  name: taskCase.name,
                  total: totalCases,
                })
                collectCaseOutcomeScores(outcome, scoreBucketsByKind)
              }

              const concurrency = resolveCaseConcurrency(taskCase, options.concurrency)
              if (concurrency == null) {
                await executeCase()
                return
              }

              const queueKey = resolveCaseQueueKey(taskCase, defaultCaseQueueKey)
              const queue = caseQueues.get(queueKey) ?? createSchedulerQueue(concurrency)
              caseQueues.set(queueKey, queue)
              await queue.run(executeCase)
            }),
          )
        }
        else {
          registeredCases.forEach((taskCase, index) => {
            emitCaseStart(context.reporterHooks, {
              index,
              name: taskCase.name,
              total: totalCases,
            })
          })

          let finalOutcomes: CaseExecutionOutcome[] = []
          let attemptIndex = 0

          for (;;) {
            finalOutcomes = await Promise.all(
              registeredCases.map(async (taskCase, index) => {
                const executeCase = async () => await executeRegisteredCase(context, taskCase, index, taskExecutionPolicy)
                const concurrency = resolveCaseConcurrency(taskCase, options.concurrency)
                if (concurrency == null) {
                  return await executeCase()
                }

                const queueKey = resolveCaseQueueKey(taskCase, defaultCaseQueueKey)
                const queue = caseQueues.get(queueKey) ?? createSchedulerQueue(concurrency)
                caseQueues.set(queueKey, queue)
                return await queue.run(executeCase)
              }),
            )

            const shouldContinue = finalOutcomes.some((outcome, index) => {
              if (outcome.state === 'passed') {
                return false
              }

              const taskCase = registeredCases[index]
              if (taskCase == null) {
                return false
              }

              return attemptIndex < resolveCaseExecutionPolicy(taskCase, taskExecutionPolicy).autoAttempt
            })

            if (!shouldContinue) {
              break
            }

            attemptIndex += 1
          }

          finalOutcomes.forEach((outcome, index) => {
            const taskCase = registeredCases[index]
            if (taskCase == null) {
              return
            }

            emitCaseEnd(context.reporterHooks, {
              ...(outcome.errorMessage == null ? {} : { errorMessage: outcome.errorMessage }),
              index,
              state: outcome.state,
              name: taskCase.name,
              total: totalCases,
            })
            collectCaseOutcomeScores(outcome, scoreBucketsByKind)
          })
        }

        const scores = (Object.keys(scoreBucketsByKind) as RunScoreKind[])
          .filter(kind => scoreBucketsByKind[kind].length > 0)
          .map((kind) => {
            const values = scoreBucketsByKind[kind]
            const total = values.reduce((sum, value) => sum + value, 0)
            return {
              kind,
              score: total / values.length,
            }
          })

        return {
          scores,
        }
      },
    }),
  })

  registerEvalDefinition(definition)

  return definition
}

/**
 * Alias of `describeTask` for eval-centric naming.
 */
export const describeEval = describeTask
