import type { AggregatedRunResults } from '../../runner/aggregate'
import type { MaxFailedRunsPolicyOptions } from './policies/max-failed-runs'
import type { PolicyScore, ResultPolicyViolation, ScoreThresholdPolicyOptions } from './policies/score-threshold'

import { evaluateMaxFailedRunsPolicy } from './policies/max-failed-runs'
import { evaluateScoreThresholdPolicy } from './policies/score-threshold'

/**
 * Configures result-processing policies for eval gating.
 */
export interface ProcessRunResultsOptions {
  /**
   * Hard-limit failed-run policy options.
   */
  maxFailedRuns?: MaxFailedRunsPolicyOptions
  /**
   * Threshold policy options.
   */
  threshold?: ScoreThresholdPolicyOptions
}

/**
 * Final gate decision returned by result processors.
 */
export interface ResultGateDecision {
  /**
   * Whether the result batch passes all policies.
   */
  pass: boolean
  /**
   * Collected policy violations.
   */
  violations: ResultPolicyViolation[]
}

/**
 * Processes aggregated run results through built-in gating policies.
 *
 * Call stack:
 *
 * {@link runScheduledTasks}
 *   -> {@link aggregateRunResults}
 *     -> {@link processRunResults}
 *       -> {@link evaluateScoreThresholdPolicy}
 *       -> {@link evaluateMaxFailedRunsPolicy}
 *         -> {@link ResultGateDecision}
 */
export function processRunResults(
  results: AggregatedRunResults,
  options: ProcessRunResultsOptions = {},
): ResultGateDecision {
  const thresholdViolations = evaluateScoreThresholdPolicy(results, options.threshold)
  const maxFailedRunsViolations = evaluateMaxFailedRunsPolicy(results, options.maxFailedRuns)

  const violations = [
    ...thresholdViolations,
    ...maxFailedRunsViolations,
  ]

  return {
    pass: violations.length === 0,
    violations,
  }
}

export type {
  MaxFailedRunsPolicyOptions,
  PolicyScore,
  ResultPolicyViolation,
  ScoreThresholdPolicyOptions,
}
