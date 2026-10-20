import type { AggregatedRunResults } from '../../../runner/aggregate'
import type { ScoreSummary } from '../../../scoring'

/**
 * Score a policy gates on: a score name, or a definition from `defineScore`. Omitted, the primary score.
 */
export type PolicyScore = string | { name: string }

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
 * Configures score-threshold policy behavior.
 */
export interface ScoreThresholdPolicyOptions {
  /**
   * Minimum required overall mean of the score.
   *
   * @default 0.7
   */
  minOverall?: number
  /**
   * Minimum required mean of the score for each inference executor.
   *
   * @default 0.6
   */
  minPerExecutor?: number
  /**
   * Score to gate on.
   *
   * @default the primary score of each group
   */
  score?: PolicyScore
}

/**
 * Evaluates the score-threshold policy against aggregated results.
 *
 * Returns:
 * - one violation per group whose gated score is below its threshold, has no value, or does not exist
 */
export function evaluateScoreThresholdPolicy(
  results: AggregatedRunResults,
  options: ScoreThresholdPolicyOptions = {},
): ResultPolicyViolation[] {
  const minOverall = options.minOverall ?? 0.7
  const minPerExecutor = options.minPerExecutor ?? 0.6
  const violations: ResultPolicyViolation[] = []

  const groups = [
    { id: 'threshold:overall', label: 'Overall', min: minOverall, summary: results.overall },
    ...results.inferenceExecutors.map(executor => ({ id: 'threshold:inferenceExecutor', label: `Provider ${executor.inferenceExecutorId}`, min: minPerExecutor, summary: executor })),
  ]
  for (const { id, label, min, summary } of groups) {
    const primary = summary.headline.headline.kind === 'score' ? summary.headline.headline.score.name : undefined
    const score = selectPolicyScore(summary.scores, primary, options.score)
    if (score == null) {
      violations.push({ policyId: id, reason: `${label} has no ${options.score == null ? 'primary score' : 'score to gate on'}.` })
      continue
    }
    if (score.mean == null || score.mean < min) {
      violations.push({ policyId: id, reason: `${label} ${score.name} mean ${score.mean ?? 'null'} is below ${min}.` })
    }
  }
  return violations
}

/**
 * Selects the gated score of one group.
 *
 * Use when:
 * - a result policy reads one score of a run, an executor, or the overall group
 *
 * Returns:
 * - the summary named by `score`, or else the group's primary summary; `undefined` when the group has neither
 */
export function selectPolicyScore(scores: readonly ScoreSummary[], primary: string | undefined, score: PolicyScore | undefined): ScoreSummary | undefined {
  const name = score == null ? primary : typeof score === 'string' ? score : score.name
  return name == null ? undefined : scores.find(summary => summary.name === name)
}
