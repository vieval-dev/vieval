#!/usr/bin/env node

import type { CaseMetricValue, CaseRecord } from './report-records'

import process from 'node:process'

import meow from 'meow'

import { errorMessageFrom } from '@moeru/std'

import { readRunSummary, resolveRunSummaryPaths } from './report-artifacts'
import { readCaseRecordsFromReport } from './report-cases'
import { getCaseSelectorValue, stableStringify } from './report-selectors'

export interface BuildCaseComparisonArgs extends CaseComparisonOptions {
  /** Left/base run case records. */
  left: readonly CaseRecord[]
  /** Right/candidate run case records. */
  right: readonly CaseRecord[]
  /** Score name used for averages and deltas; see {@link resolveComparedScore} for the CLI default. */
  score: string
}

export interface CaseComparisonOptions {
  /** Optional key used to match cases. Defaults to `benchmark.case.id`, then `vieval.case.id`, then task id plus case name. */
  caseKey?: string
  /** Optional key used to group matched case deltas. */
  groupBy?: string
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
  /** Score name the averages and deltas use. */
  score: string
  /** Matched cases sorted from largest improvement to largest regression. */
  topImprovements: CaseComparisonRow[]
  /** Matched cases sorted from largest regression to largest improvement. */
  topRegressions: CaseComparisonRow[]
}

/** One matched case diff between two report runs. */
export interface CaseComparisonRow {
  /** Stable comparison key used to match the case. */
  caseKey: string
  /**
   * Counted left and right values of the score plus the right-minus-left delta. A side whose case did not count the
   * score (unscored, missing, or an excluded error) is `null`, and so is the delta.
   */
  delta: {
    left: null | number
    right: null | number
    score: null | number
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
  /** Difference between right and left average, or `null` when a side has no counted value. */
  delta: null | number
  /** Average counted score in the left/base records, or `null` when none counted. */
  leftAverage: null | number
  /** Average counted score in the right/candidate records, or `null` when none counted. */
  rightAverage: null | number
}

interface ParsedReportCompareCliArguments extends CaseComparisonOptions {
  format: 'json' | 'table'
  leftReportPath: string
  rightReportPath: string
  score?: string
}

const reportCompareHelpText = `
  Compare normalized case records from two generated vieval reports.

  Usage
    $ vieval report compare <leftReportPath> <rightReportPath> [options]

  Options
    --format       Output format: table | json (default: table)
    --case-key     Case field, score name, or metric name used to match records
    --score        Score name used for deltas (default: the primary score of the reports, or their only score)
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
 * - `scores` hold counted values (see `CaseRecord.scores`); a case without the score did not count it
 *
 * Returns:
 * - matched case deltas, added/removed cases, top changes, and optional group summaries; cases whose score did not
 *   count on a side have a `null` delta and are left out of top changes and group averages
 */
export function buildCaseComparison(args: BuildCaseComparisonArgs): CaseComparisonOutput {
  const score = args.score
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

    const leftScore = leftRecord.scores[score] ?? null
    const rightScore = rightRecord.scores[score] ?? null
    cases.push({
      caseKey,
      delta: {
        left: leftScore,
        right: rightScore,
        score: leftScore == null || rightScore == null ? null : rightScore - leftScore,
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

  const sortedCases = cases.filter(row => row.delta.score != null).sort((left, right) => {
    const deltaOrder = right.delta.score! - left.delta.score!
    return deltaOrder === 0
      ? left.caseKey.localeCompare(right.caseKey)
      : deltaOrder
  })

  return {
    added: added.sort(compareCaseRecords),
    cases: cases.sort((left, right) => left.caseKey.localeCompare(right.caseKey)),
    groups: args.groupBy == null ? undefined : buildComparisonGroups(cases, args.groupBy),
    overall: summarizeAverages(
      args.left.flatMap(record => record.scores[score] ?? []),
      args.right.flatMap(record => record.scores[score] ?? []),
    ),
    removed: removed.sort(compareCaseRecords),
    score,
    topImprovements: sortedCases.filter(row => row.delta.score! > 0).slice(0, 10),
    topRegressions: [...sortedCases].reverse().filter(row => row.delta.score! < 0).slice(0, 10),
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
  const fixed = (value: null | number) => value == null ? '-' : value.toFixed(3)
  const lines = [
    'COMPARE  vieval report cases',
    `Score     ${output.score}`,
    `Matched   ${output.cases.length}`,
    `Added     ${output.added.length}`,
    `Removed   ${output.removed.length}`,
    `Scores    left=${fixed(output.overall.leftAverage)} right=${fixed(output.overall.rightAverage)} delta=${fixed(output.overall.delta)}`,
  ]

  if (output.groups != null && Object.keys(output.groups).length > 0) {
    lines.push('Groups')
    for (const [groupKey, group] of Object.entries(output.groups)) {
      lines.push(`${groupKey}  count=${group.count} left=${fixed(group.leftAverage)} right=${fixed(group.rightAverage)} delta=${fixed(group.delta)}`)
    }
  }

  if (output.topImprovements.length > 0) {
    lines.push('Top improvements')
    for (const row of output.topImprovements) {
      lines.push(`${row.caseKey}  delta=${fixed(row.delta.score)} left=${fixed(row.delta.left)} right=${fixed(row.delta.right)}`)
    }
  }

  if (output.topRegressions.length > 0) {
    lines.push('Top regressions')
    for (const row of output.topRegressions) {
      lines.push(`${row.caseKey}  delta=${fixed(row.delta.score)} left=${fixed(row.delta.left)} right=${fixed(row.delta.right)}`)
    }
  }

  if (output.cases.length > 0) {
    lines.push('Cases')
    for (const row of output.cases) {
      const changedMetricNames = Object.keys(row.metricsChanged)
      lines.push(`${row.caseKey}  delta=${fixed(row.delta.score)} changedMetrics=${changedMetricNames.length === 0 ? 'none' : changedMetricNames.join(',')}`)
    }
  }

  if (output.added.length > 0) {
    lines.push(`Added cases ${output.added.map(record => `${record.taskId}::${record.caseName}`).join(',')}`)
  }

  if (output.removed.length > 0) {
    lines.push(`Removed cases ${output.removed.map(record => `${record.taskId}::${record.caseName}`).join(',')}`)
  }

  return lines.join('\n')
}

/**
 * Resolves the score `vieval report compare` uses when `--score` is not given.
 *
 * Use when:
 * - the user compares two reports without naming a score
 *
 * Expects:
 * - `reportPaths` to be the compared report locations, whose `run-summary.json` files hold the resolved headlines
 *
 * Returns:
 * - the primary score name when every report's headline that has a score names the same one
 * - otherwise the only score name the records have
 * - throws when neither decides, listing the score names to pick from
 */
export async function resolveComparedScore(reportPaths: readonly string[], records: readonly CaseRecord[]): Promise<string> {
  const summaryPaths = (await Promise.all(reportPaths.map(reportPath => resolveRunSummaryPaths(reportPath)))).flat()
  const primaryNames = new Set(summaryPaths.flatMap(summaryPath => readRunSummary(summaryPath).projects.flatMap((project) => {
    const headline = project.headline?.headline
    return headline?.kind === 'score' ? [headline.score.name] : []
  })))
  if (primaryNames.size === 1) {
    return [...primaryNames][0]!
  }

  const scoreNames = [...new Set(records.flatMap(record => Object.keys(record.scores)))].sort()
  if (scoreNames.length === 1) {
    return scoreNames[0]!
  }

  const reason = primaryNames.size > 1
    ? `the reports have different primary scores (${[...primaryNames].sort().join(', ')})`
    : `the reports have no primary score`
  throw new Error(`Pass --score <name>: ${reason}. Scores in the reports: ${scoreNames.length === 0 ? 'none' : scoreNames.join(', ')}.`)
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
 *       -> {@link resolveComparedScore} (without `--score`)
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
      score: parsed.score ?? await resolveComparedScore([parsed.leftReportPath, parsed.rightReportPath], [...left, ...right]),
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

function averageOf(values: readonly number[]): null | number {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
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
        // Only rows that count the score on both sides compare like with like.
        const compared = rows.filter(row => row.delta.score != null)
        return [groupKey, {
          count: rows.length,
          ...summarizeAverages(compared.map(row => row.delta.left!), compared.map(row => row.delta.right!)),
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
      score: {
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
    score: cli.flags.score,
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
  if (vievalCaseId.exists) {
    return String(vievalCaseId.value)
  }

  // A case id is only unique within its task, and it carries the case's index, which differs when two runs list
  // cases in another order. The task id plus the case name names one case across tasks, matrix rows, and runs.
  return `${record.taskId}::${record.caseName}`
}

function summarizeAverages(left: readonly number[], right: readonly number[]): CaseComparisonSummary {
  const leftAverage = averageOf(left)
  const rightAverage = averageOf(right)
  return {
    delta: leftAverage == null || rightAverage == null ? null : rightAverage - leftAverage,
    leftAverage,
    rightAverage,
  }
}
