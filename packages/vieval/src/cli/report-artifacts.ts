import type { RunEventEnvelope } from '../events'
import type { CliRunOutput } from './run'

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { glob } from 'tinyglobby'

import * as v from 'valibot'

import { RUN_EVENT_SCHEMA_VERSION, runEventEnvelopeSchema } from '../events'
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
  const eventsFilePath = resolve(reportDirectory, 'events.jsonl')
  const events = existsSync(eventsFilePath)
    ? readFileSync(eventsFilePath, 'utf-8')
        .split('\n')
        .map((line, index) => ({ line, lineNumber: index + 1 }))
        .filter(({ line }) => line.trim().length > 0)
        .map(({ line, lineNumber }) => parseReportRunEvent(line, `${eventsFilePath}:${lineNumber}`))
    : []

  return {
    events,
    eventsCount: events.length,
    reportDirectory,
    summary,
    summaryFilePath,
  }
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
 * Writes one complete local run report artifact set.
 *
 * Use when:
 * - CLI runs need deterministic local artifacts under workspace/project/experiment/attempt/run
 * - report commands need normalized case, metrics, and OTLP-shaped files
 *
 * Expects:
 * - `events` are the same envelopes written to `events.jsonl`
 * - `output` already contains run identity fields
 *
 * Returns:
 * - absolute report directory path containing the written artifacts
 */
export async function writeRunReportArtifacts(
  output: CliRunOutput,
  events: readonly ReportRunEvent[],
  identity: ReportArtifactIdentity,
  reportOut: string,
): Promise<string> {
  const projectId = deriveReportProjectId(output)
  const reportDirectory = resolve(
    reportOut,
    identity.workspaceId,
    projectId,
    identity.experimentId,
    identity.attemptId,
    identity.runId,
  )
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
  await writeFile(
    resolve(reportDirectory, 'events.jsonl'),
    events.map(event => JSON.stringify(event)).join('\n').concat(events.length > 0 ? '\n' : ''),
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

function deriveReportProjectId(output: CliRunOutput): string {
  const uniqueProjectNames = [...new Set(output.projects.map(project => project.name))]
  if (uniqueProjectNames.length === 1) {
    return sanitizeIdentitySegment(uniqueProjectNames[0] ?? 'default-project')
  }

  return 'multi-project'
}

/**
 * Parses one `events.jsonl` line and rejects envelopes of other report schema versions.
 */
function parseReportRunEvent(line: string, location: string): ReportRunEvent {
  const result = v.safeParse(runEventEnvelopeSchema, JSON.parse(line))
  if (!result.success) {
    throw new Error(`Unsupported event record at ${location}: expected report schema version ${RUN_EVENT_SCHEMA_VERSION}. Reports written by older vieval versions cannot be read; re-run the eval to regenerate them.`)
  }

  return result.output
}

function sanitizeIdentitySegment(value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) {
    return 'default'
  }

  return normalized.replace(/[^\w.-]+/g, '-')
}
