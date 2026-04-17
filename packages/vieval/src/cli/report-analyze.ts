#!/usr/bin/env node

import type { ReportRunArtifact } from './report-artifacts'

import process from 'node:process'

import meow from 'meow'

import { errorMessageFrom } from '@moeru/std'

import { readReportArtifacts, summarizeReportRunArtifact } from './report-artifacts'

export interface ParsedReportAnalyzeCliArguments {
  attempt?: string
  caseState?: 'failed' | 'passed' | 'skipped'
  contains?: string
  evalMatrix?: Record<string, string>
  errorContains?: string
  experiment?: string
  format: 'csv' | 'json' | 'jsonl' | 'table'
  project?: string
  reportPath: string
  runMatrix?: Record<string, string>
  run?: string
  taskState?: 'failed' | 'passed' | 'skipped'
  workspace?: string
}

const reportAnalyzeHelpText = `
  Analyze generated vieval report artifacts.

  Usage
    $ vieval report analyze <reportPath> [options]

  Options
    --format       Output format: table | json | jsonl | csv (default: table)
    --workspace    Workspace id filter
    --project      Project name filter (exact)
    --experiment   Experiment id filter
    --attempt      Attempt id filter
    --run          Run id filter
    --task-state   Keep runs containing at least one task in this state
    --case-state   Keep runs containing at least one case in this state
    --contains     Keep runs containing this text in event name or payload
    --error-contains Keep runs containing this text in project errors or event payload
    --run-matrix   Keep runs matching run-matrix selector "key=value[,key=value]"
    --eval-matrix  Keep runs matching eval-matrix selector "key=value[,key=value]"
`

function normalizeCliArgv(argv: readonly string[]): string[] {
  const normalizedArgv = argv[0] === '--'
    ? argv.slice(1)
    : [...argv]

  if (normalizedArgv[0] === 'report' && normalizedArgv[1] === 'analyze') {
    return normalizedArgv.slice(2)
  }

  if (normalizedArgv[0] === 'analyze') {
    return normalizedArgv.slice(1)
  }

  return normalizedArgv
}

export function parseReportAnalyzeCliArguments(argv: readonly string[]): ParsedReportAnalyzeCliArguments {
  const cli = meow(reportAnalyzeHelpText, {
    argv: normalizeCliArgv(argv),
    flags: {
      attempt: {
        type: 'string',
      },
      caseState: {
        type: 'string',
      },
      contains: {
        type: 'string',
      },
      evalMatrix: {
        type: 'string',
      },
      errorContains: {
        type: 'string',
      },
      experiment: {
        type: 'string',
      },
      format: {
        default: 'table',
        type: 'string',
      },
      project: {
        type: 'string',
      },
      runMatrix: {
        type: 'string',
      },
      run: {
        type: 'string',
      },
      taskState: {
        type: 'string',
      },
      workspace: {
        type: 'string',
      },
    },
    importMeta: import.meta,
  })

  const reportPath = cli.input[0]

  if (reportPath == null || reportPath.length === 0) {
    throw new Error('Missing required <reportPath> argument.')
  }

  const normalizedFormat = cli.flags.format.toLowerCase()
  const format = normalizedFormat === 'json'
    ? 'json'
    : normalizedFormat === 'jsonl'
      ? 'jsonl'
      : normalizedFormat === 'csv'
        ? 'csv'
        : 'table'

  return {
    attempt: cli.flags.attempt,
    caseState: normalizeStateFilter(cli.flags.caseState),
    contains: cli.flags.contains,
    evalMatrix: parseMatrixSelector(cli.flags.evalMatrix),
    errorContains: cli.flags.errorContains,
    experiment: cli.flags.experiment,
    format,
    project: cli.flags.project,
    reportPath,
    runMatrix: parseMatrixSelector(cli.flags.runMatrix),
    run: cli.flags.run,
    taskState: normalizeStateFilter(cli.flags.taskState),
    workspace: cli.flags.workspace,
  }
}

function normalizeStateFilter(value: string | undefined): 'failed' | 'passed' | 'skipped' | undefined {
  if (value == null) {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'passed' || normalized === 'failed' || normalized === 'skipped') {
    return normalized
  }

  throw new Error(`Unsupported state filter "${value}". Expected "passed", "failed", or "skipped".`)
}

function parseMatrixSelector(value: string | undefined): Record<string, string> | undefined {
  if (value == null) {
    return undefined
  }

  const selector: Record<string, string> = {}
  const segments = value.split(',').map(segment => segment.trim()).filter(segment => segment.length > 0)

  for (const segment of segments) {
    const separatorIndex = segment.indexOf('=')
    if (separatorIndex <= 0 || separatorIndex === segment.length - 1) {
      throw new Error(`Invalid matrix selector segment "${segment}". Expected "key=value".`)
    }

    const key = segment.slice(0, separatorIndex).trim()
    const parsedValue = segment.slice(separatorIndex + 1).trim()
    if (key.length === 0 || parsedValue.length === 0) {
      throw new Error(`Invalid matrix selector segment "${segment}". Expected "key=value".`)
    }

    selector[key] = parsedValue
  }

  return selector
}

interface ReportAnalyzeOutput {
  experimentSummaries: ReportAnalyzeExperimentSummary[]
  filteredRunCount: number
  runs: ReturnType<typeof summarizeReportRunArtifact>[]
  totalRunCount: number
}

export interface ReportAnalyzeExperimentSummary {
  attemptCount: number
  attemptSummaries: ReportAnalyzeAttemptSummary[]
  attemptSuccessRateStats: {
    avg: number
    max: number
    min: number
    stdev: number
  }
  casePassRate?: number
  experimentId: string
  failedProjects: number
  runCount: number
  successRate: number
  taskPassRate?: number
  totalEvents: number
  totalTasks: number
  workspaceId: string
}

export interface ReportAnalyzeAttemptSummary {
  attemptId: string
  failedProjects: number
  runCount: number
  runIds: string[]
  successRate: number
  totalEvents: number
  totalTasks: number
}

function filterAnalyzeRows(
  rows: readonly ReturnType<typeof summarizeReportRunArtifact>[],
  parsed: ParsedReportAnalyzeCliArguments,
): ReturnType<typeof summarizeReportRunArtifact>[] {
  return rows.filter((row) => {
    if (parsed.workspace != null && row.workspaceId !== parsed.workspace) {
      return false
    }

    if (parsed.experiment != null && row.experimentId !== parsed.experiment) {
      return false
    }

    if (parsed.attempt != null && row.attemptId !== parsed.attempt) {
      return false
    }

    if (parsed.run != null && row.runId !== parsed.run) {
      return false
    }

    if (parsed.project != null && !row.projectNames.includes(parsed.project)) {
      return false
    }

    return true
  })
}

function includesNeedle(value: unknown, needle: string): boolean {
  const normalizedNeedle = needle.trim().toLowerCase()
  if (normalizedNeedle.length === 0) {
    return true
  }

  return JSON.stringify(value).toLowerCase().includes(normalizedNeedle)
}

function hasTaskState(artifact: ReportRunArtifact, targetState: 'failed' | 'passed' | 'skipped'): boolean {
  return artifact.events.some((event) => {
    if (event.event !== 'TaskEnded') {
      return false
    }

    const state = (event.data as { state?: unknown } | undefined)?.state
    return state === targetState
  })
}

function hasCaseState(artifact: ReportRunArtifact, targetState: 'failed' | 'passed' | 'skipped'): boolean {
  return artifact.events.some((event) => {
    if (event.event !== 'CaseEnded') {
      return false
    }

    const state = (event.data as { state?: unknown } | undefined)?.state
    return state === targetState
  })
}

function matchesMatrixSelector(matrix: Record<string, unknown>, selector: Record<string, string>): boolean {
  return Object.entries(selector).every(([key, expectedValue]) => String(matrix[key]) === expectedValue)
}

function hasRunMatrixMatch(artifact: ReportRunArtifact, selector: Record<string, string>): boolean {
  return artifact.summary.projects.some(project => project.result?.runs.some(run => matchesMatrixSelector(run.matrix.run, selector)) === true)
}

function hasEvalMatrixMatch(artifact: ReportRunArtifact, selector: Record<string, string>): boolean {
  return artifact.summary.projects.some(project => project.result?.runs.some(run => matchesMatrixSelector(run.matrix.eval, selector)) === true)
}

function matchesOutcomeFilters(artifact: ReportRunArtifact, parsed: ParsedReportAnalyzeCliArguments): boolean {
  if (parsed.runMatrix != null && !hasRunMatrixMatch(artifact, parsed.runMatrix)) {
    return false
  }

  if (parsed.evalMatrix != null && !hasEvalMatrixMatch(artifact, parsed.evalMatrix)) {
    return false
  }

  if (parsed.taskState != null && !hasTaskState(artifact, parsed.taskState)) {
    return false
  }

  if (parsed.caseState != null && !hasCaseState(artifact, parsed.caseState)) {
    return false
  }

  if (parsed.contains != null) {
    const matched = artifact.events.some(event => includesNeedle({ data: event.data, event: event.event }, parsed.contains!))
    if (!matched) {
      return false
    }
  }

  if (parsed.errorContains != null) {
    const projectErrors = artifact.summary.projects
      .map(project => project.errorMessage)
      .filter((errorMessage): errorMessage is string => errorMessage != null)
    const matchedError = projectErrors.some(errorMessage => includesNeedle(errorMessage, parsed.errorContains!))
      || artifact.events.some(event => includesNeedle(event.data, parsed.errorContains!))

    if (!matchedError) {
      return false
    }
  }

  return true
}

async function readReportAnalyzeOutput(parsed: ParsedReportAnalyzeCliArguments): Promise<ReportAnalyzeOutput> {
  const artifacts = await readReportArtifacts(parsed.reportPath)
  const rows = artifacts.map(artifact => summarizeReportRunArtifact(artifact))
  const identityFilteredRows = filterAnalyzeRows(rows, parsed)
  const rowByDirectory = new Map(identityFilteredRows.map(row => [row.reportDirectory, row]))

  const filteredRows = artifacts
    .filter(artifact => rowByDirectory.has(artifact.reportDirectory))
    .filter(artifact => matchesOutcomeFilters(artifact, parsed))
    .map(artifact => rowByDirectory.get(artifact.reportDirectory))
    .filter((row): row is ReturnType<typeof summarizeReportRunArtifact> => row != null)

  return {
    experimentSummaries: buildExperimentSummaries(filteredRows),
    filteredRunCount: filteredRows.length,
    runs: filteredRows,
    totalRunCount: rows.length,
  }
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6))
}

function computeAverage(values: readonly number[]): number {
  if (values.length === 0) {
    return 0
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function computeStandardDeviation(values: readonly number[]): number {
  if (values.length === 0) {
    return 0
  }

  const average = computeAverage(values)
  const variance = computeAverage(values.map(value => (value - average) ** 2))
  return Math.sqrt(variance)
}

function createExperimentGroupKey(row: ReturnType<typeof summarizeReportRunArtifact>): string {
  const workspaceId = row.workspaceId ?? 'unknown-workspace'
  const experimentId = row.experimentId ?? 'unknown-experiment'
  return `${workspaceId}::${experimentId}`
}

/**
 * Builds experiment-level rollups from filtered run rows.
 *
 * Use when:
 * - CLI consumers need stability and reliability summaries above per-run data
 *
 * Returns:
 * - one summary row per `workspaceId + experimentId` group
 */
export function buildExperimentSummaries(
  rows: readonly ReturnType<typeof summarizeReportRunArtifact>[],
): ReportAnalyzeExperimentSummary[] {
  const grouped = new Map<string, ReturnType<typeof summarizeReportRunArtifact>[]>()

  for (const row of rows) {
    const groupKey = createExperimentGroupKey(row)
    const existing = grouped.get(groupKey)
    if (existing == null) {
      grouped.set(groupKey, [row])
      continue
    }

    existing.push(row)
  }

  return [...grouped.entries()]
    .map(([groupKey, groupRows]) => {
      const [workspaceId, experimentId] = groupKey.split('::')
      const failedProjects = groupRows.reduce((sum, row) => sum + row.failedProjects, 0)
      const totalTasks = groupRows.reduce((sum, row) => sum + row.totalTasks, 0)
      const totalEvents = groupRows.reduce((sum, row) => sum + row.eventsCount, 0)
      const successfulRunCount = groupRows.filter(row => row.failedProjects === 0).length
      const successRate = groupRows.length === 0 ? 0 : successfulRunCount / groupRows.length

      const attemptToRuns = new Map<string, ReturnType<typeof summarizeReportRunArtifact>[]>()
      for (const row of groupRows) {
        const attemptId = row.attemptId ?? 'unknown-attempt'
        const attemptRows = attemptToRuns.get(attemptId)
        if (attemptRows == null) {
          attemptToRuns.set(attemptId, [row])
          continue
        }

        attemptRows.push(row)
      }

      const attemptSummaries = [...attemptToRuns.entries()]
        .map(([attemptId, attemptRows]) => {
          const successCount = attemptRows.filter(row => row.failedProjects === 0).length
          const runCount = attemptRows.length
          const failedProjectCount = attemptRows.reduce((sum, row) => sum + row.failedProjects, 0)
          const totalTaskCount = attemptRows.reduce((sum, row) => sum + row.totalTasks, 0)
          const totalEventCount = attemptRows.reduce((sum, row) => sum + row.eventsCount, 0)

          return {
            attemptId,
            failedProjects: failedProjectCount,
            runCount,
            runIds: attemptRows
              .map(row => row.runId)
              .filter((runId): runId is string => runId != null)
              .sort((left, right) => left.localeCompare(right)),
            successRate: roundMetric(runCount === 0 ? 0 : successCount / runCount),
            totalEvents: totalEventCount,
            totalTasks: totalTaskCount,
          }
        })
        .sort((left, right) => left.attemptId.localeCompare(right.attemptId))

      const attemptSuccessRates = attemptSummaries.map(summary => summary.successRate)
      const minAttemptSuccessRate = attemptSuccessRates.length === 0
        ? 0
        : Math.min(...attemptSuccessRates)
      const maxAttemptSuccessRate = attemptSuccessRates.length === 0
        ? 0
        : Math.max(...attemptSuccessRates)
      const avgAttemptSuccessRate = computeAverage(attemptSuccessRates)
      const stdevAttemptSuccessRate = computeStandardDeviation(attemptSuccessRates)

      return {
        attemptCount: attemptToRuns.size,
        attemptSummaries,
        attemptSuccessRateStats: {
          avg: roundMetric(avgAttemptSuccessRate),
          max: roundMetric(maxAttemptSuccessRate),
          min: roundMetric(minAttemptSuccessRate),
          stdev: roundMetric(stdevAttemptSuccessRate),
        },
        experimentId,
        failedProjects,
        runCount: groupRows.length,
        successRate: roundMetric(successRate),
        totalEvents,
        totalTasks,
        workspaceId,
      }
    })
    .sort((left, right) => {
      const workspaceCompare = left.workspaceId.localeCompare(right.workspaceId)
      if (workspaceCompare !== 0) {
        return workspaceCompare
      }

      return left.experimentId.localeCompare(right.experimentId)
    })
}

function formatTableOutput(output: ReportAnalyzeOutput): string {
  const header = 'Run ID | Workspace | Experiment | Attempt | Projects(executed/total) | FailedProjects | Tasks | Events'
  const lines = output.runs.map((row) => {
    const runId = row.runId ?? 'n/a'
    const workspaceId = row.workspaceId ?? 'n/a'
    const experimentId = row.experimentId ?? 'n/a'
    const attemptId = row.attemptId ?? 'n/a'
    const projects = `${row.executedProjects}/${row.totalProjects}`
    return `${runId} | ${workspaceId} | ${experimentId} | ${attemptId} | ${projects} | ${row.failedProjects} | ${row.totalTasks} | ${row.eventsCount}`
  })

  const metadata = `ANALYZE vieval report: ${output.filteredRunCount}/${output.totalRunCount} runs (${output.experimentSummaries.length} experiment groups)`
  return [metadata, header, ...lines].join('\n')
}

function formatCsvOutput(output: ReportAnalyzeOutput): string {
  const header = [
    'runId',
    'workspaceId',
    'experimentId',
    'attemptId',
    'totalProjects',
    'executedProjects',
    'failedProjects',
    'totalTasks',
    'eventsCount',
    'reportDirectory',
    'projectNames',
  ].join(',')
  const rows = output.runs.map((row) => {
    const escapedProjectNames = `"${row.projectNames.join('|').replaceAll('"', '""')}"`
    const escapedDirectory = `"${row.reportDirectory.replaceAll('"', '""')}"`

    return [
      row.runId ?? '',
      row.workspaceId ?? '',
      row.experimentId ?? '',
      row.attemptId ?? '',
      row.totalProjects.toString(),
      row.executedProjects.toString(),
      row.failedProjects.toString(),
      row.totalTasks.toString(),
      row.eventsCount.toString(),
      escapedDirectory,
      escapedProjectNames,
    ].join(',')
  })

  return [header, ...rows].join('\n')
}

export async function runReportAnalyzeCli(argv: readonly string[]): Promise<void> {
  try {
    const parsed = parseReportAnalyzeCliArguments(argv)
    const output = await readReportAnalyzeOutput(parsed)

    if (parsed.format === 'json') {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
      return
    }

    if (parsed.format === 'jsonl') {
      const jsonl = output.runs.map(run => JSON.stringify(run)).join('\n')
      process.stdout.write(`${jsonl}${jsonl.length > 0 ? '\n' : ''}`)
      return
    }

    if (parsed.format === 'csv') {
      process.stdout.write(`${formatCsvOutput(output)}\n`)
      return
    }

    process.stdout.write(`${formatTableOutput(output)}\n`)
  }
  catch (error) {
    const errorMessage = errorMessageFrom(error) ?? 'Unknown report analyze failure.'
    process.stderr.write(`[vieval report analyze] ${errorMessage}\n`)
    process.exitCode = 1
  }
}
