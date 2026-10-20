import type { ScoreDefinedData } from '../../events'

/**
 * Terminal state of one case try, as `case.ended` reports it.
 *
 * - `passed`: the case ran to the end without a failed assertion
 * - `failed`: an assertion failed, so the case measured a wrong result
 * - `errored`: the case threw something other than an assertion (a provider error, a bug, an interrupt), so it
 *   measured nothing
 * - `timeout`: the case ran out of time, so it measured nothing
 * - `skipped`: the case did not run
 */
export type CaseOutcomeState = 'errored' | 'failed' | 'passed' | 'skipped' | 'timeout'

/**
 * Scores of a group of case outcomes, for example one task run.
 */
export interface CaseScoring {
  /**
   * Share of settled cases whose final outcome produced a result (`passed` or `failed`).
   */
  completion: ScoreSummary
  /**
   * Share of settled cases whose final outcome passed.
   */
  passed: ScoreSummary
  /**
   * Name of the headline score: the score declared `primary`, or the only score of the group.
   */
  primary?: string
  /**
   * One summary per score: declared scores in declaration order, then recorded-only names in name order.
   */
  scores: ScoreSummary[]
}

/**
 * One value the runtime derived from other scores of a case try.
 */
export type DerivedScore = { name: string, unscored: string } | { name: string, value: number }

/**
 * The resolved headline of a task, project, or run.
 *
 * - `score`: the primary score
 * - `passed-cases`: no score was recorded, so the share of passed cases
 * - `per-task`: the tasks have different primary scores, so each one is listed
 */
export type Headline
  = | { kind: 'passed-cases', score: ScoreSummary }
    | { kind: 'per-task', tasks: Array<{ score: ScoreSummary, taskId: string }> }
    | { kind: 'score', score: ScoreSummary }

/**
 * One task's scoring, as {@link resolveHeadline} reads it.
 */
export interface HeadlineInput extends CaseScoring {
  /**
   * Task the scoring belongs to.
   */
  taskId: string
}

/**
 * Headline and completion rate of a task, project, or run, written into results once so every reader shows the same.
 */
export interface HeadlineResult {
  /**
   * Share of settled cases that produced a result, shown next to the headline.
   */
  completion: ScoreSummary
  /**
   * The headline value.
   */
  headline: Headline
}

/**
 * One settled case outcome with the score values it recorded.
 */
export interface ScoredCaseOutcome {
  /**
   * Case the outcome belongs to. Outcomes of one case (one per auto attempt) share it, and only the last one counts
   * toward `completion` and `passed`. An outcome without it counts on its own.
   */
  caseId?: string
  /**
   * Score values of the outcome by name, recorded by the case or derived when its try settled.
   */
  scores: Readonly<Record<string, number>>
  /**
   * Terminal state of the outcome.
   */
  state: CaseOutcomeState
  /**
   * Scores the grader could not produce, by name, with the reason.
   */
  unscored: Readonly<Record<string, string>>
}

/**
 * Aggregate of one named value over a group of case outcomes, for example one score of one task.
 *
 * The same shape carries a declared score, the completion rate (`completion`), and the share of passed cases
 * (`passed`), so summaries of tasks, runs, and executors pool the same way.
 */
export interface ScoreSummary {
  /**
   * Mean over the counted cases (`sum / n`), or `null` when no case counted.
   */
  mean: null | number
  /**
   * Cases that counted toward `mean`.
   */
  n: number
  /**
   * Score name; `completion` and `passed` for the built-in summaries.
   */
  name: string
  /**
   * Sum of the counted values.
   */
  sum: number
  /**
   * Settled cases that were not skipped. `total - n` cases did not count: they were unscored, missing, or left out
   * by `errors: 'exclude'`.
   */
  total: number
  /**
   * Cases that did not count, per reason. For a score: the unscored reasons (`grader_failed`, ...). For
   * `completion`: `errored` and `timeout`, the states that produced no result.
   */
  unscored: Record<string, number>
}

/** Reason of a derived score whose input was unscored. */
const INPUT_UNSCORED = 'input_unscored'

/**
 * Counts the values of one case outcome with the scoring rule of vieval.
 *
 * Use when:
 * - one case's values must agree with the summaries of its task, for example a line of `cases.jsonl`, the spread
 *   under a matrix cell, or a point of a metric panel
 *
 * Expects:
 * - `definitions` to list every score of the case's task, so a failed case counts 0 even in a score only other cases
 *   recorded; a score without `score.defined` is a bare `{ name }`
 *
 * Returns:
 * - by score name: the recorded value of a `passed` outcome, 0 for a `failed` outcome, 0 for an `errored` or
 *   `timeout` outcome in a score with `errors: 'zero'`; a score the outcome does not count in (unscored, missing,
 *   left out, skipped) is absent
 */
export function countCase(outcome: ScoredCaseOutcome, definitions: readonly Pick<ScoreDefinedData, 'errors' | 'name'>[]): Record<string, number> {
  if (outcome.state === 'passed') {
    return Object.fromEntries(definitions.flatMap(({ name }) => outcome.unscored[name] == null && outcome.scores[name] != null ? [[name, outcome.scores[name]]] : []))
  }
  if (outcome.state === 'skipped') {
    return {}
  }
  return Object.fromEntries(definitions.flatMap(({ errors, name }) => outcome.state === 'failed' || errors === 'zero' ? [[name, 0]] : []))
}

/**
 * Computes the derived scores of one case try from the values it recorded.
 *
 * Use when:
 * - a case try settles and its derived scores (`score.defined` with `combine`) must be emitted
 *
 * Expects:
 * - `definitions` in declaration order; a derived score may use derived scores declared before it
 *
 * Returns:
 * - one entry per derived score whose inputs all exist: a value, or `unscored: 'input_unscored'` when an input was
 *   unscored. A derived score with a missing input is left out.
 *   - `all`: 1 when every input reaches its `atLeast` (default 1), else 0
 *   - `mean`: the mean of the inputs
 *   - `weighted`: the mean weighted by `weight` (default 1)
 */
export function deriveScores(
  definitions: readonly ScoreDefinedData[],
  values: Readonly<Record<string, number>>,
  unscored: Readonly<Record<string, string>>,
): DerivedScore[] {
  const knownValues: Record<string, number> = { ...values }
  const knownUnscored: Record<string, string> = { ...unscored }
  const derived: DerivedScore[] = []
  for (const definition of definitions) {
    const combine = definition.combine
    if (combine == null) {
      continue
    }
    const inputs = combine.inputs
    if (inputs.some(input => knownUnscored[input.name] != null)) {
      knownUnscored[definition.name] = INPUT_UNSCORED
      derived.push({ name: definition.name, unscored: INPUT_UNSCORED })
      continue
    }
    if (inputs.length === 0 || inputs.some(input => knownValues[input.name] == null)) {
      continue
    }

    let value: number
    if (combine.kind === 'all') {
      value = inputs.every(input => knownValues[input.name]! >= (input.atLeast ?? 1)) ? 1 : 0
    }
    else if (combine.kind === 'mean') {
      value = inputs.reduce((sum, input) => sum + knownValues[input.name]!, 0) / inputs.length
    }
    else {
      const totalWeight = inputs.reduce((sum, input) => sum + (input.weight ?? 1), 0)
      value = totalWeight === 0 ? 0 : inputs.reduce((sum, input) => sum + knownValues[input.name]! * (input.weight ?? 1), 0) / totalWeight
    }
    knownValues[definition.name] = value
    derived.push({ name: definition.name, value })
  }
  return derived
}

/**
 * Returns a summary of `name` over no cases.
 *
 * Use when:
 * - a group has no case outcomes, for example a custom task executor that reports scores but no completion
 */
export function emptyScoreSummary(name: string): ScoreSummary {
  return emptySummary(name, 0)
}

/**
 * Returns whether a case outcome produced a result.
 *
 * Use when:
 * - counting completion or deciding whether an outcome is a result
 *
 * Returns:
 * - `true` for `passed` and `failed`; `false` for `errored`, `timeout`, and `skipped`
 */
export function isMeasuredState(state: CaseOutcomeState): boolean {
  return state === 'passed' || state === 'failed'
}

/**
 * Pools summaries of the same name, for example one score over several task runs.
 *
 * Use when:
 * - combining task runs into a run, executor, or overall summary; cases are pooled, not task means averaged
 *
 * Returns:
 * - one summary per name, in first-seen order, with `sum`, `n`, `total`, and unscored counts added up
 */
export function poolScoreSummaries(summaries: readonly ScoreSummary[]): ScoreSummary[] {
  const pooled = new Map<string, ScoreSummary>()
  for (const summary of summaries) {
    const target = pooled.get(summary.name) ?? emptySummary(summary.name, 0)
    target.n += summary.n
    target.sum += summary.sum
    target.total += summary.total
    for (const [reason, count] of Object.entries(summary.unscored)) {
      target.unscored[reason] = (target.unscored[reason] ?? 0) + count
    }
    pooled.set(summary.name, target)
  }
  return [...pooled.values()].map(finalize)
}

/**
 * Resolves the headline of a group of task scorings.
 *
 * Use when:
 * - a task, project, or run result is written, or a viewer shows a live run; every reader uses this one rule
 *
 * Expects:
 * - every task run of the group; several runs of one task share a `taskId`
 *
 * Returns:
 * - `score` when every task that has scores shares one primary score name (its pooled summary)
 * - `per-task` when the primary names differ, with one pooled summary per task
 * - `passed-cases` when no task has a primary score
 * - the pooled completion rate in every case
 */
export function resolveHeadline(tasks: readonly HeadlineInput[]): HeadlineResult {
  const completion = poolScoreSummaries(tasks.map(task => task.completion))[0] ?? emptySummary('completion', 0)
  const primaries = tasks.flatMap((task) => {
    const score = task.primary == null ? undefined : task.scores.find(summary => summary.name === task.primary)
    return score == null ? [] : [{ score, taskId: task.taskId }]
  })

  if (primaries.length === 0) {
    const passed = poolScoreSummaries(tasks.map(task => task.passed))[0] ?? emptySummary('passed', 0)
    return { completion, headline: { kind: 'passed-cases', score: passed } }
  }
  if (new Set(primaries.map(({ score }) => score.name)).size === 1) {
    return { completion, headline: { kind: 'score', score: poolScoreSummaries(primaries.map(({ score }) => score))[0]! } }
  }

  const byTask = new Map<string, ScoreSummary[]>()
  for (const { score, taskId } of primaries) {
    byTask.set(taskId, [...(byTask.get(taskId) ?? []), score])
  }
  return {
    completion,
    headline: {
      kind: 'per-task',
      tasks: [...byTask].map(([taskId, scores]) => ({ score: poolScoreSummaries(scores)[0]!, taskId })),
    },
  }
}

/**
 * Scores a group of case outcomes with the scoring rule of vieval.
 *
 * Use when:
 * - a task, the CLI, or the viewer turns case outcomes into score summaries; all of them use this one rule
 *
 * Expects:
 * - only settled outcomes; running outcomes are left out by the caller
 * - every outcome of every attempt, so repeated attempts each add evidence
 * - `definitions` to be the scores the group announced; names recorded without a definition count with defaults
 *
 * Returns:
 * - per score, over every settled outcome that was not skipped:
 *   - `passed`: its recorded value counts; an unscored value is counted per reason; a missing value does not count
 *   - `failed`: 0, because an assertion failed and the case measured a wrong result
 *   - `errored` and `timeout`: 0 with `errors: 'zero'`, otherwise not counted
 * - `completion` (passed or failed over settled) and `passed` (passed over settled), over the final outcome of each
 *   case: an auto attempt adds evidence to the scores, but a case is one case in the completion rate, the same count
 *   as the case states a reader sees
 * - `primary`: the score declared primary, or the only score of the group
 */
export function scoreCases(outcomes: readonly ScoredCaseOutcome[], definitions: readonly ScoreDefinedData[] = []): CaseScoring {
  const declared = new Set(definitions.map(definition => definition.name))
  const recordedNames = new Set<string>()
  for (const outcome of outcomes) {
    Object.keys(outcome.scores).forEach(name => recordedNames.add(name))
    Object.keys(outcome.unscored).forEach(name => recordedNames.add(name))
  }
  // Every score of the group: a name recorded without a definition counts with the defaults.
  const scoreDefinitions = [
    ...definitions,
    ...[...recordedNames].filter(name => !declared.has(name)).sort().map(name => ({ name })),
  ]

  const settled = outcomes.filter(outcome => outcome.state !== 'skipped')
  const summaries = new Map(scoreDefinitions.map(definition => [definition.name, emptySummary(definition.name, settled.length)]))
  for (const outcome of settled) {
    const counted = countCase(outcome, scoreDefinitions)
    for (const [name, summary] of summaries) {
      const value = counted[name]
      const reason = outcome.state === 'passed' ? outcome.unscored[name] : undefined
      if (value != null) {
        addValue(summary, value)
      }
      else if (reason != null) {
        summary.unscored[reason] = (summary.unscored[reason] ?? 0) + 1
      }
    }
  }
  const scores = [...summaries.values()].map(finalize)

  // The last outcome of each case is its final state; outcomes arrive in settle order.
  const finals = new Map<object | string, ScoredCaseOutcome>()
  for (const outcome of settled) {
    finals.set(outcome.caseId ?? outcome, outcome)
  }
  const completion = emptySummary('completion', finals.size)
  const passed = emptySummary('passed', finals.size)
  for (const outcome of finals.values()) {
    addValue(completion, isMeasuredState(outcome.state) ? 1 : 0)
    addValue(passed, outcome.state === 'passed' ? 1 : 0)
    if (!isMeasuredState(outcome.state)) {
      completion.unscored[outcome.state] = (completion.unscored[outcome.state] ?? 0) + 1
    }
  }

  const primary = definitions.find(definition => definition.primary === true)?.name ?? (scores.length === 1 ? scores[0]!.name : undefined)
  return {
    completion: finalize(completion),
    passed: finalize(passed),
    ...(primary == null ? {} : { primary }),
    scores,
  }
}

function addValue(summary: ScoreSummary, value: number): void {
  summary.n += 1
  summary.sum += value
}

function emptySummary(name: string, total: number): ScoreSummary {
  return { mean: null, n: 0, name, sum: 0, total, unscored: {} }
}

function finalize(summary: ScoreSummary): ScoreSummary {
  return { ...summary, mean: summary.n === 0 ? null : summary.sum / summary.n }
}
