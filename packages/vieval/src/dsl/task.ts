import type { TaskConcurrencyConfig, TaskExecutionPolicy, TaskReporterEventPayload, TaskRunContext, TaskRunOutput } from '../config'
import type { RunScoreKind } from '../core/runner'
import type { TelemetryAttributeValue } from '../core/telemetry'

import { errorMessageFrom, sleep } from '@moeru/std'

import { defineEval, defineTask } from '../config'
import { createSchedulerQueue } from '../core/scheduler/queue'
import { createNoopTelemetryRuntime } from '../core/telemetry'
import { registerEvalDefinition } from './registry'

/**
 * Per-case registration options for `caseOf`.
 */
export interface CaseRegistrationOptions<TInput> extends TaskExecutionPolicy {
  /**
   * Optional case input payload.
   */
  input: TInput
}

/**
 * Runtime context provided to a task case callback.
 */
export interface CaseRunContext<TInput> extends TaskRunContext {
  /**
   * Case-scoped matrix payload.
   */
  matrix: TaskRunContext['task']['matrix'] & { inputs: TInput }
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
  metric: (name: string, value: TelemetryAttributeValue) => void
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
   * Cooperative abort signal for the current case execution.
   */
  signal: AbortSignal
}

/**
 * Callback for one task case.
 */
export type CaseRunner<TInput> = (context: CaseRunContext<TInput>) => Promise<unknown> | unknown

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
  /**
   * Optional description override.
   */
  description?: string
}

interface CaseExecutionOutcome {
  errorMessage?: string
  output?: unknown
  scoresByKind: Map<RunScoreKind, number>
  state: 'failed' | 'passed' | 'timeout'
}

interface RegisteredCase<TInput> {
  concurrency?: number
  executionPolicy?: TaskExecutionPolicy
  input: TInput
  name: string
  queueKey?: object
  run: CaseRunner<TInput>
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}: ${String(value)}`)
  }
}

function assertNonNegativeNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${label}: ${String(value)}`)
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label}: ${String(value)}`)
  }
}

function assertValidScore(score: number): void {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error(`Case score must be a finite number in range 0..1, got "${score}".`)
  }
}

function autoRetryDelayMs(retryIndex: number): number {
  // Retry index 1 is the first retry after the initial case failure.
  return 500 * 2 ** (retryIndex - 1)
}

function canAttachMetricAsAttribute(value: TelemetryAttributeValue): value is boolean | number | readonly boolean[] | readonly number[] | readonly string[] | string {
  if (isTelemetryAttributeScalar(value)) {
    return true
  }

  return Array.isArray(value) && isTelemetryAttributeArray(value)
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

function createCaseTimeoutError(timeout: number): Error {
  const error = new Error(`Case timed out after ${timeout}ms.`)
  error.name = 'TimeoutError'
  return error
}

function createTaskCaseReporterId(index: number, name: string): string {
  return `${index}:${encodeURIComponent(name)}`
}

function emitCaseEnd(
  hooks: TaskRunContext['reporterHooks'] | undefined,
  payload: {
    errorMessage?: string
    index: number
    name: string
    output?: unknown
    state: 'failed' | 'passed' | 'timeout'
    total: number
  },
): void {
  try {
    hooks?.onCaseEnd?.(payload)
  }
  catch {
    // Reporter hooks must never affect task scoring.
  }
}

function emitCaseOutcome(
  context: TaskRunContext,
  taskCase: RegisteredCase<unknown>,
  outcome: CaseExecutionOutcome,
  index: number,
  totalCases: number,
): void {
  emitCaseEnd(context.reporterHooks, {
    ...(outcome.errorMessage == null ? {} : { errorMessage: outcome.errorMessage }),
    index,
    ...(outcome.output === undefined ? {} : { output: outcome.output }),
    name: taskCase.name,
    state: outcome.state,
    total: totalCases,
  })
}

function emitCaseStart(
  hooks: TaskRunContext['reporterHooks'] | undefined,
  payload: {
    autoRetry?: number
    index: number
    input?: unknown
    name: string
    retryIndex?: number
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

function emitReporterEvent(
  hooks: TaskRunContext['reporterHooks'] | undefined,
  payload: TaskReporterEventPayload,
): void {
  try {
    hooks?.onEvent?.(payload)
  }
  catch {
    // Reporter hooks must never affect task scoring.
  }
}

async function executeRegisteredCase(
  context: TaskRunContext,
  taskCase: RegisteredCase<unknown>,
  index: number,
  totalCases: number,
  taskExecutionPolicy: TaskExecutionPolicy | undefined,
): Promise<CaseExecutionOutcome> {
  const resolvedPolicy = resolveCaseExecutionPolicy(taskCase, taskExecutionPolicy)
  let lastOutcome: CaseExecutionOutcome | undefined

  for (let retryIndex = 0; retryIndex <= resolvedPolicy.autoRetry; retryIndex += 1) {
    if (retryIndex > 0) {
      const retryDelayMs = resolveAutoRetryDelay(resolvedPolicy, retryIndex)
      assertNonNegativeNumber(retryDelayMs, 'autoRetryDelay result')

      if (retryDelayMs > 0) {
        await sleep(retryDelayMs)
      }
    }

    emitCaseStart(context.reporterHooks, {
      ...(resolvedPolicy.autoRetry > 0
        ? {
            autoRetry: resolvedPolicy.autoRetry,
            retryIndex,
          }
        : {}),
      index,
      ...(taskCase.input === undefined ? {} : { input: taskCase.input }),
      name: taskCase.name,
      total: totalCases,
    })
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

function isTelemetryAttributeArray(value: readonly TelemetryAttributeValue[]): value is readonly boolean[] | readonly number[] | readonly string[] {
  return value.every(isTelemetryAttributeScalar)
}

function isTelemetryAttributeScalar(value: unknown): value is boolean | number | string {
  return typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string'
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

  if (typeof policy.autoRetryDelay === 'number') {
    assertNonNegativeNumber(policy.autoRetryDelay, `${label} autoRetryDelay`)
  }

  if (policy.timeout != null) {
    assertPositiveInteger(policy.timeout, `${label} timeout`)
  }

  const normalized = {
    autoAttempt: policy.autoAttempt,
    autoRetry: policy.autoRetry,
    autoRetryDelay: policy.autoRetryDelay,
    timeout: policy.timeout,
  }

  return Object.values(normalized).some(value => value != null)
    ? normalized
    : undefined
}

function resolveAutoRetryDelay(policy: TaskExecutionPolicy, retryIndex: number): number {
  const delay = policy.autoRetryDelay

  if (delay == null) {
    return autoRetryDelayMs(retryIndex)
  }

  return typeof delay === 'number' ? delay : delay(retryIndex)
}

function resolveCaseExecutionPolicy(
  taskCase: RegisteredCase<unknown>,
  taskExecutionPolicy: TaskExecutionPolicy | undefined,
): Pick<TaskExecutionPolicy, 'autoRetryDelay' | 'timeout'> & Required<Pick<TaskExecutionPolicy, 'autoAttempt' | 'autoRetry'>> {
  return {
    autoAttempt: taskCase.executionPolicy?.autoAttempt ?? taskExecutionPolicy?.autoAttempt ?? 0,
    autoRetry: taskCase.executionPolicy?.autoRetry ?? taskExecutionPolicy?.autoRetry ?? 0,
    autoRetryDelay: taskCase.executionPolicy?.autoRetryDelay ?? taskExecutionPolicy?.autoRetryDelay,
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
  const telemetry = context.telemetry ?? createNoopTelemetryRuntime()
  const caseId = createTaskCaseReporterId(index, taskCase.name)
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let settled = false

  try {
    return await telemetry.withSpan('vieval.case', {
      'vieval.case.id': caseId,
      'vieval.case.name': taskCase.name,
      'vieval.task.id': context.task.id,
      'vieval.task.name': context.task.entry.name,
    }, async () => {
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

          emitReporterEvent(context.reporterHooks, {
            caseId,
            data: {
              name,
              value,
            },
            event: 'task.case.metric',
          })
          telemetry.addEvent('vieval.case.metric', { name, value })
          if (canAttachMetricAsAttribute(value)) {
            telemetry.setAttributes({ [name]: value })
          }
        },
        score(score, kind = 'exact') {
          if (abortController.signal.aborted || settled) {
            return
          }

          assertValidScore(score)
          customScoresByKind.set(kind, score)
          telemetry.addEvent('vieval.case.score', {
            'vieval.score.kind': kind,
            'vieval.score.value': score,
          })
          emitReporterEvent(context.reporterHooks, {
            caseId,
            data: { kind, score },
            event: 'task.case.score',
          })
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

        const output = await Promise.race([runPromise, timeoutPromise])
        settled = true
        return {
          output,
          scoresByKind: customScoresByKind,
          state: 'passed',
        }
      }

      const output = await runPromise
      settled = true
      return {
        output,
        scoresByKind: customScoresByKind,
        state: 'passed',
      }
    })
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

let activeCasesStack: RegisteredCase<unknown>[][] = []

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
 * Defines one eval task with task/case semantics similar to Vitest.
 *
 * Use when:
 * - task behavior should be declared with `caseOf` and `casesFromInputs`
 * - business agent code should be imported and run from eval task files
 */
export function describeTask(
  name: string,
  build: (() => void) | ((builder: DescribeTaskBuilder) => void),
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
        const runtimeTaskConcurrency = context.task.entry.task?.concurrency ?? options.concurrency

        if (!hasAutoAttempt) {
          await Promise.all(
            registeredCases.map(async (taskCase, index) => {
              const executeCase = async () => {
                const outcome = await executeRegisteredCase(context, taskCase, index, totalCases, taskExecutionPolicy)
                emitCaseOutcome(context, taskCase, outcome, index, totalCases)
                collectCaseOutcomeScores(outcome, scoreBucketsByKind)
              }

              const concurrency = resolveCaseConcurrency(taskCase, runtimeTaskConcurrency, context.runtimeConcurrency)
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
          let attemptIndex = 0

          for (;;) {
            const attemptOutcomes = await Promise.all(
              registeredCases.map(async (taskCase, index) => {
                const executeCase = async () => await executeRegisteredCase(context, taskCase, index, totalCases, taskExecutionPolicy)
                const concurrency = resolveCaseConcurrency(taskCase, runtimeTaskConcurrency, context.runtimeConcurrency)
                if (concurrency == null) {
                  return await executeCase()
                }

                const queueKey = resolveCaseQueueKey(taskCase, defaultCaseQueueKey)
                const queue = caseQueues.get(queueKey) ?? createSchedulerQueue(concurrency)
                caseQueues.set(queueKey, queue)
                return await queue.run(executeCase)
              }),
            )

            attemptOutcomes.forEach((outcome, index) => {
              const taskCase = registeredCases[index]
              if (taskCase == null) {
                return
              }

              emitCaseOutcome(context, taskCase, outcome, index, totalCases)
              collectCaseOutcomeScores(outcome, scoreBucketsByKind)
            })

            const shouldContinue = attemptOutcomes.some((outcome, index) => {
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

function getActiveCases(): RegisteredCase<unknown>[] {
  const active = activeCasesStack.at(-1)
  if (active == null) {
    throw new Error('caseOf/casesFromInputs must be called inside describeTask/describeEval.')
  }

  return active
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
  runtimeConcurrency: TaskConcurrencyConfig | undefined,
): number | undefined {
  const concurrency = runtimeConcurrency?.case ?? taskCase.concurrency ?? taskConcurrency?.case
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

function withActiveCases<T>(cases: RegisteredCase<unknown>[], callback: () => T): T {
  activeCasesStack = [...activeCasesStack, cases]

  try {
    return callback()
  }
  finally {
    activeCasesStack = activeCasesStack.slice(0, -1)
  }
}

/**
 * Alias of `describeTask` for eval-centric naming.
 */
export const describeEval = describeTask
