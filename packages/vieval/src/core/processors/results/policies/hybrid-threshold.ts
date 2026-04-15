import type { AggregatedRunResults } from '../../../runner/aggregate'

/**
 * Violation emitted when result policies fail.
 */
export interface ResultPolicyViolation {
  /**
   * Stable policy id.
   */
  policyId: string
  /**
   * Human-readable violation reason.
   */
  reason: string
}

/**
 * Configures hybrid-threshold policy behavior.
 */
export interface HybridThresholdPolicyOptions {
  /**
   * Minimum required overall hybrid score.
   *
   * @default 0.7
   */
  minOverallHybridScore?: number
  /**
   * Minimum required inferenceExecutor hybrid score.
   *
   * @default 0.6
   */
  minProviderHybridScore?: number
}

/**
 * Evaluates threshold policy against aggregated results.
 */
export function evaluateHybridThresholdPolicy(
  results: AggregatedRunResults,
  options: HybridThresholdPolicyOptions = {},
): ResultPolicyViolation[] {
  const minOverallHybridScore = options.minOverallHybridScore ?? 0.7
  const minProviderHybridScore = options.minProviderHybridScore ?? 0.6

  const violations: ResultPolicyViolation[] = []

  const overallHybridAverage = results.overall.hybridAverage
  if (overallHybridAverage == null || overallHybridAverage < minOverallHybridScore) {
    violations.push({
      policyId: 'threshold:overall-hybrid',
      reason: `Overall hybrid average ${overallHybridAverage ?? 'null'} is below ${minOverallHybridScore}.`,
    })
  }

  for (const inferenceExecutor of results.inferenceExecutors) {
    if (inferenceExecutor.hybridAverage == null || inferenceExecutor.hybridAverage < minProviderHybridScore) {
      violations.push({
        policyId: 'threshold:inferenceExecutor-hybrid',
        reason: `Provider ${inferenceExecutor.inferenceExecutorId} hybrid average ${inferenceExecutor.hybridAverage ?? 'null'} is below ${minProviderHybridScore}.`,
      })
    }
  }

  return violations
}
