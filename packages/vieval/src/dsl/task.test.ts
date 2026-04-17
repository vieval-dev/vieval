import { describe, expect, it } from 'vitest'

import { caseOf, casesFromInputs, describeEval, describeTask } from './task'

function createTestTaskCacheRuntime() {
  return {
    namespace() {
      return {
        file() {
          return {
            async exists() {
              return false
            },
          }
        },
      }
    },
  } as any
}

function createScheduledTaskMatrix() {
  return {
    eval: {
      rubric: 'strict',
    },
    meta: {
      evalRowId: 'rubric=strict',
      runRowId: 'model=gpt-4.1-mini&scenario=baseline',
    },
    run: {
      model: 'gpt-4.1-mini',
      scenario: 'baseline',
    },
  }
}

describe('describeTask DSL', { timeout: 10000 }, () => {
  it('supports vitest-like top-level case registration', async () => {
    const taskDefinition = describeTask('dsl-top-level', () => {
      caseOf('case-1', async (task) => {
        expect(task.matrix.inputs).toEqual({ text: 'hello' })
      }, { text: 'hello' })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      model: () => ({
        aliases: [],
        id: 'openai:gpt-4.1-mini',
        model: 'gpt-4.1-mini',
        inferenceExecutor: 'openai',
        inferenceExecutorId: 'openai',
      }),
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'x',
          name: 'x',
        },
        id: 'x',
        matrix: createScheduledTaskMatrix(),
        inferenceExecutor: {
          id: 'openai:gpt-4.1-mini',
        },
      },
    })

    expect(runResult?.scores[0]?.score).toBe(1)
  })

  it('supports builder-form case registration and casesFromInputs', async () => {
    const taskDefinition = describeEval('dsl-builder', (task) => {
      task.caseOf('case-a', async (context) => {
        expect(context.matrix.inputs).toBe('a')
      }, 'a')
      task.casesFromInputs('bulk', ['b', 'c'], async (context) => {
        expect(['b', 'c']).toContain(context.matrix.inputs)
      })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      model: () => ({
        aliases: [],
        id: 'openai:gpt-4.1-mini',
        model: 'gpt-4.1-mini',
        inferenceExecutor: 'openai',
        inferenceExecutorId: 'openai',
      }),
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'x',
          name: 'x',
        },
        id: 'x',
        matrix: createScheduledTaskMatrix(),
        inferenceExecutor: {
          id: 'openai:gpt-4.1-mini',
        },
      },
    })

    expect(runResult?.scores[0]?.score).toBe(1)
  })

  it('emits reporter hooks around each case without changing the score average', async () => {
    const startPayloads: Array<{ index: number, name: string, total: number }> = []
    const endPayloads: Array<{ index: number, name: string, state: 'passed' | 'failed', total: number }> = []
    let resolveFirstCase: (() => void) | undefined

    const taskDefinition = describeTask('dsl-hooks', () => {
      caseOf('case-1', async () => {
        await new Promise<void>((resolve) => {
          resolveFirstCase = resolve
        })
      }, 'pass-later')

      caseOf('case-2', async () => {
        throw new Error('boom')
      }, 'fail-fast')
    })

    const runPromise = taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      model: () => ({
        aliases: [],
        id: 'openai:gpt-4.1-mini',
        model: 'gpt-4.1-mini',
        inferenceExecutor: 'openai',
        inferenceExecutorId: 'openai',
      }),
      reporterHooks: {
        onCaseStart(payload) {
          startPayloads.push(payload)
        },
        onCaseEnd(payload) {
          endPayloads.push(payload)
        },
      },
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'x',
          name: 'x',
        },
        id: 'task-hooks',
        matrix: createScheduledTaskMatrix(),
        inferenceExecutor: {
          id: 'openai:gpt-4.1-mini',
        },
      },
    })

    await Promise.resolve()

    expect(startPayloads).toEqual([
      { index: 0, name: 'case-1', total: 2 },
      { index: 1, name: 'case-2', total: 2 },
    ])
    expect(endPayloads).toEqual([{ index: 1, name: 'case-2', state: 'failed', total: 2 }])

    resolveFirstCase?.()

    const runResult = await runPromise

    expect(endPayloads).toEqual([
      { index: 1, name: 'case-2', state: 'failed', total: 2 },
      { index: 0, name: 'case-1', state: 'passed', total: 2 },
    ])
    expect(runResult?.scores[0]?.score).toBe(0.5)
  })

  it('exposes scoped task matrix context with run, eval, and row ids in case callbacks', async () => {
    const taskDefinition = describeTask('dsl-scoped-matrix', () => {
      caseOf('case-1', async (context) => {
        expect(context.task.matrix).toEqual(createScheduledTaskMatrix())
        expect(context.matrix).toEqual({
          ...createScheduledTaskMatrix(),
          inputs: { prompt: 'hello' },
        })
      }, { prompt: 'hello' })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      model: () => ({
        aliases: [],
        id: 'openai:gpt-4.1-mini',
        model: 'gpt-4.1-mini',
        inferenceExecutor: 'openai',
        inferenceExecutorId: 'openai',
      }),
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'x',
          name: 'x',
        },
        id: 'task-scoped-matrix',
        matrix: createScheduledTaskMatrix(),
        inferenceExecutor: {
          id: 'openai:gpt-4.1-mini',
        },
      },
    })

    expect(runResult?.scores[0]?.score).toBe(1)
  })

  it('isolates nested matrix objects between case callbacks', async () => {
    const taskDefinition = describeTask('dsl-matrix-isolation', () => {
      caseOf('case-1', (context) => {
        context.matrix.run.model = 'mutated-model'
        context.matrix.eval.rubric = 'mutated-rubric'
        context.matrix.meta.runRowId = 'mutated-row-id'
      }, 'first')

      caseOf('case-2', (context) => {
        expect(context.task.matrix).toEqual(createScheduledTaskMatrix())
        expect(context.matrix).toEqual({
          ...createScheduledTaskMatrix(),
          inputs: 'second',
        })
      }, 'second')
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      model: () => ({
        aliases: [],
        id: 'openai:gpt-4.1-mini',
        model: 'gpt-4.1-mini',
        inferenceExecutor: 'openai',
        inferenceExecutorId: 'openai',
      }),
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'x',
          name: 'x',
        },
        id: 'task-matrix-isolation',
        matrix: createScheduledTaskMatrix(),
        inferenceExecutor: {
          id: 'openai:gpt-4.1-mini',
        },
      },
    })

    expect(runResult?.scores[0]?.score).toBe(1)
  })

  it('throws when caseOf is called outside describeTask', () => {
    expect(() => caseOf('oops', async () => {}, {})).toThrow('caseOf/casesFromInputs must be called inside describeTask/describeEval.')
  })

  it('throws when casesFromInputs is called outside describeTask', () => {
    expect(() => casesFromInputs('oops', [{}], async () => {})).toThrow('caseOf/casesFromInputs must be called inside describeTask/describeEval.')
  })

  it('exposes cache runtime on task context', async () => {
    const taskDefinition = describeTask('dsl-cache-context', () => {
      caseOf('case-1', (context) => {
        expect(typeof context.cache.namespace).toBe('function')
      }, {})
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      model: () => ({
        aliases: [],
        id: 'openai:gpt-4.1-mini',
        inferenceExecutor: 'openai',
        inferenceExecutorId: 'openai',
        model: 'gpt-4.1-mini',
      }),
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'x',
          name: 'x',
        },
        id: 'x',
        inferenceExecutor: { id: 'openai:gpt-4.1-mini' },
        matrix: {
          eval: { rubric: 'strict' },
          meta: { evalRowId: 'rubric=strict', runRowId: 'model=gpt-4.1-mini' },
          run: { model: 'gpt-4.1-mini' },
        },
      },
    })

    expect(runResult?.scores[0]?.score).toBe(1)
  })
})
