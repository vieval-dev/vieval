import type { ComparisonCell, ComparisonResponse } from '../../src/shared/contract'
import type { ColumnDefinition } from './scores'

import { columnDefinitions, formatColumnValue, metricLabel } from './caseMetrics'
import { formatDuration, formatScore } from './format'
import { i18n } from './i18n'
import { orderScores, scoreLabel } from './scores'

/** 97.5% quantiles of Student's t for 1–30 degrees of freedom (see {@link meanInterval}). */
const T_975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042]

/** A quantity the comparison charts can put on an axis: a score, a numeric metric, or the case duration. */
export interface CompareAxis {
  /** Which way is better; `undefined` when the metric does not say (no Pareto front then). */
  better?: 'higher' | 'lower'
  kind: 'duration' | 'metric' | 'score'
  label: string
  /** Score or metric name; `duration` for the case duration. */
  name: string
}

/** Mean of a quantity over cases with its 95% confidence interval. */
export interface Interval {
  high: number
  low: number
  mean: number
  /** Cases the mean is over. */
  n: number
}

/** One column against the baseline over the cases both ran (paired by row). */
export interface PairedDelta {
  columnId: string
  /** Difference of each shared case (column − baseline), by row key. */
  differences: { key: string, value: number }[]
  /** Mean difference and its 95% confidence interval. */
  interval: Interval
  /** Cases where the column is better, worse, or equal, by the axis's direction (higher is better without one). */
  losses: number
  ties: number
  wins: number
}

/** Value a cell has on an axis: the counted score (a failed case counts 0), the metric, or the duration. */
export function axisValue(cell: ComparisonCell | undefined, axis: Pick<CompareAxis, 'kind' | 'name'>): number | undefined {
  if (cell == null)
    return undefined
  if (axis.kind === 'score')
    return cell.counted[axis.name]
  if (axis.kind === 'metric')
    return cell.metrics[axis.name]
  return cell.durationMs
}

/**
 * Whether an axis can be drawn on a log scale: every column mean is above 0. Scores qualify too (a log scale spreads
 * columns that cluster near the top less than near the bottom, which can separate low scorers); an interval end at or
 * below 0 is cut at the axis edge.
 */
export function canLogScale(intervals: Iterable<Interval>): boolean {
  const means = [...intervals].map(interval => interval.mean)
  return means.length > 0 && means.every(mean => mean > 0)
}

/**
 * Mean of each column on an axis over its cases, with a 95% confidence interval.
 *
 * Use when:
 * - placing the columns on the score plane, where the interval tells a real gap from noise
 *
 * Returns:
 * - by column id; a column without a value on the axis is absent
 */
export function columnIntervals(result: Pick<ComparisonResponse, 'columns' | 'rows'>, axis: CompareAxis): Map<string, Interval> {
  const intervals = new Map<string, Interval>()
  for (const column of result.columns) {
    const values = result.rows.map(row => axisValue(row.cells[column.id], axis)).filter(value => value != null)
    const interval = meanInterval(values)
    if (interval == null)
      continue
    // A score is a share of 0–1; the t-interval of a few cases near either end reaches past it ("103.7%").
    intervals.set(column.id, axis.kind === 'score' ? { ...interval, high: Math.min(1, interval.high), low: Math.max(0, interval.low) } : interval)
  }
  return intervals
}

/**
 * Axes the comparison can be read by: every score the cells count (by rank, see {@link orderScores}), then every numeric metric that
 * varies between cases, then the case duration.
 *
 * Use when:
 * - filling the axis pickers of the comparison charts
 *
 * Returns:
 * - scores better when higher unless their definition says otherwise; metrics with the direction their definition
 *   declares; duration better when lower
 */
export function compareAxes(result: Pick<ComparisonResponse, 'metricDefinitions' | 'primary' | 'rows' | 'scoreDefinitions'>): CompareAxis[] {
  const cells = result.rows.flatMap(row => Object.values(row.cells))
  const scores = new Set(cells.flatMap(cell => Object.keys(cell.counted)))
  const metrics = new Map<string, Set<number>>()
  for (const cell of cells) {
    for (const [name, value] of Object.entries(cell.metrics)) {
      const set = metrics.get(name) ?? new Set<number>()
      set.add(value)
      metrics.set(name, set)
    }
  }
  const definitions = columnDefinitions(result.metricDefinitions, result.scoreDefinitions)
  // Ranked scores first (the headline leads), then the supporting scores: the primary first, then by definition order.
  const definitionOrder = result.scoreDefinitions.map(definition => definition.name)
  const orderOf = (name: string) => (name === result.primary ? -1 : definitionOrder.includes(name) ? definitionOrder.indexOf(name) : definitionOrder.length)
  const byDefinition = [...scores].sort((left, right) => orderOf(left) - orderOf(right) || left.localeCompare(right))
  const scoreAxes = orderScores(byDefinition, result.scoreDefinitions).map((name): CompareAxis => ({
    better: definitions.get(name)?.better ?? 'higher',
    kind: 'score',
    label: scoreLabel(name, result.scoreDefinitions),
    name,
  }))
  // A metric with one value across every case (an index, a repeat number) cannot separate the columns.
  const metricAxes = [...metrics].filter(([name, values]) => values.size > 1 && !scores.has(name)).map(([name]) => name).sort().map((name): CompareAxis => ({
    better: definitions.get(name)?.better,
    kind: 'metric',
    label: metricLabel(name, definitions),
    name,
  }))
  const durations = cells.some(cell => cell.durationMs != null)
  return [...scoreAxes, ...metricAxes, ...(durations ? [{ better: 'lower' as const, kind: 'duration' as const, label: i18n.global.t('compare.chart.duration'), name: 'duration' }] : [])]
}

/**
 * Picks the column labels: the hierarchy levels (workspace, project, experiment, attempt) that tell the columns apart,
 * from the most general one that differs, adding levels until every label is unique.
 *
 * Before:
 * - runs of `arion/rephrase-arion/asr` and `raw/rephrase-raw/asr`, attempts `a-1`, `a-2`
 *
 * After:
 * - "arion", "raw"
 */
export function distinctLabels(levels: readonly (readonly string[])[]): string[] {
  const depth = levels[0]?.length ?? 0
  const varying = Array.from({ length: depth }, (_, level) => level).filter(level => new Set(levels.map(parts => parts[level])).size > 1)
  const picked: number[] = []
  for (const level of varying) {
    picked.push(level)
    if (new Set(levels.map(parts => picked.map(index => parts[index]).join(' · '))).size === levels.length)
      break
  }
  return levels.map(parts => (picked.length === 0 ? parts.at(-1) ?? '' : picked.map(index => parts[index]).join(' · ')))
}

/**
 * Formats a difference on an axis with its sign: score points (`+3.2 pt`), durations, or metric values.
 *
 * Before:
 * - 0.032 on a score; -1200 on the duration
 *
 * After:
 * - "+3.2 pt"; "−1.2s"
 */
export function formatAxisDelta(value: number, axis: CompareAxis, definitions: ReadonlyMap<string, ColumnDefinition>): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±'
  if (axis.kind === 'score')
    return `${sign}${i18n.global.t('compare.chart.points', { n: (Math.abs(value) * 100).toFixed(1) })}`
  return `${sign}${formatAxisValue(Math.abs(value), axis, definitions)}`
}

/** Formats a value of an axis: scores as percentages, durations as durations, metrics by their unit (3 significant digits). */
export function formatAxisValue(value: number, axis: CompareAxis, definitions: ReadonlyMap<string, ColumnDefinition>): string {
  if (axis.kind === 'score')
    return formatScore(value)
  if (axis.kind === 'duration')
    return formatDuration(value)
  // Means and differences of a metric carry the noise of averaging ("765.83 ms"); three significant digits are plenty
  // next to intervals of ±100 ms.
  return formatColumnValue(value === 0 ? 0 : Number(value.toPrecision(3)), definitions.get(axis.name))
}

/**
 * Each column against the baseline column, paired by case: the mean of the per-case differences with its 95%
 * confidence interval, and how many cases got better or worse.
 *
 * Use when:
 * - reading whether a column really beats the baseline: pairing by case removes the spread between easy and hard
 *   cases, so the interval is far narrower than comparing two means
 *
 * Expects:
 * - `baseline` to be one of the column ids
 *
 * Returns:
 * - one entry per other column with at least one case shared with the baseline, in column order
 */
export function pairedDeltas(result: Pick<ComparisonResponse, 'columns' | 'rows'>, axis: CompareAxis, baseline: string): PairedDelta[] {
  const lowerIsBetter = axis.better === 'lower'
  return result.columns.filter(column => column.id !== baseline).flatMap((column) => {
    const differences = result.rows.flatMap((row) => {
      const base = axisValue(row.cells[baseline], axis)
      const value = axisValue(row.cells[column.id], axis)
      return base == null || value == null ? [] : [{ key: rowKey(row), value: value - base }]
    })
    const interval = meanInterval(differences.map(difference => difference.value))
    if (interval == null)
      return []
    const better = (value: number) => (lowerIsBetter ? value < 0 : value > 0)
    const worse = (value: number) => (lowerIsBetter ? value > 0 : value < 0)
    return [{
      columnId: column.id,
      differences,
      interval,
      losses: differences.filter(difference => worse(difference.value)).length,
      ties: differences.filter(difference => difference.value === 0).length,
      wins: differences.filter(difference => better(difference.value)).length,
    }]
  })
}

/**
 * Columns no other column beats on both axes (the Pareto front), by each axis's direction.
 *
 * Use when:
 * - the plane puts a score against a cost (latency, tokens): the front is every column worth picking, the rest are
 *   beaten by one of them on both
 *
 * Returns:
 * - the ids on the front, ordered along the x axis; empty when an axis has no direction
 */
export function paretoFront(points: readonly { id: string, x: number, y: number }[], x: CompareAxis, y: CompareAxis): string[] {
  if (x.better == null || y.better == null)
    return []
  // Flip a lower-is-better axis so that larger is better on both.
  const sx = x.better === 'higher' ? 1 : -1
  const sy = y.better === 'higher' ? 1 : -1
  const dominated = (point: { x: number, y: number }) => points.some(other =>
    other !== point && sx * other.x >= sx * point.x && sy * other.y >= sy * point.y && (other.x !== point.x || other.y !== point.y))
  return points.filter(point => !dominated(point)).toSorted((left, right) => left.x - right.x).map(point => point.id)
}

/** Rows ordered as the comparison table lists them; `key` is unique across rows. */
export function rowKey(row: Pick<ComparisonResponse['rows'][number], 'caseName' | 'variant'>): string {
  return row.variant == null ? row.caseName : `${row.caseName}\u0000${row.variant}`
}

/**
 * Mean with a two-sided 95% Student-t confidence interval; one value has an interval of zero width.
 *
 * NOTICE:
 * The comparisons are over a handful of cases (often 3–20), where the normal 1.96 understates the interval: with 6
 * cases the t quantile is 2.57. Values past 30 degrees of freedom use the normal quantile; the table holds the
 * 97.5% quantiles of Student's t for 1–30 degrees of freedom.
 */
function meanInterval(values: readonly number[]): Interval | undefined {
  const n = values.length
  if (n === 0)
    return undefined
  const mean = values.reduce((sum, value) => sum + value, 0) / n
  if (n === 1)
    return { high: mean, low: mean, mean, n }
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)
  const half = (T_975[n - 2] ?? 1.96) * Math.sqrt(variance / n)
  return { high: mean + half, low: mean - half, mean, n }
}
