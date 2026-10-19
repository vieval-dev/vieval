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
        inferenceExecutorId: 'openai:gpt-4.1-mini',
        matrix: resultMatrix,
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
        inferenceExecutorId: 'openai:gpt-4.1-mini',
        matrix: createScheduledTaskMatrix({
          difficulty: 'rapid',
        }),
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
        inferenceExecutorId: 'openai:gpt-4.1-mini',
        matrix: createScheduledTaskMatrix({
          difficulty: 'blitz',
        }),
        scores: [
          { kind: 'exact', score: 0.25 },
          { kind: 'judge', score: 0.5 },
        ],
      },
    ])

    expect(summary.runs).toHaveLength(2)
    expect(summary.inferenceExecutors).toEqual([
      {
        coverage: null,
        exactAverage: 7 / 12,
        hybridAverage: expect.any(Number),
        inferenceExecutorId: 'openai:gpt-4.1-mini',
        judgeAverage: 0.5,
        runCount: 2,
        // Runs without coverage have no unmeasured cases, so the strict score equals the exact score.
        strictExactAverage: 7 / 12,
      },
    ])
    expect(summary.inferenceExecutors[0]?.hybridAverage).toBeCloseTo(13 / 24)
    expect(summary.overall).toEqual({
      coverage: null,
      exactAverage: 7 / 12,
      hybridAverage: expect.any(Number),
      judgeAverage: 0.5,
      runCount: 2,
      strictExactAverage: 7 / 12,
    })
    expect(summary.overall.hybridAverage).toBeCloseTo(13 / 24)
  })

  it('falls back to the available score family when only one side exists', () => {
    const summary = aggregateRunResults([
      {
        entryId: 'agent/chess-commentary/chess-commentary',
        id: 'run-1',
        inferenceExecutorId: 'openai:gpt-4.1',
        matrix: createScheduledTaskMatrix(),
        scores: [
          { kind: 'judge', score: 0.8 },
        ],
      },
    ])

    expect(summary.inferenceExecutors).toEqual([
      {
        coverage: null,
        exactAverage: null,
        hybridAverage: 0.8,
        inferenceExecutorId: 'openai:gpt-4.1',
        judgeAverage: 0.8,
        runCount: 1,
        strictExactAverage: null,
      },
    ])
  })

  // ROOT CAUSE:
  //
  // In the `tts-speech-formula` comparison of 2026-10-19, the `llm` workspace graded 87.6% of its measured cases right,
  // but 93 of its cases errored on provider 429s. Errored cases scored exact 0, so its exact score sank to the level
  // of a workspace that measured every case and got far fewer right.
  //
  // collectCaseOutcomeScores: if (outcome.state !== 'passed') exact.push(0)
  //
  // We fixed this by scoring only measured cases in `exactAverage`, and reporting `coverage` and the old
  // every-case score as `strictExactAverage` next to it.
  /**
   * @example
   * one run measured 3 of 4 cases with exact 1 -> exact 1, coverage 3/4, strict exact 0.75.
   */
  it('scores measured cases in exactAverage and reports coverage and strict exact next to it', () => {
    const summary = aggregateRunResults([
      {
        coverage: { measured: 3, total: 4 },
        entryId: 'tasks/read-aloud/ko',
        id: 'run-1',
        inferenceExecutorId: 'default',
        matrix: createScheduledTaskMatrix(),
        scores: [{ kind: 'exact', score: 1 }],
      },
      {
        coverage: { measured: 0, total: 2 },
        entryId: 'tasks/read-aloud/zh',
        id: 'run-2',
        inferenceExecutorId: 'default',
        matrix: createScheduledTaskMatrix(),
        scores: [],
      },
    ])

    expect(summary.runs[0]?.exactAverage).toBe(1)
    expect(summary.runs[0]?.coverage).toEqual({ measured: 3, total: 4 })
    expect(summary.runs[0]?.strictExactAverage).toBe(0.75)
    expect(summary.runs[1]?.exactAverage).toBeNull()
    expect(summary.runs[1]?.strictExactAverage).toBe(0)
    expect(summary.overall.exactAverage).toBe(1)
    expect(summary.overall.coverage).toEqual({ measured: 3, total: 6 })
    expect(summary.overall.strictExactAverage).toBe(0.375)
  })

  it('throws a deterministic error for unknown score kinds', () => {
    expect(() => aggregateRunResults([
      {
        entryId: 'agent/chess-commentary/chess-commentary',
        id: 'run-1',
        inferenceExecutorId: 'openai:gpt-4.1',
        matrix: createScheduledTaskMatrix(),
        scores: [
          { kind: 'judge', score: 0.8 },
          { kind: 'rubric' as 'exact', score: 0.2 },
        ],
      },
    ])).toThrowError('Unknown eval score kind "rubric".')
  })
})
