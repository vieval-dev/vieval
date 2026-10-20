import type { ScoreDefinedData } from '../../events'
import type { HeadlineInput, ScoredCaseOutcome } from './index'

import { describe, expect, it } from 'vitest'

import { deriveScores, emptyScoreSummary, isMeasuredState, poolScoreSummaries, resolveHeadline, scoreCases } from './index'

function outcome(state: ScoredCaseOutcome['state'], scores: Record<string, number> = {}, unscored: Record<string, string> = {}): ScoredCaseOutcome {
  return { scores, state, unscored }
}

describe('scoreCases', () => {
  /**
   * @example
   * passed 1, passed 0.5, failed, errored, timeout, skipped -> correct mean 0.5 over n 3 of total 5.
   */
  it('counts passed values and failed zeros, and leaves errored, timed-out, and skipped cases out by default', () => {
    const scoring = scoreCases([
      outcome('passed', { correct: 1 }),
      outcome('passed', { correct: 0.5 }),
      outcome('failed', { correct: 1 }),
      outcome('errored'),
      outcome('timeout'),
      outcome('skipped'),
    ], [{ name: 'correct' }])

    expect(scoring.scores).toEqual([{ mean: 0.5, n: 3, name: 'correct', sum: 1.5, total: 5, unscored: {} }])
  })

  /**
   * @example
   * errors: 'zero' -> errored and timed-out cases count as 0: mean 1/3 over 3.
   */
  it('counts errored and timed-out cases as 0 when the score sets errors: zero', () => {
    const scoring = scoreCases([
      outcome('passed', { pass: 1 }),
      outcome('errored'),
      outcome('timeout'),
    ], [{ errors: 'zero', name: 'pass' }])

    expect(scoring.scores[0]).toEqual({ mean: 1 / 3, n: 3, name: 'pass', sum: 1, total: 3, unscored: {} })
  })

  /**
   * @example
   * an unscored passed case never counts, whatever `errors` says, and is counted per reason.
   */
  it('never counts unscored values and sums their reasons', () => {
    const scoring = scoreCases([
      outcome('passed', { natural: 1 }),
      outcome('passed', {}, { natural: 'grader_failed' }),
      outcome('passed', {}, { natural: 'grader_failed' }),
      outcome('passed', {}, { natural: 'refusal' }),
    ], [{ errors: 'zero', name: 'natural' }])

    expect(scoring.scores[0]).toEqual({ mean: 1, n: 1, name: 'natural', sum: 1, total: 4, unscored: { grader_failed: 2, refusal: 1 } })
  })

  /**
   * @example
   * a declared score that a passed case never recorded is missing: in total, not in n.
   */
  it('leaves a declared score that a passed case did not record out of the mean', () => {
    const scoring = scoreCases([outcome('passed', { correct: 1 }), outcome('passed')], [{ name: 'correct' }])

    expect(scoring.scores[0]).toMatchObject({ mean: 1, n: 1, total: 2 })
  })

  /**
   * @example
   * no case recorded a score -> no scores; completion and passed still count every settled case.
   */
  it('reports completion and passed shares, with errored and timed-out counts', () => {
    const scoring = scoreCases([
      outcome('passed'),
      outcome('failed'),
      outcome('errored'),
      outcome('errored'),
      outcome('timeout'),
      outcome('skipped'),
    ])

    expect(scoring.scores).toEqual([])
    expect(scoring.completion).toEqual({ mean: 0.4, n: 5, name: 'completion', sum: 2, total: 5, unscored: { errored: 2, timeout: 1 } })
    expect(scoring.passed).toMatchObject({ mean: 0.2, n: 5, sum: 1 })
    expect(scoring.primary).toBeUndefined()
  })

  /**
   * @example
   * case a errored, then passed in a later auto attempt; case b errored twice -> scores count both rounds of a,
   * completion counts each case once by its final outcome: 1 of 2.
   */
  it('counts each case once by its final outcome in completion and passed, and every outcome in the scores', () => {
    const scoring = scoreCases([
      { ...outcome('errored'), caseId: 'a' },
      { ...outcome('errored'), caseId: 'b' },
      { ...outcome('passed', { pass: 1 }), caseId: 'a' },
      { ...outcome('errored'), caseId: 'b' },
    ], [{ errors: 'zero', name: 'pass' }])

    expect(scoring.scores[0]).toMatchObject({ n: 4, sum: 1, total: 4 })
    expect(scoring.completion).toEqual({ mean: 0.5, n: 2, name: 'completion', sum: 1, total: 2, unscored: { errored: 1 } })
    expect(scoring.passed).toMatchObject({ mean: 0.5, n: 2, sum: 1 })
  })

  /**
   * @example
   * declared names keep declaration order; names recorded without a definition follow in name order.
   */
  it('orders declared scores first, then recorded-only names', () => {
    const scoring = scoreCases([outcome('passed', { a: 1, natural: 1, z: 1 })], [{ name: 'natural' }])

    expect(scoring.scores.map(summary => summary.name)).toEqual(['natural', 'a', 'z'])
  })

  /**
   * @example
   * primary: the declared primary score, else the only score, else none.
   */
  it('resolves the primary score of the group', () => {
    expect(scoreCases([outcome('passed', { correct: 1, pass: 1 })], [{ name: 'correct' }, { name: 'pass', primary: true }]).primary).toBe('pass')
    expect(scoreCases([outcome('passed', { only: 1 })]).primary).toBe('only')
    expect(scoreCases([outcome('passed', { a: 1, b: 1 })]).primary).toBeUndefined()
  })
})

describe('deriveScores', () => {
  const correct: ScoreDefinedData = { name: 'correct' }
  const natural: ScoreDefinedData = { name: 'natural' }

  /**
   * @example
   * all [correct, natural] -> 1 only when both are 1; a mixed reading (0.5) fails without a threshold.
   */
  it('derives all as binary with a default threshold of 1', () => {
    const pass: ScoreDefinedData = { combine: { inputs: [{ name: 'correct' }, { name: 'natural' }], kind: 'all' }, name: 'pass' }

    expect(deriveScores([correct, natural, pass], { correct: 1, natural: 1 }, {})).toEqual([{ name: 'pass', value: 1 }])
    expect(deriveScores([correct, natural, pass], { correct: 1, natural: 0.5 }, {})).toEqual([{ name: 'pass', value: 0 }])
  })

  /**
   * @example
   * all [correct, { natural, atLeast: 0.5 }] -> a mixed reading passes.
   */
  it('passes an all input that reaches its own threshold', () => {
    const pass: ScoreDefinedData = { combine: { inputs: [{ name: 'correct' }, { atLeast: 0.5, name: 'natural' }], kind: 'all' }, name: 'pass' }

    expect(deriveScores([pass], { correct: 1, natural: 0.5 }, {})).toEqual([{ name: 'pass', value: 1 }])
    expect(deriveScores([pass], { correct: 1, natural: 0 }, {})).toEqual([{ name: 'pass', value: 0 }])
  })

  /**
   * @example
   * mean [0.5, 1] -> 0.75; weighted [0 x1, 1 x3] -> 0.75.
   */
  it('derives mean and weighted means', () => {
    expect(deriveScores([{ combine: { inputs: [{ name: 'a' }, { name: 'b' }], kind: 'mean' }, name: 'm' }], { a: 0.5, b: 1 }, {})).toEqual([{ name: 'm', value: 0.75 }])
    expect(deriveScores([{ combine: { inputs: [{ name: 'a', weight: 1 }, { name: 'b', weight: 3 }], kind: 'weighted' }, name: 'w' }], { a: 0, b: 1 }, {})).toEqual([{ name: 'w', value: 0.75 }])
  })

  /**
   * @example
   * a missing input -> no derived value; an unscored input -> unscored 'input_unscored'.
   */
  it('leaves a derived score out when an input is missing, and marks it unscored when an input is unscored', () => {
    const pass: ScoreDefinedData = { combine: { inputs: [{ name: 'correct' }, { name: 'natural' }], kind: 'all' }, name: 'pass' }

    expect(deriveScores([pass], { correct: 1 }, {})).toEqual([])
    expect(deriveScores([pass], { correct: 1 }, { natural: 'grader_failed' })).toEqual([{ name: 'pass', unscored: 'input_unscored' }])
  })

  /**
   * @example
   * a derived score may use a derived score declared before it.
   */
  it('chains derived scores in declaration order', () => {
    const both: ScoreDefinedData = { combine: { inputs: [{ name: 'a' }, { name: 'b' }], kind: 'all' }, name: 'both' }
    const final: ScoreDefinedData = { combine: { inputs: [{ name: 'both' }, { name: 'c' }], kind: 'mean' }, name: 'final' }

    expect(deriveScores([both, final], { a: 1, b: 1, c: 0 }, {})).toEqual([{ name: 'both', value: 1 }, { name: 'final', value: 0.5 }])
  })
})

describe('poolScoreSummaries', () => {
  /**
   * @example
   * runs of 1/1 and 0/3 pool to 1/4 = 0.25, not to the mean of means 0.5.
   */
  it('pools cases instead of averaging means', () => {
    const pooled = poolScoreSummaries([
      { mean: 1, n: 1, name: 'pass', sum: 1, total: 1, unscored: {} },
      { mean: 0, n: 3, name: 'pass', sum: 0, total: 4, unscored: { grader_failed: 1 } },
    ])

    expect(pooled).toEqual([{ mean: 0.25, n: 4, name: 'pass', sum: 1, total: 5, unscored: { grader_failed: 1 } }])
  })
})

describe('resolveHeadline', () => {
  const summary = (name: string, mean: number, n = 1) => ({ mean, n, name, sum: mean * n, total: n, unscored: {} })
  const task = (taskId: string, primary: string | undefined, scores: ReturnType<typeof summary>[]): HeadlineInput => ({
    completion: summary('completion', 1),
    passed: summary('passed', 1),
    ...(primary == null ? {} : { primary }),
    scores,
    taskId,
  })

  /**
   * @example
   * two tasks with primary `pass` -> one pooled `score` headline.
   */
  it('pools a primary score shared by every task', () => {
    const result = resolveHeadline([task('a', 'pass', [summary('pass', 1)]), task('b', 'pass', [summary('pass', 0)])])

    expect(result.headline).toEqual({ kind: 'score', score: { mean: 0.5, n: 2, name: 'pass', sum: 1, total: 2, unscored: {} } })
    expect(result.completion).toMatchObject({ mean: 1, n: 2 })
  })

  /**
   * @example
   * primary `pass` and primary `accuracy` -> `per-task`, one entry per task.
   */
  it('lists each task when the primary names differ', () => {
    const result = resolveHeadline([task('a', 'pass', [summary('pass', 1)]), task('b', 'accuracy', [summary('accuracy', 0.5)])])

    expect(result.headline).toEqual({
      kind: 'per-task',
      tasks: [{ score: summary('pass', 1), taskId: 'a' }, { score: summary('accuracy', 0.5), taskId: 'b' }],
    })
  })

  /**
   * @example
   * no task has a primary score -> `passed-cases`.
   */
  it('falls back to the share of passed cases', () => {
    const result = resolveHeadline([task('a', undefined, [])])

    expect(result.headline).toEqual({ kind: 'passed-cases', score: summary('passed', 1) })
  })

  /**
   * @example
   * no tasks -> passed-cases over no cases, completion over no cases.
   */
  it('resolves an empty group', () => {
    expect(resolveHeadline([])).toEqual({ completion: emptyScoreSummary('completion'), headline: { kind: 'passed-cases', score: emptyScoreSummary('passed') } })
  })
})

describe('isMeasuredState', () => {
  /**
   * @example
   * passed and failed produced a result; errored, timeout, and skipped did not.
   */
  it('tells results from no results', () => {
    expect(isMeasuredState('passed')).toBe(true)
    expect(isMeasuredState('failed')).toBe(true)
    expect(isMeasuredState('errored')).toBe(false)
    expect(isMeasuredState('timeout')).toBe(false)
    expect(isMeasuredState('skipped')).toBe(false)
  })
})
