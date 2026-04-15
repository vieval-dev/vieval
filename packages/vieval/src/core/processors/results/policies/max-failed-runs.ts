import type { AggregatedRunResults } from '../../../runner/aggregate'
import type { ResultPolicyViolation } from './hybrid-threshold'

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
   * Hybrid score threshold below which a run counts as failed.
   *
   * @default 0.6
   */
  minRunHybridScore?: number
}

/**
 * Evaluates hard-limit policy for failed runs.
 */
export function evaluateMaxFailedRunsPolicy(
  results: AggregatedRunResults,
  options: MaxFailedRunsPolicyOptions = {},
): ResultPolicyViolation[] {
  const maxFailedRuns = options.maxFailedRuns ?? 0
  const minRunHybridScore = options.minRunHybridScore ?? 0.6

  const failedRuns = results.runs.filter((run) => {
    if (run.hybridAverage == null) {
      return true
    }

    return run.hybridAverage < minRunHybridScore
  })

  if (failedRuns.length <= maxFailedRuns) {
    return []
  }

  return [{
    policyId: 'hard-limit:max-failed-runs',
    reason: `Failed runs ${failedRuns.length} exceed maxFailedRuns ${maxFailedRuns} with minRunHybridScore ${minRunHybridScore}.`,
  }]
}
