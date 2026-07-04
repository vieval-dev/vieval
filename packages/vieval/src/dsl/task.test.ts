import type { TelemetryAttributes, TelemetryRuntime } from '../core/telemetry'

import { errorMessageFrom } from '@moeru/std'
import { describe, expect, it, vi } from 'vitest'

import { caseOf, casesFromInputs, describeEval, describeTask } from './task'

function createDeferredPromise() {
  let resolve!: () => void
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve
  })

  return {
    promise,
    resolve,
  }
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

function createTestModels() {
  return [{
    aliases: [],
    id: 'openai:gpt-4.1-mini',
    inferenceExecutor: 'openai',
    inferenceExecutorId: 'openai',
    model: 'gpt-4.1-mini',
  }]
}

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

async function waitForExpectation(assertion: () => void, attempts = 20): Promise<void> {
  let lastError: unknown

  for (let index = 0; index < attempts; index += 1) {
    try {
      assertion()
      return
    }
    catch (error) {
      lastError = error
      await Promise.resolve()
    }
  }

  throw lastError
}

describe('describeTask DSL', { timeout: 10000 }, () => {
  it('supports vitest-like top-level case registration', async () => {
    const taskDefinition = describeTask('dsl-top-level', () => {
      caseOf('case-1', async (task) => {
        expect(task.matrix.inputs).toEqual({ text: 'hello' })
      }, { input: { text: 'hello' } })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'x',
          name: 'x',
        },
        id: 'x',
        inferenceExecutor: {
          id: 'openai:gpt-4.1-mini',
        },
        matrix: createScheduledTaskMatrix(),
      },
    })

    expect(runResult?.scores[0]?.score).toBe(1)
  })

  it('supports builder-form case registration and casesFromInputs', async () => {
    const taskDefinition = describeEval('dsl-builder', (task) => {
      task.caseOf('case-a', async (context) => {
        expect(context.matrix.inputs).toBe('a')
      }, { input: 'a' })
      task.casesFromInputs('bulk', ['b', 'c'], async (context) => {
        expect(['b', 'c']).toContain(context.matrix.inputs)
      })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'x',
          name: 'x',
        },
        id: 'x',
        inferenceExecutor: {
          id: 'openai:gpt-4.1-mini',
        },
        matrix: createScheduledTaskMatrix(),
      },
    })

    expect(runResult?.scores[0]?.score).toBe(1)
  })

  it('emits reporter hooks around each case without changing the score average', async () => {
    const startPayloads: Array<{ index: number, name: string, total: number }> = []
    const endPayloads: Array<{ index: number, name: string, state: 'failed' | 'passed' | 'timeout', total: number }> = []
    let resolveFirstCase: (() => void) | undefined

    const taskDefinition = describeTask('dsl-hooks', () => {
      caseOf('case-1', async () => {
        await new Promise<void>((resolve) => {
          resolveFirstCase = resolve
        })
      }, { input: 'pass-later' })

      caseOf('case-2', async () => {
        throw new Error('boom')
      }, { input: 'fail-fast' })
    })

    const runPromise = taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
      reporterHooks: {
        onCaseEnd(payload) {
          endPayloads.push(payload)
        },
        onCaseStart(payload) {
          startPayloads.push(payload)
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
        inferenceExecutor: {
          id: 'openai:gpt-4.1-mini',
        },
        matrix: createScheduledTaskMatrix(),
      },
    })

    await waitForExpectation(() => {
      expect(endPayloads).toEqual([{ errorMessage: 'boom', index: 1, name: 'case-2', state: 'failed', total: 2 }])
    })

    expect(startPayloads).toEqual([
      { index: 0, input: 'pass-later', name: 'case-1', total: 2 },
      { index: 1, input: 'fail-fast', name: 'case-2', total: 2 },
    ])

    resolveFirstCase?.()

    const runResult = await runPromise

    expect(endPayloads).toEqual([
      { errorMessage: 'boom', index: 1, name: 'case-2', state: 'failed', total: 2 },
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
      }, { input: { prompt: 'hello' } })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'x',
          name: 'x',
        },
        id: 'task-scoped-matrix',
        inferenceExecutor: {
          id: 'openai:gpt-4.1-mini',
        },
        matrix: createScheduledTaskMatrix(),
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
      }, { input: 'first' })

      caseOf('case-2', (context) => {
        expect(context.task.matrix).toEqual(createScheduledTaskMatrix())
        expect(context.matrix).toEqual({
          ...createScheduledTaskMatrix(),
          inputs: 'second',
        })
      }, { input: 'second' })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'x',
          name: 'x',
        },
        id: 'task-matrix-isolation',
        inferenceExecutor: {
          id: 'openai:gpt-4.1-mini',
        },
        matrix: createScheduledTaskMatrix(),
      },
    })

    expect(runResult?.scores[0]?.score).toBe(1)
  })

  it('throws when caseOf is called outside describeTask', () => {
    expect(() => caseOf('oops', async () => {})).toThrow('caseOf/casesFromInputs must be called inside describeTask/describeEval.')
  })

  it('throws when casesFromInputs is called outside describeTask', () => {
    expect(() => casesFromInputs('oops', [{}], async () => {})).toThrow('caseOf/casesFromInputs must be called inside describeTask/describeEval.')
  })

  it('exposes cache runtime on task context', async () => {
    const taskDefinition = describeTask('dsl-cache-context', () => {
      caseOf('case-1', (context) => {
        expect(typeof context.cache.namespace).toBe('function')
      }, { input: {} })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
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

  it('supports custom exact/judge scores while keeping describeTask case semantics', async () => {
    const taskDefinition = describeTask('dsl-custom-scores', () => {
      caseOf('case-1', (context) => {
        context.score(0.8)
        context.score(0.6, 'judge')
      }, { input: {} })

      caseOf('case-2', (context) => {
        context.score(0.2)
        context.score(0.4, 'judge')
      }, { input: {} })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
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

    expect(runResult?.scores).toEqual([
      { kind: 'exact', score: 0.5 },
      { kind: 'judge', score: 0.5 },
    ])
  })

  it('emits task.case.metric events from case contexts', async () => {
    const events: Array<{ caseId?: string, data?: unknown, event: string }> = []

    const taskDefinition = describeTask('dsl-case-metrics', () => {
      caseOf('case-1', (context) => {
        context.metric('overallAverageScore', 0.77)
      }, { input: {} })
    })

    await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
      reporterHooks: {
        onEvent(payload) {
          events.push(payload)
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
        id: 'x',
        inferenceExecutor: { id: 'openai:gpt-4.1-mini' },
        matrix: {
          eval: { rubric: 'strict' },
          meta: { evalRowId: 'rubric=strict', runRowId: 'model=gpt-4.1-mini' },
          run: { model: 'gpt-4.1-mini' },
        },
      },
    })

    expect(events).toEqual([
      {
        caseId: '0:case-1',
        data: {
          name: 'overallAverageScore',
          value: 0.77,
        },
        event: 'task.case.metric',
      },
    ])
  })

  it('isolates reporter event hook failures from case score and metric calls', async () => {
    const onEvent = vi.fn(() => {
      throw new Error('reporter unavailable')
    })

    const taskDefinition = describeTask('dsl-reporter-event-isolation', () => {
      caseOf('case-1', (context) => {
        context.score(0.42)
        context.metric('customMetric', 0.9)
      }, { input: {} })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
      reporterHooks: {
        onEvent,
      },
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
        matrix: createScheduledTaskMatrix(),
      },
    })

    expect(onEvent).toHaveBeenCalledTimes(2)
    expect(runResult?.scores).toEqual([{ kind: 'exact', score: 0.42 }])
  })

  /**
   * @example
   * it('emits score and metric events inside a case span') verifies the case context drives both artifacts and telemetry.
   */
  it('emits score and metric events inside a case span', async () => {
    const reporterEvents: Array<{ caseId?: string, data?: unknown, event: string }> = []
    const spanCalls: Array<{ attributes: TelemetryAttributes, name: string }> = []
    const telemetry: TelemetryRuntime = {
      addEvent: vi.fn(),
      recordException: vi.fn(),
      setAttributes: vi.fn(),
      async withSpan<T>(name: string, attributes: TelemetryAttributes, callback: () => Promise<T>) {
        spanCalls.push({ attributes, name })
        return await callback()
      },
    }

    const taskDefinition = describeTask('dsl-case-telemetry', () => {
      caseOf('case-1', (context) => {
        context.score(0.75, 'exact')
        context.metric('benchmark.id', 'locomo')
        context.metric('benchmark.tags', ['retrieval', 'qa'])
      }, { input: {} })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
      reporterHooks: {
        onEvent(payload) {
          reporterEvents.push(payload)
        },
      },
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'entry-1',
          name: 'entry-1',
        },
        id: 'task-telemetry',
        inferenceExecutor: { id: 'openai:gpt-4.1-mini' },
        matrix: createScheduledTaskMatrix(),
      },
      telemetry,
    })

    expect(runResult?.scores).toEqual([{ kind: 'exact', score: 0.75 }])
    expect(spanCalls).toEqual([{
      attributes: {
        'vieval.case.id': '0:case-1',
        'vieval.case.name': 'case-1',
        'vieval.task.id': 'task-telemetry',
        'vieval.task.name': 'entry-1',
      },
      name: 'vieval.case',
    }])
    expect(reporterEvents).toContainEqual({
      caseId: '0:case-1',
      data: {
        kind: 'exact',
        score: 0.75,
      },
      event: 'task.case.score',
    })
    expect(reporterEvents).toContainEqual({
      caseId: '0:case-1',
      data: {
        name: 'benchmark.id',
        value: 'locomo',
      },
      event: 'task.case.metric',
    })
    expect(telemetry.addEvent).toHaveBeenCalledWith('vieval.case.score', {
      'vieval.score.kind': 'exact',
      'vieval.score.value': 0.75,
    })
    expect(telemetry.addEvent).toHaveBeenCalledWith('vieval.case.metric', {
      name: 'benchmark.id',
      value: 'locomo',
    })
    expect(telemetry.setAttributes).toHaveBeenCalledWith({ 'benchmark.id': 'locomo' })
    expect(telemetry.setAttributes).toHaveBeenCalledWith({ 'benchmark.tags': ['retrieval', 'qa'] })
  })

  it('lets telemetry spans observe case failures before returning failed outcomes', async () => {
    const rejectedErrors: unknown[] = []
    const telemetry: TelemetryRuntime = {
      addEvent: vi.fn(),
      recordException: vi.fn(),
      setAttributes: vi.fn(),
      async withSpan<T>(_name: string, _attributes: TelemetryAttributes, callback: () => Promise<T>) {
        try {
          return await callback()
        }
        catch (error) {
          rejectedErrors.push(error)
          throw error
        }
      },
    }

    const taskDefinition = describeTask('dsl-case-telemetry-failure', () => {
      caseOf('case-1', () => {
        throw new Error('case exploded')
      }, { input: {} })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'x',
          name: 'x',
        },
        id: 'task-telemetry-failure',
        inferenceExecutor: { id: 'openai:gpt-4.1-mini' },
        matrix: createScheduledTaskMatrix(),
      },
      telemetry,
    })

    expect(rejectedErrors).toHaveLength(1)
    expect(errorMessageFrom(rejectedErrors[0])).toBe('case exploded')
    expect(runResult?.scores).toEqual([{ kind: 'exact', score: 0 }])
  })

  it('supports caseOf without input by exposing undefined inputs in context', async () => {
    const taskDefinition = describeTask('dsl-no-input', () => {
      caseOf('case-1', (context) => {
        expect(context.matrix.inputs).toBeUndefined()
      })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
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

  it('preserves task-local concurrency metadata on the produced task definition', () => {
    const taskDefinition = describeTask('dsl-task-concurrency', () => {
      caseOf('case-1', () => {})
    }, {
      concurrency: {
        attempt: 2,
        case: 3,
      },
    })

    expect(taskDefinition.task?.concurrency).toEqual({
      attempt: 2,
      case: 3,
    })
  })

  it('limits casesFromInputs execution to the configured per-group case concurrency override', async () => {
    const startedInputs: number[] = []
    const startPayloads: Array<{ index: number, name: string, total: number }> = []
    const pendingCases = new Map<number, ReturnType<typeof createDeferredPromise>>()

    const taskDefinition = describeTask('dsl-cases-from-inputs-concurrency-override', (task) => {
      task.casesFromInputs(
        'sample',
        [1, 2, 3, 4],
        async (context) => {
          const release = createDeferredPromise()
          const input = context.matrix.inputs

          startedInputs.push(input)
          pendingCases.set(input, release)

          await release.promise
        },
        { concurrency: 2 },
      )
    }, {
      concurrency: {
        case: 4,
      },
    })

    const runPromise = taskDefinition.task!.run({
      cache: createTestTaskCacheRuntime(),
      models: [],
      reporterHooks: {
        onCaseStart(payload) {
          startPayloads.push(payload)
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
        id: 'x',
        inferenceExecutor: { id: 'openai:gpt-4.1-mini' },
        matrix: createScheduledTaskMatrix(),
      },
    })

    await waitForExpectation(() => {
      expect(startedInputs).toEqual([1, 2])
    })

    await Promise.resolve()
    expect(startedInputs).toEqual([1, 2])
    expect(startPayloads.map(payload => payload.index)).toEqual([0, 1])

    pendingCases.get(1)?.resolve()

    await waitForExpectation(() => {
      expect(startedInputs).toEqual([1, 2, 3])
    })
    expect(startPayloads.map(payload => payload.index)).toEqual([0, 1, 2])

    pendingCases.get(2)?.resolve()

    await waitForExpectation(() => {
      expect(startedInputs).toEqual([1, 2, 3, 4])
    })

    pendingCases.get(3)?.resolve()
    pendingCases.get(4)?.resolve()

    await runPromise
  })

  it('uses task-level case concurrency when casesFromInputs does not override it', async () => {
    const startedInputs: number[] = []
    const pendingCases = new Map<number, ReturnType<typeof createDeferredPromise>>()

    const taskDefinition = describeTask('dsl-task-case-concurrency-runtime', (task) => {
      task.casesFromInputs('sample', [1, 2, 3], async (context) => {
        const release = createDeferredPromise()
        const input = context.matrix.inputs

        startedInputs.push(input)
        pendingCases.set(input, release)

        await release.promise
      })
    }, {
      concurrency: {
        case: 2,
      },
    })

    const runPromise = taskDefinition.task!.run({
      cache: createTestTaskCacheRuntime(),
      models: [],
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
        matrix: createScheduledTaskMatrix(),
      },
    })

    await waitForExpectation(() => {
      expect(startedInputs).toEqual([1, 2])
    })

    await Promise.resolve()
    expect(startedInputs).toEqual([1, 2])

    pendingCases.get(1)?.resolve()

    await waitForExpectation(() => {
      expect(startedInputs).toEqual([1, 2, 3])
    })

    pendingCases.get(2)?.resolve()
    pendingCases.get(3)?.resolve()

    await runPromise
  })

  it('isolates casesFromInputs groups that share the same numeric concurrency override', async () => {
    const startedCases: string[] = []
    const pendingCases = new Map<string, ReturnType<typeof createDeferredPromise>>()

    const taskDefinition = describeTask('dsl-cases-from-inputs-isolated-groups', (task) => {
      task.casesFromInputs('alpha', [1, 2], async (context) => {
        const release = createDeferredPromise()
        const caseName = `alpha-${context.matrix.inputs}`

        startedCases.push(caseName)
        pendingCases.set(caseName, release)

        await release.promise
      }, { concurrency: 1 })

      task.casesFromInputs('beta', [1, 2], async (context) => {
        const release = createDeferredPromise()
        const caseName = `beta-${context.matrix.inputs}`

        startedCases.push(caseName)
        pendingCases.set(caseName, release)

        await release.promise
      }, { concurrency: 1 })
    }, {
      concurrency: {
        case: 3,
      },
    })

    const runPromise = taskDefinition.task!.run({
      cache: createTestTaskCacheRuntime(),
      models: [],
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
        matrix: createScheduledTaskMatrix(),
      },
    })

    await waitForExpectation(() => {
      expect(startedCases).toHaveLength(2)
      expect(startedCases).toContain('alpha-1')
      expect(startedCases).toContain('beta-1')
    })

    await Promise.resolve()
    expect(startedCases).toHaveLength(2)

    pendingCases.get('alpha-1')?.resolve()
    pendingCases.get('beta-1')?.resolve()

    await waitForExpectation(() => {
      expect(startedCases).toHaveLength(4)
      expect(startedCases).toContain('alpha-2')
      expect(startedCases).toContain('beta-2')
    })

    pendingCases.get('alpha-2')?.resolve()
    pendingCases.get('beta-2')?.resolve()

    await runPromise
  })

  it('emits a distinct timeout state when a case exceeds the configured timeout', async () => {
    const endPayloads: Array<{ errorMessage?: string, index: number, name: string, state: 'failed' | 'passed' | 'timeout', total: number }> = []

    const taskDefinition = describeTask('dsl-case-timeout', () => {
      caseOf('slow-case', async () => {
        await new Promise<void>(() => {})
      }, {
        input: 'slow',
        timeout: 5,
      })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
      reporterHooks: {
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
        id: 'task-timeout',
        inferenceExecutor: {
          id: 'openai:gpt-4.1-mini',
        },
        matrix: createScheduledTaskMatrix(),
      },
    })

    expect(endPayloads).toEqual([
      {
        errorMessage: 'Case timed out after 5ms.',
        index: 0,
        name: 'slow-case',
        state: 'timeout',
        total: 1,
      },
    ])
    expect(runResult?.scores[0]?.score).toBe(0)
  })

  it('retries a failing case within the same task attempt until it passes', async () => {
    let runs = 0
    const startPayloads: Array<{ autoRetry?: number, index: number, name: string, retryIndex?: number, total: number }> = []

    const taskDefinition = describeTask('dsl-case-auto-retry', () => {
      caseOf('retry-case', async () => {
        runs += 1
        if (runs < 3) {
          throw new Error(`retry-${runs}`)
        }
      }, {
        autoRetry: 2,
        input: 'retry',
      })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
      reporterHooks: {
        onCaseStart(payload) {
          startPayloads.push(payload)
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
        id: 'task-retry',
        inferenceExecutor: {
          id: 'openai:gpt-4.1-mini',
        },
        matrix: createScheduledTaskMatrix(),
      },
    })

    expect(runs).toBe(3)
    expect(startPayloads.map(payload => ({
      autoRetry: payload.autoRetry,
      retryIndex: payload.retryIndex,
    }))).toEqual([
      { autoRetry: 2, retryIndex: 0 },
      { autoRetry: 2, retryIndex: 1 },
      { autoRetry: 2, retryIndex: 2 },
    ])
    expect(runResult?.scores[0]?.score).toBe(1)
  })

  /**
   * it('backs off exponentially between case auto retries') verifies case-level retry pacing.
   *
   * @example
   * autoRetry: 2 -> first retry waits 500ms, second retry waits 1000ms.
   */
  it('backs off exponentially between case auto retries', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    try {
      let runs = 0
      const startedAt: number[] = []

      const taskDefinition = describeTask('dsl-case-auto-retry-backoff', () => {
        caseOf('retry-case', async () => {
          runs += 1
          startedAt.push(Date.now())

          if (runs < 3) {
            throw new Error(`retry-${runs}`)
          }
        }, {
          autoRetry: 2,
          input: 'retry',
        })
      })

      const runPromise = taskDefinition.task!.run({
        cache: createTestTaskCacheRuntime(),
        models: createTestModels(),
        task: {
          entry: {
            description: 'd',
            directory: 'x',
            filePath: '/tmp/x.eval.ts',
            id: 'x',
            name: 'x',
          },
          id: 'task-retry-backoff',
          inferenceExecutor: {
            id: 'openai:gpt-4.1-mini',
          },
          matrix: createScheduledTaskMatrix(),
        },
      })

      await Promise.resolve()

      expect(runs).toBe(1)
      expect(startedAt).toEqual([0])

      await vi.advanceTimersByTimeAsync(499)

      expect(runs).toBe(1)
      expect(startedAt).toEqual([0])

      await vi.advanceTimersByTimeAsync(1)

      expect(runs).toBe(2)
      expect(startedAt).toEqual([0, 500])

      await vi.advanceTimersByTimeAsync(999)

      expect(runs).toBe(2)
      expect(startedAt).toEqual([0, 500])

      await vi.advanceTimersByTimeAsync(1)
      const runResult = await runPromise

      expect(runs).toBe(3)
      expect(startedAt).toEqual([0, 500, 1500])
      expect(runResult.scores[0]?.score).toBe(1)
    }
    finally {
      vi.useRealTimers()
    }
  })

  /**
   * it('uses a custom case auto retry delay function') verifies per-case retry pacing configuration.
   *
   * @example
   * autoRetryDelay: retryIndex => retryIndex * 100.
   */
  it('uses a custom case auto retry delay function', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    try {
      let runs = 0
      const retryDelayIndexes: number[] = []
      const startedAt: number[] = []

      const taskDefinition = describeTask('dsl-case-custom-auto-retry-delay', () => {
        caseOf('retry-case', async () => {
          runs += 1
          startedAt.push(Date.now())

          if (runs < 3) {
            throw new Error(`retry-${runs}`)
          }
        }, {
          autoRetry: 2,
          autoRetryDelay: (retryIndex) => {
            retryDelayIndexes.push(retryIndex)
            return retryIndex * 100
          },
          input: 'retry',
        })
      })

      const runPromise = taskDefinition.task!.run({
        cache: createTestTaskCacheRuntime(),
        models: createTestModels(),
        task: {
          entry: {
            description: 'd',
            directory: 'x',
            filePath: '/tmp/x.eval.ts',
            id: 'x',
            name: 'x',
          },
          id: 'task-custom-retry-delay',
          inferenceExecutor: {
            id: 'openai:gpt-4.1-mini',
          },
          matrix: createScheduledTaskMatrix(),
        },
      })

      await Promise.resolve()

      expect(startedAt).toEqual([0])

      await vi.advanceTimersByTimeAsync(99)

      expect(startedAt).toEqual([0])

      await vi.advanceTimersByTimeAsync(1)

      expect(startedAt).toEqual([0, 100])

      await vi.advanceTimersByTimeAsync(199)

      expect(startedAt).toEqual([0, 100])

      await vi.advanceTimersByTimeAsync(1)
      const runResult = await runPromise

      expect(retryDelayIndexes).toEqual([1, 2])
      expect(startedAt).toEqual([0, 100, 300])
      expect(runResult.scores[0]?.score).toBe(1)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('starts the next auto attempt only after the current task attempt fully settles', async () => {
    const releasesByAttempt = new Map<string, ReturnType<typeof createDeferredPromise>>()
    const started: string[] = []

    const taskDefinition = describeTask('dsl-auto-attempt-deferred', () => {
      caseOf('case-a', async () => {
        const key = `case-a:${started.filter(item => item.startsWith('case-a')).length}`
        started.push(key)
        const release = createDeferredPromise()
        releasesByAttempt.set(key, release)
        await release.promise
      }, { input: 'a' })

      caseOf('case-b', async () => {
        const key = `case-b:${started.filter(item => item.startsWith('case-b')).length}`
        started.push(key)
        const release = createDeferredPromise()
        releasesByAttempt.set(key, release)
        await release.promise
        if (key === 'case-b:0') {
          throw new Error('retry-on-next-attempt')
        }
      }, {
        autoAttempt: 1,
        input: 'b',
      })
    })

    const runPromise = taskDefinition.task!.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'x',
          name: 'x',
        },
        id: 'task-auto-attempt',
        inferenceExecutor: {
          id: 'openai:gpt-4.1-mini',
        },
        matrix: createScheduledTaskMatrix(),
      },
    })

    await waitForExpectation(() => {
      expect(started).toEqual(['case-a:0', 'case-b:0'])
    })

    releasesByAttempt.get('case-b:0')?.resolve()
    await Promise.resolve()
    expect(started).toEqual(['case-a:0', 'case-b:0'])

    releasesByAttempt.get('case-a:0')?.resolve()

    await waitForExpectation(() => {
      expect(started).toEqual(['case-a:0', 'case-b:0', 'case-a:1', 'case-b:1'])
    })

    releasesByAttempt.get('case-a:1')?.resolve()
    releasesByAttempt.get('case-b:1')?.resolve()

    const runResult = await runPromise

    expect(runResult.scores[0]?.score).toBe(0.75)
  })

  /**
   * it('scores auto attempts as independent evidence') verifies task-level attempt aggregation.
   *
   * @example
   * autoAttempt: 1 with first attempt failing and second attempt passing -> exact score 0.5.
   */
  it('scores auto attempts as independent evidence instead of replacing earlier failures', async () => {
    let runs = 0

    const taskDefinition = describeTask('dsl-auto-attempt-evidence', () => {
      caseOf('flaky-case', async () => {
        runs += 1

        if (runs === 1) {
          throw new Error('first-attempt-failed')
        }
      }, {
        autoAttempt: 1,
        input: 'flaky',
      })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'x',
          name: 'x',
        },
        id: 'task-auto-attempt-evidence',
        inferenceExecutor: {
          id: 'openai:gpt-4.1-mini',
        },
        matrix: createScheduledTaskMatrix(),
      },
    })

    expect(runs).toBe(2)
    expect(runResult?.scores[0]?.score).toBe(0.5)
  })

  /**
   * it('does not start a full auto attempt when in-case auto retry recovers') verifies retry and attempt boundaries.
   *
   * @example
   * autoRetry: 1 and autoAttempt: 1 with retry pass -> exact score 1.
   */
  it('does not start a full auto attempt when in-case auto retry recovers', async () => {
    let runs = 0

    const taskDefinition = describeTask('dsl-auto-retry-before-auto-attempt', () => {
      caseOf('retry-then-pass-case', async () => {
        runs += 1

        if (runs === 1) {
          throw new Error('retry-first')
        }
      }, {
        autoAttempt: 1,
        autoRetry: 1,
        input: 'retry-then-pass',
      })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'x',
          name: 'x',
        },
        id: 'task-auto-retry-before-auto-attempt',
        inferenceExecutor: {
          id: 'openai:gpt-4.1-mini',
        },
        matrix: createScheduledTaskMatrix(),
      },
    })

    expect(runs).toBe(2)
    expect(runResult?.scores[0]?.score).toBe(1)
  })

  it('passes an abort signal into case execution and aborts it on timeout', async () => {
    const observedSignals: AbortSignal[] = []
    const abortedStates: boolean[] = []

    const taskDefinition = describeTask('dsl-timeout-abort-signal', () => {
      caseOf('abortable-case', async (context) => {
        observedSignals.push(context.signal)

        await new Promise<void>((resolve) => {
          context.signal.addEventListener('abort', () => {
            abortedStates.push(context.signal.aborted)
            resolve()
          }, { once: true })
        })
      }, {
        input: 'abortable',
        timeout: 5,
      })
    })

    await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'x',
          name: 'x',
        },
        id: 'task-abort',
        inferenceExecutor: {
          id: 'openai:gpt-4.1-mini',
        },
        matrix: createScheduledTaskMatrix(),
      },
    })

    expect(observedSignals).toHaveLength(1)
    expect(observedSignals[0]?.aborted).toBe(true)
    expect(abortedStates).toEqual([true])
  })

  it('supports builder-form caseOf without input', async () => {
    const taskDefinition = describeEval('dsl-builder-no-input', (task) => {
      task.caseOf('case-a', (context) => {
        expect(context.matrix.inputs).toBeUndefined()
      })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'x',
          name: 'x',
        },
        id: 'x',
        inferenceExecutor: {
          id: 'openai:gpt-4.1-mini',
        },
        matrix: createScheduledTaskMatrix(),
      },
    })

    expect(runResult?.scores[0]?.score).toBe(1)
  })
})
