import type { TaskRunContext, TaskRunOutput } from '../config'
import type { RunScoreKind } from '../core/runner'

import { defineEval, defineTask } from '../config'
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
}

/**
 * Callback for one task case.
 */
export type CaseRunner<TInput> = (context: CaseRunContext<TInput>) => Promise<void> | void

interface RegisteredCase<TInput> {
  input: TInput
  name: string
  run: CaseRunner<TInput>
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
    state: 'passed' | 'failed'
    name: string
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

/**
 * Builder callbacks passed into `describeTask`.
 */
export interface DescribeTaskBuilder {
  /**
   * Registers one explicit case.
   */
  caseOf: {
    (name: string, run: CaseRunner<undefined>): void
    <TInput>(name: string, run: CaseRunner<TInput>, options: { input: TInput }): void
  }
  /**
   * Registers multiple cases from input list.
   */
  casesFromInputs: <TInput>(
    namePrefix: string,
    inputs: readonly TInput[],
    run: CaseRunner<TInput>,
  ) => void
}

/**
 * Options for `describeTask`.
 */
export interface DescribeTaskOptions {
  /**
   * Optional description override.
   */
  description?: string
}

function createCaseBuilder(registeredCases: RegisteredCase<unknown>[]): DescribeTaskBuilder {
  function registerCase(name: string, run: CaseRunner<undefined>): void
  function registerCase<TInput>(name: string, run: CaseRunner<TInput>, options: { input: TInput }): void
  function registerCase<TInput>(
    name: string,
    run: CaseRunner<TInput> | CaseRunner<undefined>,
    options?: { input: TInput },
  ): void {
    registeredCases.push({
      input: options?.input,
      name,
      run: run as CaseRunner<unknown>,
    })
  }

  return {
    caseOf: registerCase,
    casesFromInputs(namePrefix, inputs, run) {
      inputs.forEach((input, index) => {
        registeredCases.push({
          input,
          name: `${namePrefix} #${index + 1}`,
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
  options: { input: TInput },
): void

export function caseOf<TInput>(
  name: string,
  run: CaseRunner<TInput> | CaseRunner<undefined>,
  options?: { input: TInput },
): void {
  getActiveCases().push({
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
): void {
  inputs.forEach((input, index) => {
    getActiveCases().push({
      input,
      name: `${namePrefix} #${index + 1}`,
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

  const definition = defineEval({
    description,
    name,
    task: defineTask({
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

        await Promise.all(
          registeredCases.map(async (taskCase, index) => {
            emitCaseStart(context.reporterHooks, {
              index,
              name: taskCase.name,
              total: totalCases,
            })

            let state: 'passed' | 'failed' = 'passed'
            const caseId = createTaskCaseReporterId(index, taskCase.name)
            const customScoresByKind = new Map<RunScoreKind, number>()

            try {
              await taskCase.run({
                ...context,
                matrix: {
                  ...cloneCaseMatrix(context.task.matrix),
                  inputs: taskCase.input,
                },
                metric(name, value) {
                  context.reporterHooks?.onEvent?.({
                    caseId,
                    data: {
                      name,
                      value,
                    },
                    event: 'task.case.metric',
                  })
                },
                score(score, kind = 'exact') {
                  assertValidScore(score)
                  customScoresByKind.set(kind, score)
                },
              })
            }
            catch {
              state = 'failed'
            }
            finally {
              emitCaseEnd(context.reporterHooks, {
                index,
                state,
                name: taskCase.name,
                total: totalCases,
              })
            }

            if (state === 'failed') {
              scoreBucketsByKind.exact.push(0)
              return
            }

            if (customScoresByKind.size === 0) {
              scoreBucketsByKind.exact.push(1)
              return
            }

            scoreBucketsByKind.exact.push(customScoresByKind.get('exact') ?? 1)
            const judgeScore = customScoresByKind.get('judge')
            if (judgeScore != null) {
              scoreBucketsByKind.judge.push(judgeScore)
            }
          }),
        )

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
