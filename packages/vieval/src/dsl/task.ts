import type { TaskRunContext, TaskRunOutput } from '../config'

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
  caseOf: <TInput>(name: string, run: CaseRunner<TInput>, input: TInput) => void
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
  return {
    caseOf(name, run, input) {
      registeredCases.push({
        input,
        name,
        run: run as CaseRunner<unknown>,
      })
    },
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
export function caseOf<TInput>(
  name: string,
  run: CaseRunner<TInput>,
  input: TInput,
): void {
  getActiveCases().push({
    input,
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

        const caseScores: number[] = await Promise.all(
          registeredCases.map(async (taskCase, index) => {
            emitCaseStart(context.reporterHooks, {
              index,
              name: taskCase.name,
              total: totalCases,
            })

            let state: 'passed' | 'failed' = 'passed'

            try {
              await taskCase.run({
                ...context,
                matrix: {
                  ...cloneCaseMatrix(context.task.matrix),
                  inputs: taskCase.input,
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

            return state === 'passed' ? 1 : 0
          }),
        )

        const averageScore = caseScores.reduce((sum, score) => sum + score, 0) / caseScores.length

        return {
          scores: [{ kind: 'exact', score: averageScore }],
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
