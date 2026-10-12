import type { RunEventBus } from '../core/runner/event-bus'
import type { TelemetryAttributes, TelemetryRuntime } from '../core/telemetry'
import type { CaseEndedData, CaseStartedData, RunEventEnvelope } from '../events'

import { errorMessageFrom } from '@moeru/std'
import { describe, expect, it, vi } from 'vitest'

import * as v from 'valibot'

import { createRunEventBus } from '../core/runner/event-bus'
import { caseEnded, caseEndedDataSchema, caseStarted, caseStartedDataSchema, metricRecorded, scoreRecorded } from '../events'
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

/**
 * Creates a real run event bus with the given listeners, standing in for the CLI subscribers.
 */
function createTestRunEvents(listeners: {
  onAny?: (envelope: RunEventEnvelope) => void
  onCaseEnd?: (data: CaseEndedData) => void
  onCaseStart?: (data: CaseStartedData) => void
}): RunEventBus {
  const bus = createRunEventBus({ attemptId: 'attempt-test', experimentId: 'experiment-test', runId: 'run-test', workspaceId: 'workspace-test' })
  if (listeners.onCaseStart != null) {
    const onCaseStart = listeners.onCaseStart
    bus.on(caseStarted, ({ data }) => onCaseStart(data))
  }
  if (listeners.onCaseEnd != null) {
    const onCaseEnd = listeners.onCaseEnd
    bus.on(caseEnded, ({ data }) => onCaseEnd(data))
  }
  if (listeners.onAny != null) {
    bus.onAny(listeners.onAny)
  }
  return bus
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

/**
 * Projects envelopes to the fields the DSL controls.
 */
function toEmitted(envelope: RunEventEnvelope): { caseId?: string, data: unknown, event: string } {
  return { caseId: envelope.caseId, data: envelope.data, event: envelope.event }
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
    const startPayloads: CaseStartedData[] = []
    const endPayloads: CaseEndedData[] = []
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
      events: createTestRunEvents({
        onCaseEnd: data => endPayloads.push(data),
        onCaseStart: data => startPayloads.push(data),
      }),
      models: createTestModels(),
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
        context.recordScore(0.8)
        context.recordScore(0.6, 'judge')
      }, { input: {} })

      caseOf('case-2', (context) => {
        context.recordScore(0.2)
        context.recordScore(0.4, 'judge')
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

  it('emits metric.recorded events from case contexts', async () => {
    const events: Array<{ caseId?: string, data: unknown, event: string }> = []

    const taskDefinition = describeTask('dsl-case-metrics', () => {
      caseOf('case-1', (context) => {
        context.recordMetric('overallAverageScore', 0.77)
      }, { input: {} })
    })

    await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      events: createTestRunEvents({
        onAny: envelope => events.push(toEmitted(envelope)),
      }),
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

    expect(events.filter(event => event.event === 'metric.recorded')).toEqual([
      {
        caseId: '0:case-1',
        data: {
          name: 'overallAverageScore',
          value: 0.77,
        },
        event: 'metric.recorded',
      },
    ])
  })

  it('isolates throwing run event subscribers from case score and metric calls', async () => {
    const onEvent = vi.fn(() => {
      throw new Error('reporter unavailable')
    })
    const events = createRunEventBus({ attemptId: 'attempt-test', experimentId: 'experiment-test', runId: 'run-test', workspaceId: 'workspace-test' })
    events.on(metricRecorded, onEvent)
    events.on(scoreRecorded, onEvent)

    const taskDefinition = describeTask('dsl-reporter-event-isolation', () => {
      caseOf('case-1', (context) => {
        context.recordScore(0.42)
        context.recordMetric('customMetric', 0.9)
      }, { input: {} })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      events,
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
    const reporterEvents: Array<{ caseId?: string, data: unknown, event: string }> = []
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
        context.recordScore(0.75, 'exact')
        context.recordMetric('benchmark.id', 'locomo')
        context.recordMetric('benchmark.tags', ['retrieval', 'qa'])
      }, { input: {} })
    })

    const runResult = await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      events: createTestRunEvents({
        onAny: envelope => reporterEvents.push(toEmitted(envelope)),
      }),
      models: createTestModels(),
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
      event: 'score.recorded',
    })
    expect(reporterEvents).toContainEqual({
      caseId: '0:case-1',
      data: {
        name: 'benchmark.id',
        value: 'locomo',
      },
      event: 'metric.recorded',
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
    const startPayloads: CaseStartedData[] = []
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
      events: createTestRunEvents({
        onCaseStart: data => startPayloads.push(data),
      }),
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
    const endPayloads: CaseEndedData[] = []

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
      events: createTestRunEvents({
        onCaseEnd: data => endPayloads.push(data),
      }),
      models: createTestModels(),
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
    const startPayloads: CaseStartedData[] = []

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
      events: createTestRunEvents({
        onCaseStart: data => startPayloads.push(data),
      }),
      models: createTestModels(),
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

  /**
   * it('stamps attemptIndex on every case event of a task that runs auto attempts') verifies the auto attempt event contract.
   *
   * @example
   * flaky case with autoAttempt: 1 -> case.started/ended carry attemptIndex 0 then 1; a sibling case carries autoAttempt 0.
   */
  it('stamps attemptIndex on every case event of a task that runs auto attempts', async () => {
    const envelopes: RunEventEnvelope[] = []
    let flakyRuns = 0

    const taskDefinition = describeTask('dsl-auto-attempt-events', () => {
      caseOf('stable', async () => {})
      caseOf('flaky', async () => {
        flakyRuns += 1
        if (flakyRuns === 1) {
          throw new Error('first-attempt-failed')
        }
      }, {
        autoAttempt: 1,
        autoRetry: 0,
        input: undefined,
      })
    })

    await taskDefinition.task!.run({
      cache: createTestTaskCacheRuntime(),
      events: createTestRunEvents({ onAny: envelope => envelopes.push(envelope) }),
      models: createTestModels(),
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'x',
          name: 'x',
        },
        id: 'task-auto-attempt-events',
        inferenceExecutor: { id: 'openai:gpt-4.1-mini' },
        matrix: createScheduledTaskMatrix(),
      },
    })

    expect(envelopes.map(toEmitted)).toEqual([
      { caseId: '0:stable', data: { attemptIndex: 0, autoAttempt: 0, index: 0, name: 'stable', total: 2 }, event: 'case.started' },
      { caseId: '1:flaky', data: { attemptIndex: 0, autoAttempt: 1, index: 1, name: 'flaky', total: 2 }, event: 'case.started' },
      { caseId: '0:stable', data: { attemptIndex: 0, autoAttempt: 0, index: 0, name: 'stable', state: 'passed', total: 2 }, event: 'case.ended' },
      { caseId: '1:flaky', data: { attemptIndex: 0, autoAttempt: 1, errorMessage: 'first-attempt-failed', index: 1, name: 'flaky', state: 'failed', total: 2 }, event: 'case.ended' },
      { caseId: '0:stable', data: { attemptIndex: 1, autoAttempt: 0, index: 0, name: 'stable', total: 2 }, event: 'case.started' },
      { caseId: '1:flaky', data: { attemptIndex: 1, autoAttempt: 1, index: 1, name: 'flaky', total: 2 }, event: 'case.started' },
      { caseId: '0:stable', data: { attemptIndex: 1, autoAttempt: 0, index: 0, name: 'stable', state: 'passed', total: 2 }, event: 'case.ended' },
      { caseId: '1:flaky', data: { attemptIndex: 1, autoAttempt: 1, index: 1, name: 'flaky', state: 'passed', total: 2 }, event: 'case.ended' },
    ])
    for (const envelope of envelopes) {
      if (envelope.event === caseStarted.id) {
        expect(v.parse(caseStartedDataSchema, envelope.data)).toEqual(envelope.data)
      }
      else {
        expect(v.parse(caseEndedDataSchema, envelope.data)).toEqual(envelope.data)
      }
    }
  })

  /**
   * it('keeps attemptIndex and retryIndex apart when retries run inside an auto attempt') verifies the two counters do not mix.
   */
  it('keeps attemptIndex and retryIndex apart when retries run inside an auto attempt', async () => {
    const starts: CaseStartedData[] = []
    let runs = 0

    const taskDefinition = describeTask('dsl-auto-attempt-with-retry-events', () => {
      caseOf('always-fails-first-two', async () => {
        runs += 1
        if (runs <= 2) {
          throw new Error(`fail-${runs}`)
        }
      }, {
        autoAttempt: 1,
        autoRetry: 1,
        autoRetryDelay: 0,
        input: undefined,
      })
    })

    await taskDefinition.task!.run({
      cache: createTestTaskCacheRuntime(),
      events: createTestRunEvents({ onCaseStart: data => starts.push(data) }),
      models: createTestModels(),
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'x',
          name: 'x',
        },
        id: 'task-auto-attempt-retry-events',
        inferenceExecutor: { id: 'openai:gpt-4.1-mini' },
        matrix: createScheduledTaskMatrix(),
      },
    })

    expect(starts.map(start => [start.attemptIndex, start.retryIndex])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ])
  })

  /**
   * it('caps cases running at once within one attempt across case groups') verifies `concurrency.attempt`.
   *
   * @example
   * two casesFromInputs groups of 2 with case cap 2 each and attempt cap 1 -> one case at a time.
   */
  it('caps cases running at once within one attempt across case groups', async () => {
    let active = 0
    let peak = 0

    const taskDefinition = describeTask('dsl-attempt-concurrency', (task) => {
      const runCase = async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise(resolve => setTimeout(resolve, 5))
        active -= 1
      }
      task.casesFromInputs('left', [1, 2], runCase, { concurrency: 2 })
      task.casesFromInputs('right', [1, 2], runCase, { concurrency: 2 })
    }, {
      concurrency: {
        attempt: 1,
      },
    })

    const runResult = await taskDefinition.task!.run({
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
        id: 'task-attempt-concurrency',
        inferenceExecutor: { id: 'openai:gpt-4.1-mini' },
        matrix: createScheduledTaskMatrix(),
      },
    })

    expect(peak).toBe(1)
    expect(runResult.scores[0]?.score).toBe(1)
  })

  /**
   * it('lets the runtime attempt cap override the task attempt cap in every auto attempt') verifies `--attempt-concurrency`.
   */
  it('lets the runtime attempt cap override the task attempt cap in every auto attempt', async () => {
    let active = 0
    const peaksByAttempt: number[] = [0, 0]
    let attemptIndex = 0
    let flakyRuns = 0

    const taskDefinition = describeTask('dsl-runtime-attempt-concurrency', (task) => {
      task.casesFromInputs('sample', [1, 2, 3, 4], async (context) => {
        active += 1
        peaksByAttempt[attemptIndex] = Math.max(peaksByAttempt[attemptIndex]!, active)
        await new Promise(resolve => setTimeout(resolve, 5))
        active -= 1
        if (context.matrix.inputs === 4) {
          flakyRuns += 1
          if (flakyRuns === 1) {
            attemptIndex = 1
            throw new Error('retry-on-next-attempt')
          }
        }
      }, { autoAttempt: 1 })
    }, {
      concurrency: {
        attempt: 4,
      },
    })

    await taskDefinition.task!.run({
      cache: createTestTaskCacheRuntime(),
      models: createTestModels(),
      runtimeConcurrency: {
        attempt: 2,
      },
      task: {
        entry: {
          description: 'd',
          directory: 'x',
          filePath: '/tmp/x.eval.ts',
          id: 'x',
          name: 'x',
        },
        id: 'task-runtime-attempt-concurrency',
        inferenceExecutor: { id: 'openai:gpt-4.1-mini' },
        matrix: createScheduledTaskMatrix(),
      },
    })

    expect(flakyRuns).toBe(2)
    expect(peaksByAttempt).toEqual([2, 2])
  })

  it('rejects an invalid attempt concurrency cap', async () => {
    const taskDefinition = describeTask('dsl-invalid-attempt-concurrency', () => {
      caseOf('case', async () => {})
    }, {
      concurrency: {
        attempt: 0,
      },
    })

    await expect(taskDefinition.task!.run({
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
        id: 'task-invalid-attempt-concurrency',
        inferenceExecutor: { id: 'openai:gpt-4.1-mini' },
        matrix: createScheduledTaskMatrix(),
      },
    })).rejects.toThrow('Invalid task attempt concurrency: 0')
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

  /**
   * @example
   * it('aborts running cases on interrupt, lets them clean up, and starts no queued case', async () => {})
   */
  it('aborts running cases on interrupt, lets them clean up, and starts no queued case', async () => {
    const interruption = new AbortController()
    const started = createDeferredPromise()
    const lifecycle: string[] = []
    const endedCases: CaseEndedData[] = []
    const startedCases: string[] = []
    const taskDefinition = describeTask('dsl-interrupt', () => {
      caseOf('running', async (context) => {
        lifecycle.push('create running')
        started.resolve()
        try {
          await new Promise((_, reject) => context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true }))
        }
        finally {
          lifecycle.push('delete running')
        }
      })
      caseOf('queued', async () => {
        lifecycle.push('create queued')
      })
    }, { autoRetry: 2, autoRetryDelay: 0, concurrency: { case: 1 } })

    const runPromise = taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      events: createTestRunEvents({
        onCaseEnd: data => endedCases.push(data),
        onCaseStart: data => startedCases.push(data.name),
      }),
      models: createTestModels(),
      signal: interruption.signal,
      task: {
        entry: { description: 'd', directory: 'x', filePath: '/tmp/x.eval.ts', id: 'x', name: 'x' },
        id: 'x',
        inferenceExecutor: { id: 'openai:gpt-4.1-mini' },
        matrix: createScheduledTaskMatrix(),
      },
    })
    await started.promise
    interruption.abort(new Error('Run interrupted by SIGINT.'))
    await runPromise

    /**
     * @example
     * expect(lifecycle).toEqual(['create running', 'delete running'])
     */
    expect(lifecycle).toEqual(['create running', 'delete running'])
    /**
     * @example
     * expect(startedCases).toEqual(['running'])
     */
    // The failed case is not retried and the queued case never starts.
    expect(startedCases).toEqual(['running'])
    /**
     * @example
     * expect(endedCases).toEqual([expect.objectContaining({ errorMessage: 'Run interrupted by SIGINT.', name: 'running', state: 'failed' })])
     */
    expect(endedCases).toEqual([expect.objectContaining({ errorMessage: 'Run interrupted by SIGINT.', name: 'running', state: 'failed' })])
  })

  /**
   * @example
   * it('reports a case that ignored the interrupt and returned normally as failed', async () => {})
   */
  it('reports a case that ignored the interrupt and returned normally as failed', async () => {
    const interruption = new AbortController()
    const endedCases: CaseEndedData[] = []
    const taskDefinition = describeTask('dsl-interrupt-ignored', () => {
      caseOf('ignores-signal', async () => {
        interruption.abort(new Error('Run interrupted by SIGTERM.'))
      })
    })

    await taskDefinition.task?.run({
      cache: createTestTaskCacheRuntime(),
      events: createTestRunEvents({ onCaseEnd: data => endedCases.push(data) }),
      models: createTestModels(),
      signal: interruption.signal,
      task: {
        entry: { description: 'd', directory: 'x', filePath: '/tmp/x.eval.ts', id: 'x', name: 'x' },
        id: 'x',
        inferenceExecutor: { id: 'openai:gpt-4.1-mini' },
        matrix: createScheduledTaskMatrix(),
      },
    })

    /**
     * @example
     * expect(endedCases.map(data => [data.state, data.errorMessage])).toEqual([['failed', 'Run interrupted by SIGTERM.']])
     */
    expect(endedCases.map(data => [data.state, data.errorMessage])).toEqual([['failed', 'Run interrupted by SIGTERM.']])
  })
})
