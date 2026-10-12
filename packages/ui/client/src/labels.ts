import { formatTime } from './format'

/**
 * Readable names of report levels. Report ids are path segments made for machines
 * (`matrix-run-model-gpt-5.5-repeat-1`, `attempt-2026-10-12T07-11-52-616Z`, `run-1791789112616-e67c9b33`); the UI
 * shows these labels and keeps the full id in a tooltip and a copy button (`IdLabel.vue`).
 */

/** Readable name of an experiment. */
export interface ExperimentLabel {
  /** Matrix axes of the experiment's runs, one chip per axis. */
  chips: MatrixChip[]
  /**
   * Main text: the matrix (`model gpt-5.5 · repeat 1–3`) for vieval's default experiment ids (`matrix-…`), the
   * experiment id for ids someone chose (`--experiment auv-c759d695`), whose chips are shown next to it.
   */
  text: string
  /** `true` when `text` is the matrix, so the chips need not be repeated. */
  textIsMatrix: boolean
}

/** Run-matrix axes with their values, as `RunListItem.matrix` reports them. */
export type MatrixAxes = Record<string, readonly string[]>

/** One axis of a matrix label, for example `{ axis: 'repeat', values: '1–3' }`. */
export interface MatrixChip {
  axis: string
  values: string
}

/** Experiment ids that vieval generates from the matrix when `--experiment` is not given. */
const DEFAULT_EXPERIMENT_PREFIX = 'matrix-'

/**
 * Reads the start time encoded in vieval's default attempt id.
 *
 * Before:
 * - "attempt-2026-10-12T07-11-52-616Z", "nightly"
 *
 * After:
 * - Date(2026-10-12T07:11:52.616Z), undefined
 */
export function attemptDate(attemptId: string): Date | undefined {
  const match = /^attempt-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{1,3}))?Z$/.exec(attemptId)
  if (match == null)
    return undefined
  const [, day, hours, minutes, seconds, millis = '0'] = match
  const date = new Date(`${day}T${hours}:${minutes}:${seconds}.${millis.padStart(3, '0')}Z`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/**
 * Readable name of an attempt: its start time for vieval's default ids, the id itself otherwise.
 *
 * Before:
 * - "attempt-2026-10-12T07-11-52-616Z", "nightly"
 *
 * After:
 * - "Oct 12, 07:11" (local time), "nightly"
 */
export function attemptLabel(attemptId: string): string {
  const date = attemptDate(attemptId)
  return date == null ? attemptId : formatShortDateTime(date)
}

/**
 * Builds the readable name of an experiment from its id and the matrix of its runs.
 *
 * Before:
 * - "matrix-run-model-gpt-5.5-repeat-1", { model: ["gpt-5.5"], repeat: ["1"] }
 * - "auv-c759d695", { model: ["gpt-5.5"], repeat: ["1"] }
 *
 * After:
 * - text "model gpt-5.5 · repeat 1" (textIsMatrix)
 * - text "auv-c759d695", chips model gpt-5.5, repeat 1
 */
export function experimentLabel(experimentId: string, matrix: MatrixAxes | undefined): ExperimentLabel {
  const chips = Object.entries(matrix ?? {}).filter(([, values]) => values.length > 0).map(([axis, values]) => ({ axis, values: formatAxisValues(values) }))
  if (experimentId.startsWith(DEFAULT_EXPERIMENT_PREFIX) && chips.length > 0)
    return { chips, text: chips.map(chip => `${chip.axis} ${chip.values}`).join(' · '), textIsMatrix: true }
  return { chips, text: experimentId, textIsMatrix: false }
}

/**
 * Normalizes the values of one axis into a short text; consecutive integers collapse to ranges.
 *
 * Before:
 * - ["1", "2", "3", "5"], ["gpt-5.5", "o3"]
 *
 * After:
 * - "1–3, 5", "gpt-5.5, o3"
 */
export function formatAxisValues(values: readonly string[]): string {
  const sorted = sortAxisValues(values)
  if (sorted.length === 0)
    return ''
  if (!sorted.every(value => /^-?\d+$/.test(value)))
    return sorted.join(', ')
  const parts: string[] = []
  let start = Number(sorted[0])
  let previous = start
  for (const value of [...sorted.slice(1).map(Number), Number.NaN]) {
    if (value === previous + 1) {
      previous = value
      continue
    }
    parts.push(start === previous ? String(start) : previous === start + 1 ? `${start}, ${previous}` : `${start}–${previous}`)
    start = value
    previous = value
  }
  return parts.join(', ')
}

/**
 * Formats an expected finish: the time of day while it is less than a day away, the date and time otherwise, so a
 * finish weeks ahead never reads as "later today".
 *
 * Before:
 * - "2026-10-12T13:00:00Z" (3 h from now), "2026-11-25T03:45:00Z" (44 days from now)
 *
 * After:
 * - "13:00:00", "Nov 25, 03:45"
 */
export function formatFinish(iso: string, now = Date.now()): string {
  const finish = new Date(iso)
  return finish.getTime() - now < 86_400_000 ? formatTime(iso) : formatShortDateTime(finish)
}

/** `Oct 12, 07:11` in the viewer's (English) UI language and the browser's time zone. */
export function formatShortDateTime(date: Date): string {
  return date.toLocaleString('en-US', { day: 'numeric', hour: '2-digit', hour12: false, minute: '2-digit', month: 'short' })
}

/**
 * Merges the matrices of several runs into one set of axes with sorted, distinct values.
 *
 * Use when:
 * - labelling an experiment or project from all of its runs
 */
export function mergeMatrices(matrices: readonly (MatrixAxes | undefined)[]): MatrixAxes {
  const merged = new Map<string, Set<string>>()
  for (const matrix of matrices) {
    for (const [axis, values] of Object.entries(matrix ?? {})) {
      const set = merged.get(axis) ?? new Set<string>()
      for (const value of values)
        set.add(value)
      merged.set(axis, set)
    }
  }
  return Object.fromEntries([...merged.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([axis, values]) => [axis, sortAxisValues([...values])]))
}

/**
 * Time from `now` to `date` in words.
 *
 * Before:
 * - 3 hours before now, 2 days before now
 *
 * After:
 * - "3 hours ago", "2 days ago"
 */
export function relativeTime(date: Date, now: number): string {
  const seconds = Math.round((date.getTime() - now) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3600], ['minute', 60]]
  const format = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size)
      return format.format(Math.round(seconds / size), unit)
  }
  return format.format(seconds, 'second')
}

/**
 * Readable name of a run: its start time and the short hash of its id.
 *
 * Before:
 * - { runKey: "run-1791789112616-e67c9b33", startedAt: "2026-10-12T07:11:52.616Z" }
 *
 * After:
 * - "Oct 12, 07:11 · e67c9b33"
 */
export function runLabel(run: { runKey: string, startedAt?: string }): string {
  const hash = shortRunHash(run.runKey)
  const started = run.startedAt == null ? undefined : new Date(run.startedAt)
  return started == null || Number.isNaN(started.getTime()) ? hash : `${formatShortDateTime(started)} · ${hash}`
}

/**
 * Last segment of a run id, enough to tell runs apart.
 *
 * Before:
 * - "run-1791789112616-e67c9b33"
 *
 * After:
 * - "e67c9b33"
 */
export function shortRunHash(runKey: string): string {
  return runKey.slice(-8)
}

/** Numbers in numeric order (`2` before `10`), everything else alphabetically. */
function sortAxisValues(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => {
    const numeric = Number(a) - Number(b)
    return Number.isFinite(numeric) && a.trim() !== '' && b.trim() !== '' ? numeric : a.localeCompare(b)
  })
}
