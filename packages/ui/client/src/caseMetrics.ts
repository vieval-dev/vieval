import type { ScaleContinuousNumeric } from 'd3'

import type { CaseNode, CaseState, MetricDefinition, MetricsResponse, ScoreDefinition } from '../../src/shared/contract'
import type { ColumnDefinition } from './scores'

import { scaleLinear, scaleSymlog } from 'd3'

import { parseTaskId } from '../../src/shared/reduce'
import { formatScore } from './format'
import { localize } from './localize'
import { primaryScoreName, scoreColumn } from './scores'

/** One case of a task, flattened for the multi-metric charts (parallel coordinates, scatterplot matrix). */
export interface CaseRow {
  caseId: string
  /** Category values by axis name; always has `state`. */
  categories: Record<string, string>
  /** `CaseNode.key`, unique within a run. */
  key: string
  name: string
  /** Numeric values by metric name; a metric the case did not record is absent. */
  numbers: Record<string, number>
  state: CaseState
  /** Task the case belongs to; a run-wide table mixes the cases of every task. */
  taskId: string
}

/** Cases of one task with the metric axes the charts can draw. */
export interface CaseTable {
  /**
   * Category axes: `state` first, then the case group (name prefix), low-cardinality string metrics, and numeric
   * metrics with exactly two values.
   */
  categories: string[]
  /** Numeric metrics with one value across every case; not worth an axis. */
  constants: { name: string, value: number }[]
  /** Categories (two-valued metrics included) that split the cases exactly like an earlier category; hidden. */
  duplicates: { name: string, of: string }[]
  /** Every non-constant numeric metric, grouped by correlation; the representatives are the default axes. */
  groups: MetricGroup[]
  /** Numeric metrics whose largest value is far above the median; charts draw them on a symlog scale. */
  heavyTailed: Set<string>
  /** Score the cases are read by (see {@link primaryScoreName}); `undefined` without one. */
  primary?: string
  rows: CaseRow[]
  /** Names of the scores among the numeric values, the primary score first; they are axes like any metric. */
  scores: string[]
  /** Cases per value of each category axis, most frequent first (`state` in its usual order, passed first). */
  valueCounts: Record<string, Map<string, number>>
}

/** Metrics folded into one representative because they carry the same signal. */
export interface MetricGroup {
  /** Folded metrics with their correlation to the representative (in `log1p` space). */
  members: { name: string, r: number }[]
  /** The metric drawn for the whole group. */
  representative: string
}

/** Case states in the order the charts list them: outcomes first, then cases that did not finish. */
const STATE_ORDER = ['passed', 'failed', 'errored', 'timeout', 'skipped', 'running', 'unfinished']
/** Correlation above which two metrics count as the same signal (token totals that grow with every step, …). */
const SAME_SIGNAL_R = 0.95
/** Categories with more values than this are identifiers (hashes, paths), not a breakdown worth an axis. */
const MAX_CATEGORY_VALUES = 24
/** A metric whose max is this many times its median gets a symlog scale, so the bulk of cases is not squashed. */
const HEAVY_TAIL_RATIO = 12

/** Brushed ranges, picked categories, and the scatterplot box that together select cases. */
export interface CaseFilters {
  /** One rectangle drawn in a scatterplot cell. */
  box: null | { x: string, x0: number, x1: number, y: string, y0: number, y1: number }
  /** Picked values per category axis; an empty or missing set does not filter. */
  categories: Record<string, Set<string>>
  /** Inclusive `[low, high]` per numeric axis. */
  ranges: Record<string, [number, number]>
}

/** Summaries drawn for a metric recorded as a list of numbers per case. */
export type DerivedSummary = 'length' | 'mean'

/**
 * How well one metric tells failed cases from passed ones, or, when every case ended the same way, lower-scored
 * cases from higher-scored ones.
 */
export interface MetricSeparation {
  /**
   * Area under the ROC curve, folded to `0.5..1`: the chance that a random case of each outcome is told apart by this
   * metric alone (`0.5`: no better than a coin, `1`: every case of one outcome lies on one side).
   */
  auc: number
  /** Which outcome has the larger values: a case state, or the lower / higher primary score. */
  higherIn: 'failed' | 'higher-scored' | 'lower-scored' | 'passed'
}

/**
 * Joins the cases of a task with their recorded metrics, and groups the metrics so the charts start from the
 * independent signals.
 *
 * Use when:
 * - a task or run view draws every case against several metrics at once
 *
 * Expects:
 * - `metrics` scoped to the same cases (`GET /api/runs/:runKey/metrics`, with `?taskId=` for one task); points are
 *   matched to cases by task id and case id
 *
 * Returns:
 * - one row per case with the value of its last round for every metric and every score (the counted value of
 *   `metrics.scores`, else the recorded value of the case); built-in axes `duration_s`, `state`, `group` (the name
 *   prefix before `/`, when names share that shape), and the eval `entry` and the run and eval matrix axes of the
 *   case's task (they split the cases only when several tasks are in the table)
 * - metrics recorded as a list of numbers per case summarized as `<name>#mean` and `<name>#length`
 * - constant metrics split out, and correlated metrics (|r| ≥ 0.95 on `log1p` values) folded into the first of
 *   them in recording order: scores first (the primary leads), then the built-ins, then the recorded metrics
 */
export function buildCaseTable(cases: readonly CaseNode[], metrics: MetricsResponse | undefined): CaseTable {
  // Keyed like `CaseNode.key` (task id, NUL, case id): one case id repeats in every task of a run (an OSWorld question
  // under each matrix combination), so the case id alone would mix the tasks' metrics on a run-wide table.
  const byCase = new Map<string, { numbers: Record<string, number>, rounds: Record<string, number>, strings: Record<string, string> }>()
  const entryOf = (taskId: string | undefined, caseId: string) => {
    const key = `${taskId ?? ''}\u0000${caseId}`
    let entry = byCase.get(key)
    if (entry == null) {
      entry = { numbers: {}, rounds: {}, strings: {} }
      byCase.set(key, entry)
    }
    return entry
  }
  // A case retried by auto attempts records a metric once per round; the last round is the one its state reports.
  for (const series of metrics?.numeric ?? []) {
    for (const point of series.points) {
      if (point.caseId == null)
        continue
      const entry = entryOf(point.taskId, point.caseId)
      const round = point.roundIndex ?? 0
      if ((entry.rounds[series.name] ?? -1) <= round) {
        entry.rounds[series.name] = round
        entry.numbers[series.name] = point.value as number
      }
    }
  }
  // Scores of the case's last round as the summaries count them (a failed case scores 0); a case left out of a score
  // (errored, unscored) has no point and so no value.
  const scoreNames: string[] = []
  for (const series of metrics?.scores ?? []) {
    scoreNames.push(series.name)
    for (const point of series.points) {
      const entry = entryOf(point.taskId, point.caseId)
      const round = point.roundIndex ?? 0
      if ((entry.rounds[series.name] ?? -1) <= round) {
        entry.rounds[series.name] = round
        entry.numbers[series.name] = point.value
      }
    }
  }
  // Without the metrics response (still loading), the cases' own recorded values stand in for the counted ones.
  if (metrics == null) {
    for (const node of cases) {
      for (const [name, value] of Object.entries(node.scores.values)) {
        if (!scoreNames.includes(name))
          scoreNames.push(name)
        entryOf(node.taskId, node.caseId).numbers[name] = value
      }
    }
  }
  const primary = primaryScoreName(metrics?.scoreDefinitions ?? [], scoreNames)
  const scores = primary == null ? scoreNames : [primary, ...scoreNames.filter(name => name !== primary)]
  const derivedNames: string[] = []
  for (const series of metrics?.nonNumeric ?? []) {
    for (const point of series.values) {
      if (point.caseId == null)
        continue
      // Flags (`gui_only: true`) split cases like any other category.
      if (typeof point.value === 'string' || typeof point.value === 'boolean') {
        entryOf(point.taskId, point.caseId).strings[series.name] = String(point.value)
        continue
      }
      // A list of numbers per case (the grade of each listener vote, every sample's reward) is drawn by its summaries.
      const values = numbersOf(point.value)
      if (values == null)
        continue
      const entry = entryOf(point.taskId, point.caseId)
      const round = point.roundIndex ?? 0
      for (const [summary, value] of [['mean', values.reduce((sum, item) => sum + item, 0) / values.length], ['length', values.length]] as const) {
        const name = derivedMetricName(series.name, summary)
        if (!derivedNames.includes(name))
          derivedNames.push(name)
        if ((entry.rounds[name] ?? -1) <= round) {
          entry.rounds[name] = round
          entry.numbers[name] = value
        }
      }
    }
  }

  const grouped = cases.length > 0 && cases.every(node => node.name.includes('/'))
  const rows: CaseRow[] = cases.map((node) => {
    const recorded = byCase.get(node.key)
    const numbers: Record<string, number> = { ...recorded?.numbers }
    if (node.durationMs != null)
      numbers.duration_s = node.durationMs / 1000
    // Built-ins first (key order is the default axis order), and they win over a recorded metric of the same name.
    // The matrix axes of the case's task (`tts`, `asr`, …): one value per task, so they split only a run-wide table.
    // The eval entry too (`…/formula-speech/en`, by its last path segment): one entry per language or dataset split.
    const { entryId, matrix } = parseTaskId(node.taskId)
    const builtIn: Record<string, string> = { ...(entryId == null ? {} : { entry: entryId.split('/').at(-1) ?? entryId }), ...matrix?.run, ...matrix?.eval, state: node.state }
    if (grouped)
      builtIn.group = node.name.slice(0, node.name.indexOf('/'))
    const categories: Record<string, string> = { ...builtIn, ...recorded?.strings, ...builtIn }
    return { caseId: node.caseId, categories, key: node.key, name: node.name, numbers, state: node.state, taskId: node.taskId }
  })

  const recordedNames = [...(metrics?.numeric ?? []).map(series => series.name), ...derivedNames]
  const numericNames = [...scores, 'duration_s', ...recordedNames].filter((name, index, all) => all.indexOf(name) === index && rows.some(row => row.numbers[name] != null))

  const constants: CaseTable['constants'] = []
  const groups: MetricGroup[] = []
  const heavyTailed = new Set<string>()
  for (const name of numericNames) {
    const values = rows.map(row => row.numbers[name]).filter((value): value is number => value != null)
    const distinct = new Set(values).size
    if (distinct <= 1) {
      constants.push({ name, value: values[0]! })
      continue
    }
    // Two values (a 0/1 score, a flag) split cases like a category; drawn as one, it can also be seen to repeat one.
    if (distinct === 2) {
      for (const row of rows) {
        if (row.numbers[name] != null)
          row.categories[name] = String(row.numbers[name])
      }
      continue
    }
    const sorted = values.toSorted((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]!
    if (sorted.at(-1)! / Math.max(1, median) > HEAVY_TAIL_RATIO && sorted[0]! >= 0)
      heavyTailed.add(name)
    let folded = false
    for (const group of groups) {
      const r = correlationOf(rows, group.representative, name)
      if (Math.abs(r) >= SAME_SIGNAL_R) {
        group.members.push({ name, r })
        folded = true
        break
      }
    }
    if (!folded)
      groups.push({ members: [], representative: name })
  }

  const categories: string[] = []
  const duplicates: CaseTable['duplicates'] = []
  const valueCounts: CaseTable['valueCounts'] = {}
  for (const name of new Set(rows.flatMap(row => Object.keys(row.categories)))) {
    const counts = new Map<string, number>()
    for (const row of rows) {
      const value = row.categories[name]
      if (value != null)
        counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    if (name !== 'state' && (counts.size < 2 || counts.size > MAX_CATEGORY_VALUES))
      continue
    const same = categories.find(other => sameSplit(rows, other, name))
    if (same != null) {
      duplicates.push({ name, of: same })
      continue
    }
    categories.push(name)
    // States in their usual order; numbers (a 0 / 1 score) low to high, so a chart that stacks values upward puts the
    // high end on top like on a metric axis; other values most frequent first.
    const numericValues = [...counts.keys()].every(value => value.trim() !== '' && Number.isFinite(Number(value)))
    const order = name === 'state'
      ? (value: string) => STATE_ORDER.indexOf(value)
      : numericValues ? (value: string) => Number(value) : (value: string) => -counts.get(value)!
    valueCounts[name] = new Map([...counts].sort(([a], [b]) => order(a) - order(b)))
  }
  return { categories, constants, duplicates, groups, heavyTailed, primary, rows, scores: scores.filter(name => rows.some(row => row.numbers[name] != null)), valueCounts }
}

/**
 * Definitions of every column of a case table by name: the metrics' `metric.defined`, and the scores' `score.defined`
 * read as columns ({@link scoreColumn}); a score wins over a metric of the same name.
 *
 * Use when:
 * - a chart, menu, or table labels and describes the columns of a {@link CaseTable} (`metricLabel`, `metricDefinition`)
 */
export function columnDefinitions(metricDefinitions: readonly MetricDefinition[], scoreDefinitions: readonly ScoreDefinition[]): Map<string, ColumnDefinition> {
  return new Map<string, ColumnDefinition>([
    ...metricDefinitions.map(definition => [definition.name, definition] as const),
    ...scoreDefinitions.map(definition => [definition.name, scoreColumn(definition, scoreDefinitions)] as const),
  ])
}

/**
 * Formats one value of a column for people: a score as a percentage, a metric rounded with its unit.
 *
 * Before:
 * - (0.875, score column), (48213, { unit: 'tokens' }), (1.23456, undefined)
 *
 * After:
 * - "87.5%", "48.2K tokens", "1.23"
 */
export function formatColumnValue(value: number, definition: ColumnDefinition | undefined): string {
  if (definition?.score != null)
    return formatScore(value)
  const text = Math.abs(value) >= 1000 ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, notation: 'compact' }).format(value) : String(Math.round(value * 100) / 100)
  return definition?.unit == null ? text : `${text} ${definition.unit}`
}

/** Separator between a list metric's name and its summary in a derived metric name; never part of a recorded name. */
const DERIVED_SEPARATOR = '#'

/**
 * Stable offset in `-0.5..0.5` for one case, so a dot keeps its spot inside a band (or a line its place on a category
 * axis) across redraws instead of jumping on every update. `salt` gives a case independent offsets per direction.
 *
 * Use when:
 * - spreading many cases that share one value (a category, the free direction of a strip) so they stay countable
 */
export function caseOffset(key: string, salt = 0): number {
  let hash = (salt + 1) * 2654435761
  for (let index = 0; index < key.length; index++)
    hash = Math.imul(hash ^ key.charCodeAt(index), 2654435761)
  return ((hash >>> 0) % 1000) / 1000 - 0.5
}

/**
 * Pearson correlation of two metrics over the cases that recorded both, on `log1p` values so token counts that span
 * several orders of magnitude are compared by shape, not by their few largest cases. `0` when either is flat.
 *
 * Use when:
 * - folding metrics that carry the same signal, or showing how every pair of metrics moves together (pairs view)
 */
export function correlationOf(rows: readonly CaseRow[], left: string, right: string): number {
  const pairs: [number, number][] = []
  for (const row of rows) {
    const a = row.numbers[left]
    const b = row.numbers[right]
    if (a != null && b != null)
      pairs.push([Math.sign(a) * Math.log1p(Math.abs(a)), Math.sign(b) * Math.log1p(Math.abs(b))])
  }
  if (pairs.length < 3)
    return 0
  let meanA = 0
  let meanB = 0
  for (const [a, b] of pairs) {
    meanA += a / pairs.length
    meanB += b / pairs.length
  }
  let covariance = 0
  let varianceA = 0
  let varianceB = 0
  for (const [a, b] of pairs) {
    covariance += (a - meanA) * (b - meanB)
    varianceA += (a - meanA) ** 2
    varianceB += (b - meanB) ** 2
  }
  return varianceA === 0 || varianceB === 0 ? 0 : covariance / Math.sqrt(varianceA * varianceB)
}

/**
 * Name of the numeric axis that summarizes a list metric.
 *
 * Before:
 * - "tts_speech_formula.votes", "mean"
 *
 * After:
 * - "tts_speech_formula.votes#mean"
 */
export function derivedMetricName(name: string, summary: DerivedSummary): string {
  return `${name}${DERIVED_SEPARATOR}${summary}`
}

/**
 * Whether a case passes every filter; a case without a value on a filtered numeric axis does not.
 *
 * Use when:
 * - the charts, the case list, and the selection summary decide which cases are selected
 */
export function matchesFilters(row: CaseRow, filters: CaseFilters): boolean {
  for (const [name, [low, high]] of Object.entries(filters.ranges)) {
    const value = row.numbers[name]
    if (value == null || value < low || value > high)
      return false
  }
  for (const [name, picked] of Object.entries(filters.categories)) {
    if (picked.size > 0 && !picked.has(row.categories[name] ?? ''))
      return false
  }
  const box = filters.box
  if (box != null) {
    const x = row.numbers[box.x]
    const y = row.numbers[box.y]
    if (x == null || y == null || x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1)
      return false
  }
  return true
}

/**
 * Definition of a metric for its hover card; a derived metric borrows the description of its list metric (and its
 * unit for the mean, not for the length).
 */
export function metricDefinition(name: string, definitions: ReadonlyMap<string, ColumnDefinition>): ColumnDefinition | undefined {
  const derived = parseDerivedMetric(name)
  const base = definitions.get(derived?.base ?? name)
  if (derived == null || base == null)
    return base
  return { ...base, label: metricLabel(name, definitions), name, unit: derived.summary === 'mean' ? base.unit : undefined }
}

/**
 * Readable name of a metric: the label it was defined with, else its name; a derived metric names its list metric and
 * the summary (`Listener votes · mean`).
 *
 * Use when:
 * - any chart, menu, or table names a metric of a {@link CaseTable}
 */
export function metricLabel(name: string, definitions: ReadonlyMap<string, ColumnDefinition>): string {
  const derived = parseDerivedMetric(name)
  if (derived != null)
    return `${metricLabel(derived.base, definitions)} · ${derived.summary}`
  return localize(definitions.get(name)?.label) ?? name
}

/**
 * Scale of one numeric metric over every case, shared by the charts so a brush means the same range in each.
 *
 * Use when:
 * - drawing an axis of a {@link CaseTable} metric; callers set the range (`scale.copy().range(…)`)
 *
 * Returns:
 * - a symlog scale for heavy-tailed metrics (zero stays drawable, unlike a log scale), else a linear one
 */
export function metricScale(table: CaseTable, name: string): ScaleContinuousNumeric<number, number> {
  let min = Infinity
  let max = -Infinity
  for (const row of table.rows) {
    const value = row.numbers[name]
    if (value == null)
      continue
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  if (!Number.isFinite(min))
    [min, max] = [0, 1]
  return table.heavyTailed.has(name) ? scaleSymlog().domain([min, max]) : scaleLinear().domain([min, max]).nice()
}

/**
 * Splits a derived metric name into the list metric and its summary; `undefined` for a recorded metric.
 *
 * Use when:
 * - labelling an axis (`Listener votes · mean`) or looking up the definition of the metric it summarizes
 */
export function parseDerivedMetric(name: string): undefined | { base: string, summary: DerivedSummary } {
  const at = name.lastIndexOf(DERIVED_SEPARATOR)
  const summary = name.slice(at + 1)
  return at > 0 && (summary === 'mean' || summary === 'length') ? { base: name.slice(0, at), summary } : undefined
}

/**
 * Ranks numeric metrics by how well they separate failed from passed cases.
 *
 * Use when:
 * - choosing which axes to show first, so the chart opens on the metrics most likely to explain failures
 *
 * Expects:
 * - finished cases (`passed`, `failed`, `errored`, `timeout`); running and skipped cases are left out
 *
 * Returns:
 * - one entry per non-constant metric with values in both outcomes, except the scores; ties count half
 *   (Mann–Whitney U), so a metric that is mostly 0 in both outcomes stays near `0.5`
 * - when no finished case failed (a scored eval, where a score of 0 is a result, not a failure), the outcomes are the
 *   cases below the mean primary score against the rest, so the ranking still explains what lowers the score
 */
export function separationOf(table: CaseTable): Map<string, MetricSeparation> {
  const result = new Map<string, MetricSeparation>()
  const finished = table.rows.filter(row => row.state === 'passed' || row.state === 'failed' || row.state === 'errored' || row.state === 'timeout')
  const outcome = outcomeOf(finished, table.primary)
  if (outcome == null)
    return result
  for (const name of table.groups.flatMap(group => [group.representative, ...group.members.map(member => member.name)])) {
    // Scores are the outcome itself, so ranking them by how they separate the outcome would explain nothing.
    if (table.scores.includes(name))
      continue
    const low: number[] = []
    const high: number[] = []
    for (const row of finished) {
      const value = row.numbers[name]
      const side = outcome.sideOf(row)
      if (value != null && side != null)
        (side === 'high' ? high : low).push(value)
    }
    if (low.length === 0 || high.length === 0)
      continue
    // U statistic by sorting both samples together: each low-outcome value counts the high-outcome values below it, ties half.
    const sortedHigh = high.toSorted((a, b) => a - b)
    let wins = 0
    for (const value of low) {
      let below = 0
      let tied = 0
      for (const other of sortedHigh) {
        if (other < value)
          below++
        else if (other === value)
          tied++
        else
          break
      }
      wins += below + tied / 2
    }
    const auc = wins / (low.length * high.length)
    result.set(name, { auc: Math.max(auc, 1 - auc), higherIn: auc >= 0.5 ? outcome.low : outcome.high })
  }
  return result
}

/**
 * Short label of a metric for a chart axis: the last dot segment, or more segments while two picked metrics would
 * share a label.
 *
 * Before:
 * - "osworld.model.usage.output_tokens_details.reasoning_tokens"
 *
 * After:
 * - "reasoning_tokens"
 */
export function shortMetricName(name: string, all: readonly string[]): string {
  const parts = name.split('.')
  for (let take = 1; take < parts.length; take++) {
    const label = parts.slice(-take).join('.')
    if (all.every(other => other === name || (!other.endsWith(`.${label}`) && other !== label)))
      return label
  }
  return name
}

/** The numbers of a recorded list value, or `undefined` when it is not a non-empty list of finite numbers. */
function numbersOf(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0)
    return undefined
  return value.every(item => typeof item === 'number' && Number.isFinite(item)) ? value as number[] : undefined
}

/**
 * The two outcomes the separation compares: failed against passed cases, or, with no failed case, cases below the
 * mean primary score against the rest. `undefined` when neither split has two sides.
 */
function outcomeOf(finished: readonly CaseRow[], primary: string | undefined): undefined | { high: MetricSeparation['higherIn'], low: MetricSeparation['higherIn'], sideOf: (row: CaseRow) => 'high' | 'low' | undefined } {
  if (finished.some(row => row.state === 'failed') && finished.some(row => row.state === 'passed'))
    return { high: 'passed', low: 'failed', sideOf: row => (row.state === 'passed' ? 'high' : 'low') }
  if (primary == null)
    return undefined
  const scores = finished.map(row => row.numbers[primary]).filter((value): value is number => value != null)
  if (new Set(scores).size < 2)
    return undefined
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length
  return {
    high: 'higher-scored',
    low: 'lower-scored',
    sideOf: (row) => {
      const value = row.numbers[primary]
      return value == null ? undefined : value < mean ? 'low' : 'high'
    },
  }
}

/** Whether two categories split the cases the same way, value for value (a 1/0 score against `state` passed/failed). */
function sameSplit(rows: readonly CaseRow[], left: string, right: string): boolean {
  const forward = new Map<string, string>()
  const backward = new Map<string, string>()
  for (const row of rows) {
    const a = row.categories[left] ?? ''
    const b = row.categories[right] ?? ''
    if ((forward.get(a) ?? b) !== b || (backward.get(b) ?? a) !== a)
      return false
    forward.set(a, b)
    backward.set(b, a)
  }
  return true
}
