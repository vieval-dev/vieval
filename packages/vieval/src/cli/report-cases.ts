#!/usr/bin/env node

import type { ScoreSummary } from '../core/scoring'
import type { CaseRecord } from './report-records'

import process from 'node:process'

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import meow from 'meow'

import { errorMessageFrom } from '@moeru/std'
import { glob } from 'tinyglobby'

import { encodeJsonl, readCaseRecordFile, summarizeRecordScores } from './report-records'
import { getCaseSelectorValue } from './report-selectors'

export type ReportCasesFormat = 'json' | 'jsonl' | 'table'

/** One grouped case summary produced by `vieval report cases --group-by`. */
export interface ReportCasesGroupSummary {
  /** Number of case records in this group. */
  count: number
  /** Score summaries of this group by score name, counted as in `metrics-summary.json`. */
  scores: Record<string, ScoreSummary>
}

/** Options for inspecting normalized `cases.jsonl` report artifacts. */
export interface ReportCasesOptions {
  /** Output format for the command response. */
  format: ReportCasesFormat
  /** Optional case field, score name, or metric name used to group score summaries. */
  groupBy?: string
  /** Equality filters in `key=value` form. */
  where?: readonly string[]
}

/** Structured output for case inspection and optional grouped summaries. */
export interface ReportCasesOutput {
  /** Grouped summaries keyed by `<groupKey>=<groupValue>`, when requested. */
  groups?: Record<string, ReportCasesGroupSummary>
  /** Filtered case records. */
  records: CaseRecord[]
}

interface ParsedReportCasesCliArguments extends ReportCasesOptions {
  reportPath: string
}

const reportCasesHelpText = `
  Inspect normalized case records from generated vieval report artifacts.

  Usage
    $ vieval report cases <reportPath> [options]

  Options
    --format       Output format: table | json | jsonl (default: table)
    --where        Equality filter "key=value"; repeatable
    --group-by     Case field, score name, or metric name used for grouped score summaries
`

/**
 * Builds filtered case inspection output.
 *
 * Use when:
 * - `vieval report cases` needs deterministic JSON/table output
 * - tests need pure filtering and grouping behavior without process I/O
 *
 * Expects:
 * - `where` filters use `key=value`
 * - lookup keys may target direct case fields, score names, or metric names
 *
 * Returns:
 * - filtered records plus grouped score summaries when `groupBy` is present
 */
export function buildReportCasesOutput(
  records: readonly CaseRecord[],
  options: ReportCasesOptions,
): ReportCasesOutput {
  const whereFilters = (options.where ?? []).map(parseSelector)
  const filteredRecords = records.filter(record => matchesWhereFilters(record, whereFilters))
  const groups = options.groupBy == null
    ? undefined
    : buildCaseGroups(filteredRecords, options.groupBy)

  return {
    groups,
    records: [...filteredRecords],
  }
}

/**
 * Reads normalized case records from one report run directory or report root.
 *
 * Use when:
 * - CLI tools need case-level inspection from local report artifacts
 * - callers may pass a run directory, a `cases.jsonl` file, or a report root
 *
 * Expects:
 * - discovered `cases.jsonl` files contain one current `CaseRecord` JSON object per line
 *
 * Returns:
 * - all parsed case records sorted by discovered file path order
 * - throws for records written by an older vieval (see {@link readCaseRecordFile})
 */
export async function readCaseRecordsFromReport(reportPath: string): Promise<CaseRecord[]> {
  const caseFilePaths = await resolveCaseRecordPaths(reportPath)
  if (caseFilePaths.length === 0) {
    throw new Error(`No cases.jsonl files found under "${resolve(reportPath)}".`)
  }

  return caseFilePaths.flatMap(caseFilePath => readCaseRecordFile(caseFilePath))
}

/**
 * Runs the `vieval report cases` command.
 *
 * Call stack:
 *
 * published executable (`../bin/vieval`)
 *   -> {@link import('./index').runTopLevelCli}
 *     -> {@link runReportCasesCli}
 *       -> {@link readCaseRecordsFromReport}
 *
 * Use when:
 * - the top-level CLI dispatches local case artifact inspection
 *
 * Expects:
 * - argv is either `cases <reportPath> ...` or `<reportPath> ...`
 *
 * Returns:
 * - resolves after writing the requested output to stdout
 */
export async function runReportCasesCli(argv: readonly string[]): Promise<void> {
  try {
    const parsed = parseReportCasesCliArguments(argv)
    const records = await readCaseRecordsFromReport(parsed.reportPath)
    const output = buildReportCasesOutput(records, parsed)

    if (parsed.format === 'json') {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
      return
    }

    if (parsed.format === 'jsonl') {
      process.stdout.write(encodeJsonl(output.records))
      return
    }

    process.stdout.write(`${formatCasesTable(output)}\n`)
  }
  catch (error) {
    const errorMessage = errorMessageFrom(error) ?? 'Unknown report cases failure.'
    process.stderr.write(`[vieval report cases] ${errorMessage}\n`)
    process.exitCode = 1
  }
}

function buildCaseGroups(records: readonly CaseRecord[], groupBy: string): Record<string, ReportCasesGroupSummary> {
  const groups = new Map<string, CaseRecord[]>()

  for (const record of records) {
    const resolved = getCaseSelectorValue(record, groupBy)
    if (!resolved.exists) {
      continue
    }

    const groupKey = `${groupBy}=${String(resolved.value)}`
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), record])
  }

  return Object.fromEntries(
    [...groups]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([groupKey, groupRecords]) => [groupKey, {
        count: groupRecords.length,
        scores: summarizeRecordScores(groupRecords),
      } satisfies ReportCasesGroupSummary]),
  )
}

function formatCasesTable(output: ReportCasesOutput): string {
  const lines = [
    'CASES  vieval report',
    `Case count ${output.records.length}`,
  ]

  if (output.groups != null) {
    lines.push('Groups')
    for (const [groupKey, group] of Object.entries(output.groups)) {
      const scoreText = Object.values(group.scores)
        .map(summary => `${summary.name}=${summary.mean == null ? '-' : summary.mean.toFixed(3)} (${summary.n}/${summary.total})`)
        .join(' ')
      lines.push(`${groupKey}  count=${group.count}${scoreText.length > 0 ? ` ${scoreText}` : ''}`)
    }
  }

  return lines.join('\n')
}

function matchesWhereFilters(record: CaseRecord, whereFilters: ReadonlyArray<{ key: string, value: string }>): boolean {
  return whereFilters.every((parsed) => {
    const resolved = getCaseSelectorValue(record, parsed.key)

    return resolved.exists && String(resolved.value) === parsed.value
  })
}

function normalizeCliArgv(argv: readonly string[]): string[] {
  const normalizedArgv = argv[0] === '--'
    ? argv.slice(1)
    : [...argv]

  if (normalizedArgv[0] === 'report' && normalizedArgv[1] === 'cases') {
    return normalizedArgv.slice(2)
  }

  if (normalizedArgv[0] === 'cases') {
    return normalizedArgv.slice(1)
  }

  return normalizedArgv
}

function normalizeReportCasesFormat(value: string): ReportCasesFormat {
  const normalized = value.toLowerCase()
  if (normalized === 'json') {
    return 'json'
  }

  if (normalized === 'jsonl') {
    return 'jsonl'
  }

  return 'table'
}

function parseReportCasesCliArguments(argv: readonly string[]): ParsedReportCasesCliArguments {
  const cli = meow(reportCasesHelpText, {
    argv: normalizeCliArgv(argv),
    flags: {
      format: {
        default: 'table',
        type: 'string',
      },
      groupBy: {
        type: 'string',
      },
      where: {
        isMultiple: true,
        type: 'string',
      },
    },
    importMeta: import.meta,
  })

  const reportPath = cli.input[0]
  if (reportPath == null || reportPath.length === 0) {
    throw new Error('Missing required <reportPath> argument.')
  }

  return {
    format: normalizeReportCasesFormat(cli.flags.format),
    groupBy: cli.flags.groupBy,
    reportPath,
    where: cli.flags.where,
  }
}

function parseSelector(selector: string): { key: string, value: string } {
  const separatorIndex = selector.indexOf('=')
  if (separatorIndex <= 0 || separatorIndex === selector.length - 1) {
    throw new Error(`Invalid selector "${selector}". Expected "key=value".`)
  }

  return {
    key: selector.slice(0, separatorIndex).trim(),
    value: selector.slice(separatorIndex + 1).trim(),
  }
}

async function resolveCaseRecordPaths(reportPath: string): Promise<string[]> {
  const absoluteReportPath = resolve(reportPath)
  const directCaseFilePath = resolve(absoluteReportPath, 'cases.jsonl')

  if (existsSync(absoluteReportPath) && absoluteReportPath.endsWith('.jsonl')) {
    return [absoluteReportPath]
  }

  if (existsSync(directCaseFilePath)) {
    return [directCaseFilePath]
  }

  const discovered = await glob('**/cases.jsonl', {
    absolute: true,
    cwd: absoluteReportPath,
  })

  return discovered.sort((left, right) => left.localeCompare(right))
}
