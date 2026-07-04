#!/usr/bin/env node

import type { CaseMetricValue, CaseRecord } from './report-records'

import process from 'node:process'

import meow from 'meow'

import { errorMessageFrom } from '@moeru/std'

import { readCaseRecordsFromReport } from './report-cases'
import { getCaseSelectorValue, stableStringify } from './report-selectors'

export interface BuildCaseComparisonArgs extends CaseComparisonOptions {
  /** Left/base run case records. */
  left: readonly CaseRecord[]
  /** Right/candidate run case records. */
  right: readonly CaseRecord[]
}

export interface CaseComparisonOptions {
  /** Optional key used to match cases. Defaults to `benchmark.case.id`, then `caseId`. */
  caseKey?: string
  /** Optional key used to group matched case deltas. */
  groupBy?: string
  /** Score kind used for averages and deltas. */
  scoreKind?: string
}

/** Full case comparison output for local report artifacts. */
export interface CaseComparisonOutput {
  /** Cases present only in the right/candidate report. */
  added: CaseRecord[]
  /** Matched case diffs. */
  cases: CaseComparisonRow[]
  /** Group summaries keyed by `<groupKey>=<groupValue>`, when requested. */
  groups?: Record<string, CaseComparisonSummary & { count: number }>
  /** Aggregate score delta over all records with the selected score. */
  overall: CaseComparisonSummary
  /** Cases present only in the left/base report. */
  removed: CaseRecord[]
  /** Matched cases sorted from largest improvement to largest regression. */
  topImprovements: CaseComparisonRow[]
  /** Matched cases sorted from largest regression to largest improvement. */
  topRegressions: CaseComparisonRow[]
}

/** One matched case diff between two report runs. */
export interface CaseComparisonRow {
  /** Stable comparison key used to match the case. */
  caseKey: string
  /** Direct left and right scores plus right-minus-left delta. */
  delta: {
    left: number
    right: number
    score: number
  }
  /** Left/base case record. */
  left: CaseRecord
  /** Metric values that differ between the two matched records. */
  metricsChanged: Record<string, { left: CaseMetricValue | undefined, right: CaseMetricValue | undefined }>
  /** Right/candidate case record. */
  right: CaseRecord
}

/** Score summary for all compared cases or one group of compared cases. */
export interface CaseComparisonSummary {
  /** Difference between right and left average. */
  delta: number
  /** Average score in the left/base records. */
  leftAverage: number
  /** Average score in the right/candidate records. */
  rightAverage: number
}

interface ParsedReportCompareCliArguments extends CaseComparisonOptions {
  format: 'json' | 'table'
  leftReportPath: string
  rightReportPath: string
}

const reportCompareHelpText = `
  Compare normalized case records from two generated vieval reports.

  Usage
    $ vieval report compare <leftReportPath> <rightReportPath> [options]

  Options
    --format       Output format: table | json (default: table)
    --case-key     Case field, score name, or metric name used to match records
    --score-kind   Score kind used for deltas (default: exact)
    --group-by     Case field, score name, or metric name used for grouped deltas
`

/**
 * Builds a generic case-level comparison between two report runs.
 *
 * Use when:
 * - local report analysis needs per-case improvements/regressions
 * - benchmark-specific facets should stay as generic metric keys
 *
 * Expects:
 * - left and right records are normalized `cases.jsonl` rows
 * - score values are numeric and comparable by `scoreKind`
 *
 * Returns:
 * - matched case deltas, added/removed cases, top changes, and optional group summaries
 */
export function buildCaseComparison(args: BuildCaseComparisonArgs): CaseComparisonOutput {
  const scoreKind = args.scoreKind ?? 'exact'
  const leftByKey = indexRecordsByCaseKey(args.left, args.caseKey, 'left')
  const rightByKey = indexRecordsByCaseKey(args.right, args.caseKey, 'right')
  const cases: CaseComparisonRow[] = []
  const added: CaseRecord[] = []
  const removed: CaseRecord[] = []

  for (const [caseKey, leftRecord] of leftByKey) {
    const rightRecord = rightByKey.get(caseKey)
    if (rightRecord == null) {
      removed.push(leftRecord)
      continue
    }

    const leftScore = getScore(leftRecord, scoreKind)
    const rightScore = getScore(rightRecord, scoreKind)
    cases.push({
      caseKey,
      delta: {
        left: leftScore,
        right: rightScore,
        score: rightScore - leftScore,
      },
      left: leftRecord,
      metricsChanged: diffMetrics(leftRecord.metrics, rightRecord.metrics),
      right: rightRecord,
    })
  }

  for (const [caseKey, rightRecord] of rightByKey) {
    if (!leftByKey.has(caseKey)) {
      added.push(rightRecord)
    }
  }

  const sortedCases = [...cases].sort((left, right) => {
    const deltaOrder = right.delta.score - left.delta.score
    return deltaOrder === 0
      ? left.caseKey.localeCompare(right.caseKey)
      : deltaOrder
  })

  return {
    added: added.sort(compareCaseRecords),
    cases: cases.sort((left, right) => left.caseKey.localeCompare(right.caseKey)),
    groups: args.groupBy == null ? undefined : buildComparisonGroups(cases, args.groupBy),
    overall: {
      delta: averageScore(args.right, scoreKind) - averageScore(args.left, scoreKind),
      leftAverage: averageScore(args.left, scoreKind),
      rightAverage: averageScore(args.right, scoreKind),
    },
    removed: removed.sort(compareCaseRecords),
    topImprovements: sortedCases.filter(row => row.delta.score > 0).slice(0, 10),
    topRegressions: [...sortedCases].reverse().filter(row => row.delta.score < 0).slice(0, 10),
  }
}

/**
 * Formats a case comparison as a compact human-readable table.
 *
 * Use when:
 * - `vieval report compare` should expose the same information as JSON output
 * - users need a terminal-first overview of group and per-case deltas
 *
 * Expects:
 * - comparison output was produced by {@link buildCaseComparison}
 *
 * Returns:
 * - multi-line text containing aggregate, group, top-change, case, and unmatched summaries
 */
export function formatCaseComparisonTable(output: CaseComparisonOutput): string {
  const lines = [
    'COMPARE  vieval report cases',
    `Matched   ${output.cases.length}`,
    `Added     ${output.added.length}`,
    `Removed   ${output.removed.length}`,
    `Scores    left=${output.overall.leftAverage.toFixed(3)} right=${output.overall.rightAverage.toFixed(3)} delta=${output.overall.delta.toFixed(3)}`,
  ]

  if (output.groups != null && Object.keys(output.groups).length > 0) {
    lines.push('Groups')
    for (const [groupKey, group] of Object.entries(output.groups)) {
      lines.push(`${groupKey}  count=${group.count} left=${group.leftAverage.toFixed(3)} right=${group.rightAverage.toFixed(3)} delta=${group.delta.toFixed(3)}`)
    }
  }

  if (output.topImprovements.length > 0) {
    lines.push('Top improvements')
    for (const row of output.topImprovements) {
      lines.push(`${row.caseKey}  delta=${row.delta.score.toFixed(3)} left=${row.delta.left.toFixed(3)} right=${row.delta.right.toFixed(3)}`)
    }
  }

  if (output.topRegressions.length > 0) {
    lines.push('Top regressions')
    for (const row of output.topRegressions) {
      lines.push(`${row.caseKey}  delta=${row.delta.score.toFixed(3)} left=${row.delta.left.toFixed(3)} right=${row.delta.right.toFixed(3)}`)
    }
  }

  if (output.cases.length > 0) {
    lines.push('Cases')
    for (const row of output.cases) {
      const changedMetricNames = Object.keys(row.metricsChanged)
      lines.push(`${row.caseKey}  delta=${row.delta.score.toFixed(3)} changedMetrics=${changedMetricNames.length === 0 ? 'none' : changedMetricNames.join(',')}`)
    }
  }

  if (output.added.length > 0) {
    lines.push(`Added cases ${output.added.map(record => record.caseId).join(',')}`)
  }

  if (output.removed.length > 0) {
    lines.push(`Removed cases ${output.removed.map(record => record.caseId).join(',')}`)
  }

  return lines.join('\n')
}

/**
 * Runs the `vieval report compare` command.
 *
 * Call stack:
 *
 * published executable (`../bin/vieval`)
 *   -> {@link import('./index').runTopLevelCli}
 *     -> {@link runReportCompareCli}
 *       -> {@link readCaseRecordsFromReport}
 *       -> {@link buildCaseComparison}
 *
 * Use when:
 * - two local report artifact directories should be compared case-by-case
 *
 * Expects:
 * - argv is either `compare <left> <right> ...` or `<left> <right> ...`
 *
 * Returns:
 * - resolves after writing the requested output to stdout
 */
export async function runReportCompareCli(argv: readonly string[]): Promise<void> {
  try {
    const parsed = parseReportCompareCliArguments(argv)
    const [left, right] = await Promise.all([
      readCaseRecordsFromReport(parsed.leftReportPath),
      readCaseRecordsFromReport(parsed.rightReportPath),
    ])
    const output = buildCaseComparison({
      caseKey: parsed.caseKey,
      groupBy: parsed.groupBy,
      left,
      right,
      scoreKind: parsed.scoreKind,
    })

    if (parsed.format === 'json') {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
      return
    }

    process.stdout.write(`${formatCaseComparisonTable(output)}\n`)
  }
  catch (error) {
    const errorMessage = errorMessageFrom(error) ?? 'Unknown report compare failure.'
    process.stderr.write(`[vieval report compare] ${errorMessage}\n`)
    process.exitCode = 1
  }
}

function averageScore(records: readonly CaseRecord[], scoreKind: string): number {
  const values = records
    .map(record => record.scores[scoreKind])
    .filter((value): value is number => typeof value === 'number')

  if (values.length === 0) {
    return 0
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function buildComparisonGroups(
  cases: readonly CaseComparisonRow[],
  groupBy: string,
): Record<string, CaseComparisonSummary & { count: number }> {
  const groupedRows: Record<string, CaseComparisonRow[]> = {}

  for (const row of cases) {
    const resolved = getCaseSelectorValue(row.right, groupBy)
    if (!resolved.exists) {
      continue
    }

    const groupKey = `${groupBy}=${String(resolved.value)}`
    groupedRows[groupKey] ??= []
    groupedRows[groupKey].push(row)
  }

  return Object.fromEntries(
    Object.entries(groupedRows)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([groupKey, rows]) => {
        const leftAverage = rows.reduce((sum, row) => sum + row.delta.left, 0) / rows.length
        const rightAverage = rows.reduce((sum, row) => sum + row.delta.right, 0) / rows.length

        return [groupKey, {
          count: rows.length,
          delta: rightAverage - leftAverage,
          leftAverage,
          rightAverage,
        }]
      }),
  )
}

function compareCaseRecords(left: CaseRecord, right: CaseRecord): number {
  return left.caseId.localeCompare(right.caseId)
}

function diffMetrics(
  left: Record<string, CaseMetricValue>,
  right: Record<string, CaseMetricValue>,
): Record<string, { left: CaseMetricValue | undefined, right: CaseMetricValue | undefined }> {
  const changed: Record<string, { left: CaseMetricValue | undefined, right: CaseMetricValue | undefined }> = {}
  const metricKeys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort((leftKey, rightKey) => leftKey.localeCompare(rightKey))

  for (const metricKey of metricKeys) {
    if (stableStringify(left[metricKey]) !== stableStringify(right[metricKey])) {
      changed[metricKey] = {
        left: left[metricKey],
        right: right[metricKey],
      }
    }
  }

  return changed
}

function getScore(record: CaseRecord, scoreKind: string): number {
  return record.scores[scoreKind] ?? 0
}

function indexRecordsByCaseKey(records: readonly CaseRecord[], caseKey: string | undefined, side: 'left' | 'right'): Map<string, CaseRecord> {
  const indexed = new Map<string, CaseRecord>()

  for (const record of records) {
    const resolved = resolveCaseKey(record, caseKey)
    if (indexed.has(resolved)) {
      throw new Error(`Duplicate case key "${resolved}" in ${side} report.`)
    }

    indexed.set(resolved, record)
  }

  return indexed
}

function normalizeCliArgv(argv: readonly string[]): string[] {
  const normalizedArgv = argv[0] === '--'
    ? argv.slice(1)
    : [...argv]

  if (normalizedArgv[0] === 'report' && normalizedArgv[1] === 'compare') {
    return normalizedArgv.slice(2)
  }

  if (normalizedArgv[0] === 'compare') {
    return normalizedArgv.slice(1)
  }

  return normalizedArgv
}

function parseReportCompareCliArguments(argv: readonly string[]): ParsedReportCompareCliArguments {
  const cli = meow(reportCompareHelpText, {
    argv: normalizeCliArgv(argv),
    flags: {
      caseKey: {
        type: 'string',
      },
      format: {
        default: 'table',
        type: 'string',
      },
      groupBy: {
        type: 'string',
      },
      scoreKind: {
        default: 'exact',
        type: 'string',
      },
    },
    importMeta: import.meta,
  })

  const leftReportPath = cli.input[0]
  const rightReportPath = cli.input[1]
  if (leftReportPath == null || leftReportPath.length === 0 || rightReportPath == null || rightReportPath.length === 0) {
    throw new Error('Missing required <leftReportPath> and <rightReportPath> arguments.')
  }

  return {
    caseKey: cli.flags.caseKey,
    format: cli.flags.format === 'json' ? 'json' : 'table',
    groupBy: cli.flags.groupBy,
    leftReportPath,
    rightReportPath,
    scoreKind: cli.flags.scoreKind,
  }
}

function resolveCaseKey(record: CaseRecord, caseKey: string | undefined): string {
  if (caseKey != null) {
    const resolved = getCaseSelectorValue(record, caseKey)
    if (resolved.exists) {
      return String(resolved.value)
    }

    throw new Error(`Missing explicit case key "${caseKey}" for case "${record.caseId}".`)
  }

  const benchmarkCaseId = getCaseSelectorValue(record, 'benchmark.case.id')
  if (benchmarkCaseId.exists) {
    return String(benchmarkCaseId.value)
  }

  const vievalCaseId = getCaseSelectorValue(record, 'vieval.case.id')
  return vievalCaseId.exists
    ? String(vievalCaseId.value)
    : record.caseId
}
