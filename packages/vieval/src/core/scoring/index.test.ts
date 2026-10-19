import { describe, expect, it } from 'vitest'

import { isMeasuredState, scoreCaseOutcomes, strictExactOf } from './index'

describe('scoreCaseOutcomes', () => {
  /**
   * @example
   * passed 1, passed 0.5, failed, errored, timeout -> exact 0.5 over 3 measured, strict exact 0.3 over 5.
   */
  it('scores measured cases in exact and every settled case in strict exact', () => {
    const scores = scoreCaseOutcomes([
      { scores: {}, state: 'passed' },
      { scores: { exact: 0.5 }, state: 'passed' },
      { scores: {}, state: 'failed' },
      { scores: {}, state: 'errored' },
      { scores: {}, state: 'timeout' },
    ])

    expect(scores.exact).toBe(0.5)
    expect(scores.coverage).toEqual({ measured: 3, total: 5 })
    expect(scores.strictExact).toBeCloseTo(0.3)
  })

  /**
   * @example
   * skipped outcomes stay out of both the score and the coverage.
   */
  it('leaves skipped cases out of the score and the coverage', () => {
    const scores = scoreCaseOutcomes([
      { scores: {}, state: 'passed' },
      { scores: {}, state: 'skipped' },
    ])

    expect(scores.exact).toBe(1)
    expect(scores.coverage).toEqual({ measured: 1, total: 1 })
  })

  /**
   * @example
   * every case errored -> exact null, strict exact 0.
   */
  it('has no exact score but a strict exact score of 0 when nothing was measured', () => {
    const scores = scoreCaseOutcomes([{ scores: {}, state: 'errored' }])

    expect(scores.exact).toBeNull()
    expect(scores.hybrid).toBeNull()
    expect(scores.strictExact).toBe(0)
  })

  /**
   * @example
   * judge scores come only from passed cases; hybrid averages exact and judge.
   */
  it('averages judge scores of passed cases into the hybrid score', () => {
    const scores = scoreCaseOutcomes([
      { scores: { judge: 0.5 }, state: 'passed' },
      { scores: {}, state: 'failed' },
    ])

    expect(scores.exact).toBe(0.5)
    expect(scores.judge).toBe(0.5)
    expect(scores.hybrid).toBe(0.5)
  })
})

describe('strictExactOf', () => {
  /**
   * @example
   * strictExactOf(0.8, { measured: 3, total: 4 }) -> 0.6
   */
  it('scales the measured mean by the measured share', () => {
    expect(strictExactOf(0.8, { measured: 3, total: 4 })).toBeCloseTo(0.6)
    expect(strictExactOf(null, { measured: 0, total: 2 })).toBe(0)
    expect(strictExactOf(null, { measured: 0, total: 0 })).toBeNull()
  })
})

describe('isMeasuredState', () => {
  /**
   * @example
   * passed and failed produced a result; errored, timeout, and skipped did not.
   */
  it('counts only passed and failed as measured', () => {
    expect(isMeasuredState('passed')).toBe(true)
    expect(isMeasuredState('failed')).toBe(true)
    expect(isMeasuredState('errored')).toBe(false)
    expect(isMeasuredState('timeout')).toBe(false)
    expect(isMeasuredState('skipped')).toBe(false)
  })
})
