import type { RunResult } from '../../runner/aggregate'
import type { ScoreSummary } from '../../scoring'

import { describe, expect, it } from 'vitest'

import { aggregateRunResults } from '../../runner/aggregate'
import { processRunResults } from './index'

function run(id: string, passMean: number, extra: ScoreSummary[] = []): RunResult {
  return {
    completion: summary('completion', 10, 10),
    entryId: 'evals/formula',
    id,
    inferenceExecutorId: 'openai:gpt-4.1-mini',
    matrix: { eval: {}, meta: { evalRowId: 'default', runRowId: 'default' }, run: {} },
    passed: summary('passed', 10, 10),
    primary: 'pass',
    scores: [summary('pass', passMean * 10, 10), ...extra],
  }
}

function summary(name: string, sum: number, n: number): ScoreSummary {
  return { mean: n === 0 ? null : sum / n, n, name, sum, total: n, unscored: {} }
}

describe('processRunResults', () => {
  /**
   * @example
   * primary pass 0.8 and 0.7 -> overall 0.75 and per-run means above the defaults: no violation.
   */
  it('passes when the primary score meets the threshold and hard-limit policies', () => {
    const decision = processRunResults(aggregateRunResults([run('run-1', 0.8), run('run-2', 0.7)]))

    expect(decision.pass).toBe(true)
    expect(decision.violations).toEqual([])
  })

  /**
   * @example
   * primary pass 0.5 -> overall and executor below 0.7 / 0.6.
   */
  it('fails the threshold policy when the primary score is below the limits', () => {
    const decision = processRunResults(aggregateRunResults([run('run-1', 0.5)]), { maxFailedRuns: { maxFailedRuns: 1 } })

    expect(decision.pass).toBe(false)
    expect(decision.violations).toEqual([
      { policyId: 'threshold:overall', reason: 'Overall pass mean 0.5 is below 0.7.' },
      { policyId: 'threshold:inferenceExecutor', reason: 'Provider openai:gpt-4.1-mini pass mean 0.5 is below 0.6.' },
    ])
  })

  /**
   * @example
   * threshold.score = 'latency_ok' gates on that score instead of the primary one.
   */
  it('gates on a named score when the policy names one', () => {
    const decision = processRunResults(aggregateRunResults([run('run-1', 0.9, [summary('latency_ok', 2, 10)])]), {
      maxFailedRuns: { maxFailedRuns: 1, score: 'latency_ok' },
      threshold: { score: { name: 'latency_ok' } },
    })

    expect(decision.violations.map(violation => violation.reason)).toEqual([
      'Overall latency_ok mean 0.2 is below 0.7.',
      'Provider openai:gpt-4.1-mini latency_ok mean 0.2 is below 0.6.',
    ])
  })

  /**
   * @example
   * runs without a primary score -> each group reports that it has no primary score.
   */
  it('reports a violation when there is no primary score to gate on', () => {
    const results = aggregateRunResults([{ ...run('run-1', 1), primary: undefined, scores: [summary('a', 1, 1), summary('b', 1, 1)] }])
    const decision = processRunResults(results, { maxFailedRuns: { maxFailedRuns: 1 } })

    expect(decision.violations).toEqual([
      { policyId: 'threshold:overall', reason: 'Overall has no primary score.' },
      { policyId: 'threshold:inferenceExecutor', reason: 'Provider openai:gpt-4.1-mini has no primary score.' },
    ])
  })

  /**
   * @example
   * two runs below minRunScore 0.6 with maxFailedRuns 1 -> one hard-limit violation.
   */
  it('fails the hard-limit policy when failed runs exceed maxFailedRuns', () => {
    const decision = processRunResults(aggregateRunResults([run('run-1', 0.5), run('run-2', 0.4), run('run-3', 1)]), {
      maxFailedRuns: { maxFailedRuns: 1 },
      threshold: { minOverall: 0, minPerExecutor: 0 },
    })

    expect(decision.violations).toEqual([{
      policyId: 'hard-limit:max-failed-runs',
      reason: 'Failed runs 2 exceed maxFailedRuns 1 with minRunScore 0.6.',
    }])
  })
})
