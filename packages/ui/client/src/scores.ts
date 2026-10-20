import type { Grader } from 'vieval/events'

import type { CaseScores, CaseScoring, HeadlineResult, MetricDefinition, ScoreDefinition, ScoreSummary } from '../../src/shared/contract'
import type { InferenceCall } from '../../src/shared/inference'

import { formatScore } from './format'
import { localize } from './localize'

/**
 * Definition of one numeric column of the case charts and tables: a metric's `metric.defined`, or a score's
 * `score.defined` read as a metric (higher is better, no unit) with the score definition kept in `score`.
 */
export interface ColumnDefinition extends MetricDefinition {
  /** How a derived score combines its inputs, with their labels ({@link formulaText}). */
  formula?: string
  /** Present when the column is a score: its values are `0..1` and are shown as a percentage. */
  score?: ScoreDefinition
}

/** One task's headline score of a `per-task` headline, with its label resolved. */
export interface HeadlineTask {
  definition?: ScoreDefinition
  label: string
  summary: ScoreSummary
  taskId: string
}

/** What a headline shows, resolved for display: the label and value of the headline, and the completion rate beside it. */
export interface HeadlineView {
  /** Share of settled cases that produced a result; shown next to the headline everywhere. */
  completion: ScoreSummary
  /** Definition of the headline score; absent for `passed-cases` and `per-task`. */
  definition?: ScoreDefinition
  kind: HeadlineResult['headline']['kind']
  /** Localized label of the primary score, `Passed cases`, or, for `per-task`, `completed`. */
  label: string
  /** Summary of the headline value; the completion rate for `per-task`. */
  summary: ScoreSummary
  /** Each task's primary score, for `per-task` only. */
  tasks: HeadlineTask[]
}

/**
 * Labels of the suggested unscored reasons (`recordUnscored`), and of the reasons a case leaves the completion rate
 * (`errored`, `timeout`); any other reason is shown as written.
 */
const UNSCORED_REASONS: Record<string, string> = {
  errored: 'errored',
  grader_failed: 'grader failed',
  input_unscored: 'input unscored',
  invalid_response: 'invalid response',
  no_response: 'no response',
  refusal: 'refusal',
  timeout: 'timed out',
}

/** Shown instead of a score label when a group of cases records no score: its headline is the share of passed cases. */
const PASSED_CASES_LABEL = 'Passed cases'

/**
 * Formats the value of one score of one case: the value as a percentage, the unscored reason, or `—`.
 *
 * Before:
 * - ({ values: { pass: 1 }, unscored: {} }, 'pass'), ({ values: {}, unscored: { natural: 'grader_failed' } }, 'natural')
 *
 * After:
 * - "100.0%", "grader failed"
 */
export function caseScoreText(scores: CaseScores, name: string): string {
  const reason = scores.unscored[name]
  if (reason != null)
    return unscoredReasonLabel(reason)
  return formatScore(scores.values[name])
}

/**
 * The two parts of {@link completionText}, so a narrow column can wrap between them and never inside one.
 *
 * Before:
 * - { mean: 0.968, unscored: { errored: 4 } }
 *
 * After:
 * - { rate: "completed 96.8%", reasons: "(4 errored)" }
 */
export function completionParts(completion: ScoreSummary): { rate: string, reasons?: string } {
  const parts = [
    completion.unscored.errored ? `${completion.unscored.errored} errored` : undefined,
    completion.unscored.timeout ? `${completion.unscored.timeout} timed out` : undefined,
  ].filter(Boolean)
  const rate = `completed ${formatScore(completion.mean)}`
  return parts.length > 0 ? { rate, reasons: `(${parts.join(', ')})` } : { rate }
}

/**
 * Formats the completion rate of a headline with the cases that produced no result.
 *
 * Before:
 * - { mean: 0.968, unscored: { errored: 4 } }, { mean: 1, unscored: {} }
 *
 * After:
 * - "completed 96.8% (4 errored)", "completed 100.0%"
 */
export function completionText(completion: ScoreSummary): string {
  const { rate, reasons } = completionParts(completion)
  return reasons == null ? rate : `${rate} ${reasons}`
}

/**
 * Formats how a derived score combines other scores, with their labels.
 *
 * Before:
 * - { kind: 'all', inputs: [{ name: 'correct' }, { atLeast: 0.5, name: 'natural' }] }
 * - { kind: 'weighted', inputs: [{ name: 'a', weight: 2 }, { name: 'b', weight: 1 }] }
 *
 * After:
 * - "all of: correct, natural ≥ 50%"
 * - "weighted: a ×2, b ×1"
 */
export function formulaText(definition: ScoreDefinition | undefined, definitions: readonly ScoreDefinition[]): string | undefined {
  const combine = definition?.combine
  if (combine == null)
    return undefined
  const inputs = combine.inputs.map((input) => {
    const label = scoreLabel(input.name, definitions)
    if (combine.kind === 'all')
      return input.atLeast == null || input.atLeast >= 1 ? label : `${label} ≥ ${Math.round(input.atLeast * 100)}%`
    if (combine.kind === 'weighted')
      return `${label} ×${input.weight ?? 1}`
    return label
  })
  const prefix = { all: 'all of', mean: 'mean of', weighted: 'weighted' }[combine.kind]
  return `${prefix}: ${inputs.join(', ')}`
}

/**
 * Whether two graders measure differently: their kind, model, or version differ. Two values of one score from such
 * graders do not measure the same thing, so a comparison warns about them.
 */
export function gradersDiffer(left: Grader | undefined, right: Grader | undefined): boolean {
  if (left == null || right == null)
    return false
  return left.kind !== right.kind || left.model !== right.model || left.version !== right.version
}

/**
 * Formats what produced a score value.
 *
 * Before:
 * - { kind: 'model', model: 'gpt-5.5', reducer: 'median', votes: 3 }, { kind: 'rule', version: '2' }
 *
 * After:
 * - "model · gpt-5.5 · 3 votes, median", "rule · version 2"
 */
export function graderText(grader: Grader): string {
  const votes = grader.votes == null ? undefined : `${grader.votes} ${grader.votes === 1 ? 'vote' : 'votes'}${grader.reducer == null ? '' : `, ${grader.reducer}`}`
  return [grader.kind, grader.model, grader.version == null ? undefined : `version ${grader.version}`, votes ?? grader.reducer].filter(Boolean).join(' · ')
}

/**
 * Headline of one group of cases (a task, a matrix cell) from its scores: the primary score, or the passed cases when
 * it has none.
 *
 * Use when:
 * - a view holds a task's `CaseScoring` (task nodes, matrix cells) and shows it like a run headline
 *
 * Expects:
 * - `scoring.primary` resolved by the server (`scoreCases`); this does not pick a primary itself
 *
 * Returns:
 * - a `score` headline when the primary score has a summary, else `passed-cases`
 */
export function headlineOf(scoring: CaseScoring): HeadlineResult {
  const primary = scoring.primary == null ? undefined : scoring.scores.find(summary => summary.name === scoring.primary)
  return {
    completion: scoring.completion,
    headline: primary == null ? { kind: 'passed-cases', score: scoring.passed } : { kind: 'score', score: primary },
  }
}

/**
 * The single value of a headline for a trend or a sort: the mean of its score; `null` for a `per-task` headline,
 * whose tasks have different primary scores.
 */
export function headlineValue(result: HeadlineResult | null | undefined): null | number {
  if (result == null || result.headline.kind === 'per-task')
    return null
  return result.headline.score.mean
}

/**
 * Resolves a headline for display: the localized label of its score and the completion rate.
 *
 * Use when:
 * - any page shows a run's, task's, or matrix cell's headline (`HeadlineScore.vue`, switchers, chart series)
 *
 * Expects:
 * - `definitions` hold the `score.defined` of the headline's scores (`headlineDefinitions`, `scoreDefinitions`)
 *
 * Returns:
 * - for `per-task`, the completion rate as the value, labelled `completed`, and each task's primary score
 */
export function headlineView(result: HeadlineResult, definitions: readonly ScoreDefinition[]): HeadlineView {
  const { completion, headline } = result
  if (headline.kind === 'per-task') {
    const tasks = headline.tasks.map(task => ({ definition: scoreDefinition(task.score.name, definitions), label: scoreLabel(task.score.name, definitions), summary: task.score, taskId: task.taskId }))
    return { completion, kind: headline.kind, label: 'completed', summary: completion, tasks }
  }
  if (headline.kind === 'passed-cases')
    return { completion, kind: headline.kind, label: PASSED_CASES_LABEL, summary: headline.score, tasks: [] }
  return { completion, definition: scoreDefinition(headline.score.name, definitions), kind: headline.kind, label: scoreLabel(headline.score.name, definitions), summary: headline.score, tasks: [] }
}

/**
 * Whether a model call was made by a grader: its provider id, or the `role` of the request data the eval attached,
 * is the grader's `id` (a judge's calls report usage through the same `inference.*` events as the case's own calls).
 *
 * Use when:
 * - a score links to the calls of its grader, and the inference panel narrows to them
 */
export function isGraderCall(call: Pick<InferenceCall, 'provider' | 'request'>, graderId: string): boolean {
  if (call.provider?.id === graderId)
    return true
  const request = call.request
  return typeof request === 'object' && request != null && 'role' in request && request.role === graderId
}

/**
 * Picks the headline score among the score names of a group of cases: the one defined `primary`, else the only score.
 *
 * Use when:
 * - a client-side view of cases (the case charts, a run-wide table) needs the score its outcome is read by
 *
 * Returns:
 * - `undefined` when no score is primary and there is not exactly one, or when the cases' tasks name different
 *   primary scores (a run-wide table of several evals)
 */
export function primaryScoreName(definitions: readonly ScoreDefinition[], names: readonly string[]): string | undefined {
  const primaries = [...new Set(definitions.filter(definition => definition.primary === true && names.includes(definition.name)).map(definition => definition.name))]
  if (primaries.length === 1)
    return primaries[0]
  return primaries.length === 0 && names.length === 1 ? names[0] : undefined
}

/**
 * Reads a score's `score.defined` as a column of the case charts and hover cards: higher is better, values shown as a
 * percentage, and the formula of a derived score spelled out with the labels of `definitions`.
 */
export function scoreColumn(definition: ScoreDefinition, definitions: readonly ScoreDefinition[]): ColumnDefinition {
  return { better: 'higher', description: definition.description, formula: formulaText(definition, definitions), label: definition.label, name: definition.name, score: definition }
}

export function scoreDefinition(name: string, definitions: readonly ScoreDefinition[]): ScoreDefinition | undefined {
  return definitions.findLast(definition => definition.name === name)
}

/** Readable name of a score: its localized label, else its name. */
export function scoreLabel(name: string, definitions: readonly ScoreDefinition[]): string {
  return localize(scoreDefinition(name, definitions)?.label) ?? name
}

/**
 * Normalizes an unscored reason code into its label; unknown reasons stay as written.
 *
 * Before:
 * - "grader_failed", "judge timed out"
 *
 * After:
 * - "grader failed", "judge timed out"
 */
export function unscoredReasonLabel(reason: string): string {
  return UNSCORED_REASONS[reason] ?? reason
}

/**
 * Formats the cases that recorded a score as unscored, per reason, largest first.
 *
 * Before:
 * - { refusal: 1, grader_failed: 2 }
 *
 * After:
 * - "2 grader failed, 1 refusal"
 */
export function unscoredText(unscored: Readonly<Record<string, number>>): string {
  return Object.entries(unscored).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).map(([reason, count]) => `${count} ${unscoredReasonLabel(reason)}`).join(', ')
}
