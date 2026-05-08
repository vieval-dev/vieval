import type { CaseRecord } from './report-records'

/**
 * Resolved value for one case selector lookup.
 */
export interface CaseSelectorValue {
  /** Whether the selector exists on the case record. */
  exists: boolean
  /** Matched direct field, score, or metric value. */
  value?: unknown
}

/**
 * Resolves a generic case selector from metrics, scores, then direct fields.
 *
 * Use when:
 * - report commands accept benchmark-neutral selectors such as `benchmark.case.id`
 * - comparisons need the same lookup semantics as filtering and grouping
 *
 * Expects:
 * - `key` is a direct `CaseRecord` field, score key, `scores.<key>`, or metric key
 *
 * Returns:
 * - existence flag plus matched value when present
 */
export function getCaseSelectorValue(record: CaseRecord, key: string): CaseSelectorValue {
  if (Object.hasOwn(record.metrics, key)) {
    return { exists: true, value: record.metrics[key] }
  }

  if (key.startsWith('scores.') && Object.hasOwn(record.scores, key.slice('scores.'.length))) {
    return { exists: true, value: record.scores[key.slice('scores.'.length)] }
  }

  if (Object.hasOwn(record.scores, key)) {
    return { exists: true, value: record.scores[key] }
  }

  if (Object.hasOwn(record, key)) {
    return { exists: true, value: record[key as keyof CaseRecord] }
  }

  return { exists: false }
}

/**
 * Stable-stringifies JSON-like values for report comparisons.
 *
 * Before:
 * - `{ b: 1, a: true }`
 *
 * After:
 * - `{"a":true,"b":1}`
 */
export function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`
  }

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}
