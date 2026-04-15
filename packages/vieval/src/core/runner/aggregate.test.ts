import type { ScheduledTaskMatrix } from './schedule'

import { describe, expect, it } from 'vitest'

import { aggregateRunResults } from './aggregate'

function createScheduledTaskMatrix(
  run: Record<string, string> = {},
  evalMatrix: Record<string, string> = {},
): ScheduledTaskMatrix {
  return {
    eval: {
      ...evalMatrix,
    },
    meta: {
      evalRowId: Object.entries(evalMatrix)
        .sort(([leftAxis], [rightAxis]) => leftAxis.localeCompare(rightAxis))
        .map(([axis, value]) => `${axis}=${value}`)
        .join('&') || 'default',
      runRowId: Object.entries(run)
        .sort(([leftAxis], [rightAxis]) => leftAxis.localeCompare(rightAxis))
        .map(([axis, value]) => `${axis}=${value}`)
        .join('&') || 'default',
    },
    run,
  }
}

describe('aggregateRunResults', () => {
  it('preserves scoped matrix dimensions as stable run artifacts', () => {
    const resultMatrix = createScheduledTaskMatrix({
      difficulty: 'rapid',
      model: 'gpt-4.1-mini',
    }, {
      rubric: 'strict',
    })

    const summary = aggregateRunResults([
      {
        entryId: 'agent/chess-commentary/chess-commentary',
        id: 'run-1',
        matrix: resultMatrix,
        inferenceExecutorId: 'openai:gpt-4.1-mini',
        scores: [
          { kind: 'exact', score: 1 },
        ],
      },
    ])

    resultMatrix.run.model = 'mutated-model'
    resultMatrix.eval.rubric = 'mutated-rubric'
    resultMatrix.meta.runRowId = 'mutated-run-row-id'
    resultMatrix.meta.evalRowId = 'mutated-eval-row-id'

    expect(summary.runs[0]?.matrix).toEqual({
      eval: {
        rubric: 'strict',
      },
      meta: {
        evalRowId: 'rubric=strict',
        runRowId: 'difficulty=rapid&model=gpt-4.1-mini',
      },
      run: {
        difficulty: 'rapid',
        model: 'gpt-4.1-mini',
      },
    })
  })

  it('produces a hybrid score by averaging exact and judge category means', () => {
    const summary = aggregateRunResults([
      {
        entryId: 'agent/chess-commentary/chess-commentary',
        id: 'run-1',
        matrix: createScheduledTaskMatrix({
          difficulty: 'rapid',
        }),
        inferenceExecutorId: 'openai:gpt-4.1-mini',
        scores: [
          { kind: 'exact', score: 1 },
          { kind: 'exact', score: 0.5 },
          { kind: 'judge', score: 0.75 },
          { kind: 'judge', score: 0.25 },
        ],
      },
      {
        entryId: 'agent/chess-commentary/chess-commentary',
        id: 'run-2',
        matrix: createScheduledTaskMatrix({
          difficulty: 'blitz',
        }),
        inferenceExecutorId: 'openai:gpt-4.1-mini',
        scores: [
          { kind: 'exact', score: 0.25 },
          { kind: 'judge', score: 0.5 },
        ],
      },
    ])

    expect(summary.runs).toHaveLength(2)
    expect(summary.inferenceExecutors).toEqual([
      {
        exactAverage: 7 / 12,
        hybridAverage: expect.any(Number),
        judgeAverage: 0.5,
        inferenceExecutorId: 'openai:gpt-4.1-mini',
        runCount: 2,
      },
    ])
    expect(summary.inferenceExecutors[0]?.hybridAverage).toBeCloseTo(13 / 24)
    expect(summary.overall).toEqual({
      exactAverage: 7 / 12,
      hybridAverage: expect.any(Number),
      judgeAverage: 0.5,
      runCount: 2,
    })
    expect(summary.overall.hybridAverage).toBeCloseTo(13 / 24)
  })

  it('falls back to the available score family when only one side exists', () => {
    const summary = aggregateRunResults([
      {
        entryId: 'agent/chess-commentary/chess-commentary',
        id: 'run-1',
        matrix: createScheduledTaskMatrix(),
        inferenceExecutorId: 'openai:gpt-4.1',
        scores: [
          { kind: 'judge', score: 0.8 },
        ],
      },
    ])

    expect(summary.inferenceExecutors).toEqual([
      {
        exactAverage: null,
        hybridAverage: 0.8,
        judgeAverage: 0.8,
        inferenceExecutorId: 'openai:gpt-4.1',
        runCount: 1,
      },
    ])
  })

  it('throws a deterministic error for unknown score kinds', () => {
    expect(() => aggregateRunResults([
      {
        entryId: 'agent/chess-commentary/chess-commentary',
        id: 'run-1',
        matrix: createScheduledTaskMatrix(),
        inferenceExecutorId: 'openai:gpt-4.1',
        scores: [
          { kind: 'judge', score: 0.8 },
          { kind: 'rubric' as 'exact', score: 0.2 },
        ],
      },
    ])).toThrowError('Unknown eval score kind "rubric".')
  })
})
