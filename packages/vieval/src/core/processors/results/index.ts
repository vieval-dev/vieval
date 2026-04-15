import type { AggregatedRunResults } from '../../runner/aggregate'
import type { HybridThresholdPolicyOptions, ResultPolicyViolation } from './policies/hybrid-threshold'
import type { MaxFailedRunsPolicyOptions } from './policies/max-failed-runs'

import { evaluateHybridThresholdPolicy } from './policies/hybrid-threshold'
import { evaluateMaxFailedRunsPolicy } from './policies/max-failed-runs'

/**
 * Configures result-processing policies for eval gating.
 */
export interface ProcessRunResultsOptions {
  /**
   * Threshold policy options.
   */
  threshold?: HybridThresholdPolicyOptions
  /**
   * Hard-limit failed-run policy options.
   */
  maxFailedRuns?: MaxFailedRunsPolicyOptions
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
 *       -> {@link evaluateHybridThresholdPolicy}
 *       -> {@link evaluateMaxFailedRunsPolicy}
 *         -> {@link ResultGateDecision}
 */
export function processRunResults(
  results: AggregatedRunResults,
  options: ProcessRunResultsOptions = {},
): ResultGateDecision {
  const thresholdViolations = evaluateHybridThresholdPolicy(results, options.threshold)
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
  HybridThresholdPolicyOptions,
  MaxFailedRunsPolicyOptions,
  ResultPolicyViolation,
}
