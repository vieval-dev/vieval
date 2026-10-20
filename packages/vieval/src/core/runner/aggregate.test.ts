import type { ScoreSummary } from '../scoring'
import type { RunResult } from './aggregate'
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

function run(id: string, inferenceExecutorId: string, entryId: string, primary: string | undefined, scores: ScoreSummary[], completion: ScoreSummary): RunResult {
  return {
    completion,
    entryId,
    id,
    inferenceExecutorId,
    matrix: createScheduledTaskMatrix(),
    passed: summary('passed', completion.sum, completion.n),
    ...(primary == null ? {} : { primary }),
    scores,
  }
}

function summary(name: string, sum: number, n: number, total = n): ScoreSummary {
  return { mean: n === 0 ? null : sum / n, n, name, sum, total, unscored: {} }
}

describe('aggregateRunResults', () => {
  it('preserves scoped matrix dimensions as stable run artifacts', () => {
    const resultMatrix = createScheduledTaskMatrix({
      difficulty: 'rapid',
      model: 'gpt-4.1-mini',
    }, {
      rubric: 'strict',
    })

    const result = aggregateRunResults([
      {
        entryId: 'agent/chess-commentary/chess-commentary',
        id: 'run-1',
        inferenceExecutorId: 'openai:gpt-4.1-mini',
        matrix: resultMatrix,
        scores: [summary('pass', 1, 1)],
      },
    ])

    resultMatrix.run.model = 'mutated-model'
    resultMatrix.eval.rubric = 'mutated-rubric'
    resultMatrix.meta.runRowId = 'mutated-run-row-id'
    resultMatrix.meta.evalRowId = 'mutated-eval-row-id'

    expect(result.runs[0]?.matrix).toEqual({
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

  /**
   * @example
   * pass 1/1 on executor a and 0/3 on executor b -> overall 1/4 = 0.25 (cases pooled), not the mean of means 0.5.
   */
  it('pools each score by cases per executor and overall', () => {
    const result = aggregateRunResults([
      run('run-1', 'a', 'entry', 'pass', [summary('pass', 1, 1)], summary('completion', 1, 1)),
      run('run-2', 'b', 'entry', 'pass', [summary('pass', 0, 3, 4)], summary('completion', 3, 4)),
    ])

    expect(result.inferenceExecutors.map(executor => [executor.inferenceExecutorId, executor.scores[0]?.mean, executor.runCount])).toEqual([['a', 1, 1], ['b', 0, 1]])
    expect(result.overall.scores).toEqual([summary('pass', 1, 4, 5)])
    expect(result.overall.completion).toEqual(summary('completion', 4, 5))
    expect(result.overall.headline.headline).toEqual({ kind: 'score', score: summary('pass', 1, 4, 5) })
  })

  /**
   * @example
   * two entries with primary `pass` and `accuracy` -> the overall headline lists each entry.
   */
  it('lists each task in the headline when the primary names differ', () => {
    const result = aggregateRunResults([
      run('run-1', 'a', 'entry-1', 'pass', [summary('pass', 1, 1)], summary('completion', 1, 1)),
      run('run-2', 'a', 'entry-2', 'accuracy', [summary('accuracy', 1, 2)], summary('completion', 2, 2)),
    ])

    expect(result.overall.headline.headline).toEqual({
      kind: 'per-task',
      tasks: [{ score: summary('pass', 1, 1), taskId: 'entry-1' }, { score: summary('accuracy', 1, 2), taskId: 'entry-2' }],
    })
    expect(result.runs.map(item => item.primary)).toEqual(['pass', 'accuracy'])
  })

  /**
   * @example
   * a custom executor run without completion -> completion null for the run and the group.
   */
  it('keeps completion null for runs that do not report their cases', () => {
    const result = aggregateRunResults([{ entryId: 'custom', id: 'run-1', inferenceExecutorId: 'a', matrix: createScheduledTaskMatrix(), scores: [summary('quality', 1, 2)] }])

    expect(result.runs[0]?.completion).toBeNull()
    expect(result.overall.completion).toBeNull()
    expect(result.overall.headline.headline).toEqual({ kind: 'passed-cases', score: summary('passed', 0, 0) })
  })
})
