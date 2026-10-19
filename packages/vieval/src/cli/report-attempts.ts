import type { RunSummaryFile } from './report-artifacts'

import process from 'node:process'

import { existsSync, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import meow from 'meow'

import { glob } from 'tinyglobby'

const reportAttemptsHelpText = `
  Usage
    $ vieval report attempts [reportRoot] [options]

  Lists the attempts in a report root, newest first, with how many cases have no result, so you can pick one to
  continue with "vieval run --resume <attemptId>". "←" marks the attempt "--resume" picks without an id.

  Options
    --config, -c   Config whose .vieval/reports is listed when no reportRoot is given
    --experiment   Only this experiment
    --workspace    Only this workspace (repeatable)
    --format       table | json (default: table)
`

/**
 * One attempt of one experiment, summed over its workspaces and projects.
 */
export interface AttemptRow {
  attemptId: string
  /** Cases summed over the runs that wrote a `run-summary.json`. */
  cases: { errored: number, failed: number, passed: number, timeout: number, total: number }
  /** Share of settled cases with a result, or `null` when no case settled. */
  coverage: null | number
  experimentId: string
  /** Signal that interrupted the attempt, when a run recorded one. */
  interruptSignal?: string
  /** Whether `vieval run --resume` without an id picks this attempt: the experiment's attempt that changed last. */
  latest: boolean
  /** Latest modification time of the attempt's directories, in ms. */
  modifiedAt: number
  /** Attempt this one resumed, when it was started with `--resume`. */
  resumedFrom?: string
  /** Runs without a `run-summary.json`: their process was killed before it wrote one. */
  unfinishedRuns: number
  workspaces: string[]
}

/**
 * Formats attempt rows as an aligned table.
 *
 * Returns:
 * - a header and one line per attempt; "←" marks the latest attempt of each experiment
 */
export function formatAttemptsTable(rows: readonly AttemptRow[]): string {
  if (rows.length === 0) {
    return 'No attempts found.'
  }

  const header = ['EXPERIMENT', 'ATTEMPT', '', 'WORKSPACES', 'CASES', 'PASSED', 'FAILED', 'NO RESULT', 'COVERAGE', 'NOTES']
  const lines = rows.map((row) => {
    const notes = [
      ...(row.resumedFrom == null ? [] : [`resumed ${row.resumedFrom}`]),
      ...(row.interruptSignal == null ? [] : [`interrupted by ${row.interruptSignal}`]),
      ...(row.unfinishedRuns === 0 ? [] : [`${row.unfinishedRuns} run${row.unfinishedRuns === 1 ? '' : 's'} without summary`]),
    ]
    return [
      row.experimentId,
      row.attemptId,
      row.latest ? '←' : '',
      String(row.workspaces.length),
      String(row.cases.total),
      String(row.cases.passed),
      String(row.cases.failed),
      String(row.cases.errored + row.cases.timeout),
      row.coverage == null ? '-' : `${(row.coverage * 100).toFixed(1)}%`,
      notes.join('; '),
    ]
  })
  const widths = header.map((title, column) => Math.max(title.length, ...lines.map(line => line[column]!.length)))

  return [header, ...lines].map(line => line.map((cell, column) => cell.padEnd(widths[column]!)).join('  ').trimEnd()).join('\n')
}

/**
 * Lists the attempts in a report root.
 *
 * Use when:
 * - choosing an attempt to resume, or checking which attempts left cases without a result
 *
 * Expects:
 * - the report layout `<reportRoot>/<workspace>/<project>/<experiment>/<attempt>/<run>/`
 *
 * Returns:
 * - one row per experiment and attempt, newest first; `latest` matches what `--resume` without an id picks
 */
export async function listAttempts(reportRoot: string, filters: { experiment?: string, workspace?: readonly string[] } = {}): Promise<AttemptRow[]> {
  const attemptDirectories = await glob('*/*/*/*', { cwd: reportRoot, onlyDirectories: true })
  const rows = new Map<string, AttemptRow>()

  for (const relativeDirectory of attemptDirectories) {
    const [workspaceId, , experimentId, attemptId] = relativeDirectory.replace(/[/\\]+$/, '').split(/[/\\]/)
    if (workspaceId == null || experimentId == null || attemptId == null) {
      continue
    }
    if ((filters.experiment != null && experimentId !== filters.experiment) || (filters.workspace?.length && !filters.workspace.includes(workspaceId))) {
      continue
    }

    const directory = join(reportRoot, relativeDirectory)
    const key = `${experimentId}\u0000${attemptId}`
    const row = rows.get(key) ?? {
      attemptId,
      cases: { errored: 0, failed: 0, passed: 0, timeout: 0, total: 0 },
      coverage: null,
      experimentId,
      latest: false,
      modifiedAt: 0,
      unfinishedRuns: 0,
      workspaces: [],
    }
    rows.set(key, row)
    row.modifiedAt = Math.max(row.modifiedAt, (await stat(directory)).mtimeMs)
    if (!row.workspaces.includes(workspaceId)) {
      row.workspaces.push(workspaceId)
    }

    for (const runDirectory of await glob('*', { cwd: directory, onlyDirectories: true })) {
      const summaryPath = join(directory, runDirectory, 'run-summary.json')
      if (!existsSync(summaryPath)) {
        row.unfinishedRuns += 1
        continue
      }
      const summary = JSON.parse(readFileSync(summaryPath, 'utf-8')) as RunSummaryFile
      row.interruptSignal ??= summary.interruptSignal
      row.resumedFrom ??= summary.resumedFrom
      for (const project of summary.projects) {
        for (const state of ['errored', 'failed', 'passed', 'timeout', 'total'] as const) {
          row.cases[state] += project.caseSummary?.[state] ?? 0
        }
      }
    }
  }

  const sorted = [...rows.values()].sort((left, right) => right.modifiedAt - left.modifiedAt)
  const seenExperiments = new Set<string>()
  for (const row of sorted) {
    const settled = row.cases.passed + row.cases.failed + row.cases.errored + row.cases.timeout
    row.coverage = settled === 0 ? null : (row.cases.passed + row.cases.failed) / settled
    row.workspaces.sort()
    // Rows are newest first, so the first row of an experiment is the one `--resume` picks.
    row.latest = !seenExperiments.has(row.experimentId)
    seenExperiments.add(row.experimentId)
  }

  return sorted
}

/**
 * Runs `vieval report attempts`.
 *
 * Call stack:
 *
 * published executable (`../bin/vieval`)
 *   -> runTopLevelCli (./index)
 *     -> {@link runReportAttemptsCli}
 *       -> {@link listAttempts}
 *
 * Expects:
 * - argv is `attempts [reportRoot] ...`
 *
 * Returns:
 * - resolves after writing the table or JSON to stdout
 */
export async function runReportAttemptsCli(argv: readonly string[], cwd = process.cwd()): Promise<void> {
  const cli = meow(reportAttemptsHelpText, {
    argv: argv[0] === 'attempts' ? argv.slice(1) : [...argv],
    flags: {
      config: { shortFlag: 'c', type: 'string' },
      experiment: { type: 'string' },
      format: { default: 'table', type: 'string' },
      workspace: { isMultiple: true, type: 'string' },
    },
    importMeta: import.meta,
  })
  if (cli.flags.format !== 'table' && cli.flags.format !== 'json') {
    throw new Error(`Invalid --format "${cli.flags.format}". Expected "table" or "json".`)
  }

  // The same default as `vieval viewer`: the reports next to the config, else in the current directory.
  const reportRoot = cli.input[0] == null
    ? join(cli.flags.config == null ? cwd : dirname(resolve(cwd, cli.flags.config)), '.vieval', 'reports')
    : resolve(cwd, cli.input[0])
  if (!existsSync(reportRoot)) {
    throw new Error(`Report root "${reportRoot}" does not exist. Run "vieval run" first, or pass the directory that holds the reports.`)
  }

  const rows = await listAttempts(reportRoot, { experiment: cli.flags.experiment, workspace: cli.flags.workspace })
  process.stdout.write(`${cli.flags.format === 'json' ? JSON.stringify(rows, null, 2) : formatAttemptsTable(rows)}\n`)
}
