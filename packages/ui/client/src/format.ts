import { format } from 'd3'

import { currentLocale } from './i18n'

const compactNumber = format('~s')
const plainNumber = format('~r')

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

/**
 * Formats a number for a chart tick or a band edge: SI suffixes from 1 000 on, at most three significant digits below,
 * so a 0–1 score reads `0.8`, not `800m`.
 *
 * Before:
 * - 0.8, 0.6666666, 12, 48213
 *
 * After:
 * - "0.8", "0.667", "12", "48.2k"
 */
export function formatTick(value: number): string {
  return Math.abs(value) >= 1000 ? compactNumber(Number(value.toPrecision(3))) : plainNumber(Number(value.toPrecision(3)))
}

/** Compact number formatters by locale; one per locale, because creating `Intl.NumberFormat` is not free. */
const compactFormats = new Map<string, Intl.NumberFormat>()

/**
 * Formats a count with its noun in the right number, for short summaries.
 *
 * Before:
 * - (1, 'run'), (12, 'run'), (3, 'experiment')
 *
 * After:
 * - "1 run", "12 runs", "3 experiments"
 */
export function countOf(count: number, noun: string): string {
  return `${formatCount(count)} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * Formats a number in compact notation in the viewer's locale, with at most one decimal.
 *
 * Use when:
 * - a large count or metric value must stay short (`formatCount`, metric values in `caseMetrics.ts`)
 *
 * Returns:
 * - `48.2K`, `1M` in English; `4.8万`, `100万` in Chinese
 */
export function formatCompact(value: number): string {
  const locale = currentLocale()
  let compact = compactFormats.get(locale)
  if (compact == null) {
    compact = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, notation: 'compact' })
    compactFormats.set(locale, compact)
  }
  return compact.format(value)
}

/**
 * Formats a case count so it stays short next to a bar: exact below 10 000, compact in the viewer's locale from there.
 *
 * Before:
 * - 361, 9_999, 48_213, 1_000_000
 *
 * After:
 * - "361", "9999", "48.2K", "1M" (`zh-Hans`: "4.8万", "100万")
 */
export function formatCount(count: number): string {
  return count < 10_000 ? String(count) : formatCompact(count)
}

/** Date and time of an ISO timestamp in the viewer's locale and the browser's time zone. */
export function formatDateTime(iso: string | undefined): string {
  if (iso == null)
    return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(currentLocale(), { hour12: false })
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

/** Wall-clock time of an ISO timestamp, with seconds, in the viewer's locale and the browser's time zone. */
export function formatTime(iso: string | undefined): string {
  if (iso == null)
    return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString(currentLocale(), { hour12: false })
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
