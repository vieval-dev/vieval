import type { AggregatedRunResults } from '../../../runner/aggregate'
import type { PolicyScore, ResultPolicyViolation } from './score-threshold'

import { selectPolicyScore } from './score-threshold'

/**
 * Configures hard-limit policy for failed runs.
 */
export interface MaxFailedRunsPolicyOptions {
  /**
   * Maximum allowed failed run count.
   *
   * @default 0
   */
  maxFailedRuns?: number
  /**
   * Score mean below which a run counts as failed. A run without the score, or without a value, also counts as failed.
   *
   * @default 0.6
   */
  minRunScore?: number
  /**
   * Score to gate on.
   *
   * @default the primary score of each run
   */
  score?: PolicyScore
}

/**
 * Evaluates hard-limit policy for failed runs.
 */
export function evaluateMaxFailedRunsPolicy(
  results: AggregatedRunResults,
  options: MaxFailedRunsPolicyOptions = {},
): ResultPolicyViolation[] {
  const maxFailedRuns = options.maxFailedRuns ?? 0
  const minRunScore = options.minRunScore ?? 0.6

  const failedRuns = results.runs.filter((run) => {
    const mean = selectPolicyScore(run.scores, run.primary, options.score)?.mean
    return mean == null || mean < minRunScore
  })

  if (failedRuns.length <= maxFailedRuns) {
    return []
  }

  return [{
    policyId: 'hard-limit:max-failed-runs',
    reason: `Failed runs ${failedRuns.length} exceed maxFailedRuns ${maxFailedRuns} with minRunScore ${minRunScore}.`,
  }]
}
