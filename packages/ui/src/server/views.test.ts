import { describe, expect, it } from 'vitest'

import { createEnvelopeFactory, createReducerHandle } from '../../test/helpers'
import { createRunReducer } from '../shared/reduce'
import { createEvidenceService } from './evidence'
import { buildMetrics, buildScores, buildSnapshot } from './views'

const TASK = 'evals%2Fdemo::default::run=default::eval=default'
const OTHER_TASK = 'evals%2Fdemo::default::run=model%3Db::eval=default'

function createReducer() {
  const envelope = createEnvelopeFactory()
  const reducer = createRunReducer()
  const apply = (event: string, data: unknown, scope: object = {}) => {
    reducer.apply(envelope(event, data, scope))
  }
  return { apply, reducer }
}

/** Settles one case of `taskId` with the given state and recorded score values. */
function settleCase(apply: (event: string, data: unknown, scope: object) => void, taskId: string, index: number, state: string, values: Record<string, number> = {}): void {
  const scope = { caseId: `${index}:c${index}`, projectId: 'demo', taskId }
  apply('case.started', { index, name: `c${index}`, total: 1 }, scope)
  for (const [name, value] of Object.entries(values)) {
    apply('score.recorded', { name, value }, scope)
  }
  apply('case.ended', { index, name: `c${index}`, state, total: 1 }, scope)
}

describe('buildMetrics', () => {
  // ROOT CAUSE:
  //
  // A metric recorded once per step of a long run has hundreds of thousands of points. Its summary spread every
  // value into one call, which exceeds the engine's argument limit and made `/metrics` answer 500:
  //
  // max: Math.max(...values)   // RangeError: Maximum call stack size exceeded
  //
  // We fixed this by computing min, max, and sum in one loop over the values.
  /**
   * @example
   * expect(series.summary).toMatchObject({ count: 200_000, max: 199_999, min: 0 })
   */
  it('summarizes a metric series with hundreds of thousands of points', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    const scope = { caseId: '0:a', projectId: 'demo', taskId: TASK }
    reducer.apply(envelope('case.started', { index: 0, name: 'a', total: 1 }, scope))
    for (let value = 0; value < 200_000; value += 1) {
      reducer.apply(envelope('metric.recorded', { name: 'steps', value }, scope, '2026-01-01T00:00:00.000Z'))
    }

    const [series] = buildMetrics(createReducerHandle(reducer), {}).numeric
    expect(series.summary).toMatchObject({ count: 200_000, max: 199_999, min: 0, sum: 199_999 * 100_000 })
  })

  /**
   * @example
   * expect(score.points.map(point => point.value)).toEqual([0.5, 0])
   */
  it('puts each case\'s counted score beside the metrics, with its definition and the summary of the selection', () => {
    const { apply, reducer } = createReducer()
    apply('score.defined', { label: 'Correct', name: 'demo.correct' }, { projectId: 'demo', taskId: TASK })
    settleCase(apply, TASK, 0, 'passed', { 'demo.correct': 0.5 })
    // A failed case counts 0, whatever it recorded; an errored one does not count.
    settleCase(apply, TASK, 1, 'failed', { 'demo.correct': 1 })
    settleCase(apply, TASK, 2, 'errored')
    settleCase(apply, TASK, 3, 'failed')

    const metrics = buildMetrics(createReducerHandle(reducer), {})
    expect(metrics.scoreDefinitions).toEqual([{ label: 'Correct', name: 'demo.correct' }])
    expect(metrics.scores).toHaveLength(1)
    const [score] = metrics.scores
    expect(score.name).toBe('demo.correct')
    expect(score.points.map(point => [point.caseId, point.value])).toEqual([['0:c0', 0.5], ['1:c1', 0], ['3:c3', 0]])
    expect(score.summary).toEqual({ mean: 0.5 / 3, n: 3, name: 'demo.correct', sum: 0.5, total: 4, unscored: {} })

    const single = buildMetrics(createReducerHandle(reducer), { caseId: '0:c0', taskId: TASK })
    expect(single.scores[0].summary).toMatchObject({ mean: 0.5, n: 1, total: 1 })
  })

  // ROOT CAUSE:
  //
  // A case that failed before it recorded a score had no point, while the task's mean counted it as 0: one round was
  // scored on its own, so only the names it recorded were its scores.
  //
  // countedScores(round)   // {} for a failed round without records
  //
  // We fixed this by counting a round with every score of its task (`countingDefinitions`).
  /**
   * @example
   * expect(failed.scores[0].points).toEqual([{ caseId: '1:c1', roundIndex: 0, taskId: TASK, value: 0 }])
   */
  it('counts a failed case in a score that only other cases of its task recorded', () => {
    const { apply, reducer } = createReducer()
    settleCase(apply, TASK, 0, 'passed', { 'demo.score': 1 })
    settleCase(apply, TASK, 1, 'failed')

    const failed = buildMetrics(createReducerHandle(reducer), { caseId: '1:c1', taskId: TASK })
    expect(failed.scores.map(score => score.name)).toEqual(['demo.score'])
    expect(failed.scores[0].points).toEqual([{ caseId: '1:c1', roundIndex: 0, taskId: TASK, value: 0 }])
    expect(failed.scores[0].summary).toMatchObject({ mean: 0, n: 1, total: 1 })
  })
})

describe('buildScores', () => {
  // ROOT CAUSE:
  //
  // The overall score of a run averaged task means without weights, so a task of one case weighed as much as a task
  // of a hundred:
  //
  // const exact = average(tasks.map(task => task.scores.exact))
  //
  // We fixed this by pooling the cases of every task (`poolScoreSummaries`).
  /**
   * @example
   * expect(scores.overall.scores[0].mean).toBe(0.25)
   */
  it('pools the cases of every task instead of averaging task means', () => {
    const { apply, reducer } = createReducer()
    settleCase(apply, TASK, 0, 'passed', { 'demo.score': 1 })
    settleCase(apply, OTHER_TASK, 0, 'passed', { 'demo.score': 0 })
    settleCase(apply, OTHER_TASK, 1, 'passed', { 'demo.score': 0 })
    settleCase(apply, OTHER_TASK, 2, 'passed', { 'demo.score': 0 })

    const scores = buildScores(createReducerHandle(reducer))
    // The mean of task means would be 0.5.
    expect(scores.overall.scores).toEqual([{ mean: 0.25, n: 4, name: 'demo.score', sum: 1, total: 4, unscored: {} }])
    expect(scores.overall.headline?.headline).toEqual({ kind: 'score', score: scores.overall.scores[0] })
    expect(scores.byTask.map(task => task.scoring.scores[0].mean)).toEqual([1, 0])
    expect(scores.byRound.map(round => [round.taskId, round.roundIndex, round.scoring.completion.n])).toEqual([[TASK, 0, 1], [OTHER_TASK, 0, 3]])
    expect(scores.summary).toBeUndefined()
  })
})

describe('buildSnapshot', () => {
  /**
   * @example
   * expect(snapshot.summary?.headline).toEqual(summaryHeadline)
   */
  it('returns the headline from the events, and the one run-summary.json holds next to it', () => {
    const { apply, reducer } = createReducer()
    apply('score.defined', { name: 'demo.pass', primary: true }, { projectId: 'demo', taskId: TASK })
    settleCase(apply, TASK, 0, 'passed', { 'demo.pass': 1 })
    const summaryHeadline = {
      completion: { mean: 1, n: 1, name: 'completion', sum: 1, total: 1, unscored: {} },
      headline: { kind: 'score' as const, score: { mean: 1, n: 1, name: 'demo.pass', sum: 1, total: 1, unscored: {} } },
    }
    const evidence = createEvidenceService({ evidenceRoots: [], logDirectories: [] })

    const snapshot = buildSnapshot(createReducerHandle(reducer, { summary: { headline: summaryHeadline } }), evidence, Date.now())
    // The events resolve the same headline the runner wrote.
    expect(snapshot.headline).toEqual(summaryHeadline)
    expect(snapshot.scoreDefinitions).toEqual([{ name: 'demo.pass', primary: true }])
    expect(snapshot.summary?.headline).toEqual(summaryHeadline)
    expect(snapshot.tasks[0].scoring.primary).toBe('demo.pass')
  })
})
