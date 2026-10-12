/**
 * Formats a byte count.
 *
 * Before:
 * - 208894
 *
 * After:
 * - "204.0 KiB"
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

/** Compact notation for large counts; one formatter, because creating `Intl.NumberFormat` is not free. */
const compactCount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, notation: 'compact' })

/**
 * Formats a case count so it stays short next to a bar: exact below 10 000, compact from there.
 *
 * Before:
 * - 361, 9_999, 48_213, 1_000_000
 *
 * After:
 * - "361", "9999", "48.2K", "1M"
 */
export function formatCount(count: number): string {
  return count < 10_000 ? String(count) : compactCount.format(count)
}

/** Local date and time of an ISO timestamp. */
export function formatDateTime(iso: string | undefined): string {
  if (iso == null)
    return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { hour12: false })
}

/**
 * Formats a duration in milliseconds for people.
 *
 * Before:
 * - 532, 61_000, 18_832_792
 *
 * After:
 * - "532ms", "1m 01s", "5h 13m"
 */
export function formatDuration(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms))
    return '—'
  if (ms < 1000)
    return `${Math.round(ms)}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60)
    return `${(ms / 1000).toFixed(seconds < 10 ? 1 : 0)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60)
    return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
}

/**
 * Formats a score from 0 to 1 as a percentage.
 *
 * Before:
 * - 0.6111, null
 *
 * After:
 * - "61.1%", "—"
 */
export function formatScore(value: null | number | undefined): string {
  if (value == null || !Number.isFinite(value))
    return '—'
  return `${(value * 100).toFixed(1)}%`
}

/** Local wall-clock time of an ISO timestamp, with seconds. */
export function formatTime(iso: string | undefined): string {
  if (iso == null)
    return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString(undefined, { hour12: false })
}

/** One-line preview of any JSON value, cut at `max` characters. */
export function previewValue(value: unknown, max = 120): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * Shortens a vieval task id to the part people recognize.
 *
 * Before:
 * - "evals%2Fosworld%2Feval%2Fosworld::default::run=model%3Dgpt-5.5%26repeat%3D1::eval=default"
 *
 * After:
 * - "evals/osworld/eval/osworld"
 */
export function shortTaskId(taskId: string): string {
  const [entry = taskId] = taskId.split('::')
  try {
    return decodeURIComponent(entry)
  }
  catch {
    return entry
  }
}
