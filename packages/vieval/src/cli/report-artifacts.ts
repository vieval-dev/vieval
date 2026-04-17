import type { CliRunOutput } from './run'

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { glob } from 'tinyglobby'

export interface ReportRunArtifact {
  eventsCount: number
  events: ReportRunEvent[]
  reportDirectory: string
  summary: CliRunOutput
  summaryFilePath: string
}

/**
 * Minimal event envelope used by report analysis.
 */
export interface ReportRunEvent {
  caseId?: string
  data?: unknown
  event: string
  taskId?: string
}

export interface ReportRunSummaryRow {
  attemptId: string | null
  eventsCount: number
  executedProjects: number
  experimentId: string | null
  failedProjects: number
  projectNames: string[]
  reportDirectory: string
  runId: string | null
  totalProjects: number
  totalTasks: number
  workspaceId: string | null
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
        .filter(line => line.trim().length > 0)
        .map((line) => {
          const event = JSON.parse(line) as ReportRunEvent
          return {
            caseId: event.caseId,
            data: event.data,
            event: event.event,
            taskId: event.taskId,
          } satisfies ReportRunEvent
        })
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
