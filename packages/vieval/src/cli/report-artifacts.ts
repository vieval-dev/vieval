import type { RunEventEnvelope } from '../events'
import type { CliRunOutput } from './run'

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { glob } from 'tinyglobby'

import { readReportEvents } from './report-log'
import { buildLocalOtlpProjection } from './report-otlp'
import { buildCaseRecords, buildMetricsSummary, encodeJsonl } from './report-records'

/** Identity segments used to place report artifacts on disk. */
export interface ReportArtifactIdentity {
  /** Attempt id path segment and default case record identity. */
  attemptId: string
  /** Experiment id path segment and default case record identity. */
  experimentId: string
  /** Run id path segment and default case record identity. */
  runId: string
  /** Workspace id path segment and default case record identity. */
  workspaceId: string
}

export interface ReportRunArtifact {
  events: ReportRunEvent[]
  eventsCount: number
  reportDirectory: string
  summary: CliRunOutput
  summaryFilePath: string
}

/**
 * One line of `events.jsonl`.
 */
export type ReportRunEvent = RunEventEnvelope

export interface ReportRunSummaryRow {
  attemptId: null | string
  eventsCount: number
  executedProjects: number
  experimentId: null | string
  failedProjects: number
  projectNames: string[]
  reportDirectory: string
  runId: null | string
  totalProjects: number
  totalTasks: number
  workspaceId: null | string
}

/**
 * Reads all run artifacts found under `reportPath`.
 *
 * Use when:
 * - callers need multi-run analysis from a directory root
 */
export async function readReportArtifacts(reportPath: string): Promise<ReportRunArtifact[]> {
  const summaryFilePaths = await resolveRunSummaryPaths(reportPath)
  return summaryFilePaths.map(summaryFilePath => readReportRunArtifact(summaryFilePath))
}

/**
 * Reads one run report artifact set from `run-summary.json` and sibling `events.jsonl`.
 *
 * Use when:
 * - report analysis needs both run aggregate output and event count metadata
 */
export function readReportRunArtifact(summaryFilePath: string): ReportRunArtifact {
  const reportDirectory = resolve(summaryFilePath, '..')
  const summary = JSON.parse(readFileSync(summaryFilePath, 'utf-8')) as CliRunOutput
  const events = readReportEvents(resolve(reportDirectory, 'events.jsonl'))

  return {
    events,
    eventsCount: events.length,
    reportDirectory,
    summary,
    summaryFilePath,
  }
}

/**
 * Resolves the directory that holds one run's report artifacts.
 *
 * Use when:
 * - the run starts and needs a stable place for its live event log and case artifacts
 *
 * Expects:
 * - `projectNames` are the projects selected for the run, known before execution starts
 *
 * Returns:
 * - `<reportRoot>/<workspace>/<project>/<experiment>/<attempt>/<run>`, where the project segment is the
 *   only selected project name, or `multi-project` when several projects run together
 */
export function resolveRunReportDirectory(
  reportRoot: string,
  identity: ReportArtifactIdentity,
  projectNames: readonly string[],
): string {
  return resolve(
    reportRoot,
    identity.workspaceId,
    deriveReportProjectId(projectNames),
    identity.experimentId,
    identity.attemptId,
    identity.runId,
  )
}

/**
 * Resolves one or more `run-summary.json` paths from a report location.
 *
 * Use when:
 * - callers may pass a run directory, summary file path, or a report root
 *
 * Returns:
 * - sorted absolute summary file paths
 */
export async function resolveRunSummaryPaths(reportPath: string): Promise<string[]> {
  const absoluteReportPath = resolve(reportPath)
  const directSummaryPath = resolve(absoluteReportPath, 'run-summary.json')

  if (existsSync(absoluteReportPath) && absoluteReportPath.endsWith('.json')) {
    return [absoluteReportPath]
  }

  if (existsSync(directSummaryPath)) {
    return [directSummaryPath]
  }

  const discovered = await glob('**/run-summary.json', {
    absolute: true,
    cwd: absoluteReportPath,
  })

  return discovered.sort((left, right) => left.localeCompare(right))
}

/**
 * Creates a compact summary row for one run artifact.
 *
 * Use when:
 * - table/csv/jsonl exports should stay stable and cheap to parse
 */
export function summarizeReportRunArtifact(artifact: ReportRunArtifact): ReportRunSummaryRow {
  const totalProjects = artifact.summary.projects.length
  const failedProjects = artifact.summary.projects.filter(project => project.errorMessage != null).length
  const executedProjects = artifact.summary.projects.filter(project => project.executed).length
  const totalTasks = artifact.summary.projects.reduce((sum, project) => sum + project.taskCount, 0)
  const projectNames = artifact.summary.projects.map(project => project.name)

  return {
    attemptId: artifact.summary.attemptId ?? null,
    eventsCount: artifact.eventsCount,
    executedProjects,
    experimentId: artifact.summary.experimentId ?? null,
    failedProjects,
    projectNames,
    reportDirectory: artifact.reportDirectory,
    runId: artifact.summary.runId ?? null,
    totalProjects,
    totalTasks,
    workspaceId: artifact.summary.workspaceId ?? null,
  }
}

/**
 * Writes the summary artifacts of one finished run, derived from its event log.
 *
 * Use when:
 * - the run ended and its live `events.jsonl` is closed
 * - report commands need normalized case, metrics, and OTLP-shaped files
 *
 * Expects:
 * - `reportDirectory` comes from {@link resolveRunReportDirectory} and already holds `events.jsonl`
 * - `output` already contains run identity fields
 *
 * Returns:
 * - the report directory path
 */
export async function writeRunReportArtifacts(
  output: CliRunOutput,
  identity: ReportArtifactIdentity,
  reportDirectory: string,
): Promise<string> {
  const projectId = deriveReportProjectId(output.projects.map(project => project.name))
  const events = readReportEvents(resolve(reportDirectory, 'events.jsonl'))
  const persistedOutput: CliRunOutput = {
    ...output,
    reportDirectory,
  }

  await mkdir(reportDirectory, { recursive: true })
  await writeFile(
    resolve(reportDirectory, 'run-summary.json'),
    `${JSON.stringify(persistedOutput, null, 2)}\n`,
    'utf-8',
  )

  const caseRecords = buildCaseRecords({
    events,
    projectName: projectId,
  })
  const metricsSummary = buildMetricsSummary(caseRecords, [])
  const otlp = buildLocalOtlpProjection({ records: caseRecords, runId: identity.runId })

  await writeFile(resolve(reportDirectory, 'cases.jsonl'), encodeJsonl(caseRecords), 'utf-8')
  await writeFile(
    resolve(reportDirectory, 'metrics-summary.json'),
    `${JSON.stringify(metricsSummary, null, 2)}\n`,
    'utf-8',
  )
  await mkdir(resolve(reportDirectory, 'otlp'), { recursive: true })
  await mkdir(resolve(reportDirectory, 'benchmark'), { recursive: true })
  await writeFile(resolve(reportDirectory, 'otlp', 'traces.json'), `${JSON.stringify(otlp.traces, null, 2)}\n`, 'utf-8')
  await writeFile(resolve(reportDirectory, 'otlp', 'logs.json'), `${JSON.stringify(otlp.logs, null, 2)}\n`, 'utf-8')
  await writeFile(resolve(reportDirectory, 'otlp', 'metrics.json'), `${JSON.stringify(otlp.metrics, null, 2)}\n`, 'utf-8')

  return reportDirectory
}

function deriveReportProjectId(projectNames: readonly string[]): string {
  const uniqueProjectNames = [...new Set(projectNames)]
  if (uniqueProjectNames.length === 1) {
    return sanitizeIdentitySegment(uniqueProjectNames[0] ?? 'default-project')
  }

  return 'multi-project'
}

function sanitizeIdentitySegment(value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) {
    return 'default'
  }

  return normalized.replace(/[^\w.-]+/g, '-')
}
