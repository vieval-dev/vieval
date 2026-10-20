import type { HeadlineResult } from '../core/scoring'
import type { RunEventEnvelope, ScoreDefinedData } from '../events'
import type { CliProjectSummary, CliRunOutput } from './run'

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { glob } from 'tinyglobby'

import * as v from 'valibot'

import { emptyScoreSummary, resolveHeadline } from '../core/scoring'
import { caseStarted, caseStartedDataSchema } from '../events'
import { OLDER_REPORT_MESSAGE, readReportEvents } from './report-log'
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
  summary: RunSummaryFile
  summaryFilePath: string
}

/**
 * Content of one run's `run-summary.json`: the invocation output narrowed to the run's one project, plus the run's
 * own id and directory.
 */
export interface RunSummaryFile extends Omit<CliRunOutput, 'projects'> {
  /**
   * Headline of the run over every project, resolved with `resolveHeadline` from the projects' task runs.
   */
  headline: HeadlineResult
  /** One summary per project; a run holds one project. */
  projects: RunSummaryProject[]
  /** Directory of this run's report. */
  reportDirectory: string
  /** Id of this run (one project of the invocation). */
  runId: string
  /**
   * Version of this file's shape; readers reject other versions.
   *
   * - 1: one project per run, `invocationId` shared by the runs of one invocation.
   * - 2: named scores. `result` holds `ScoreSummary` lists; each project has `scoreDefinitions` and `headline`, and
   *   the run has `scoreDefinitions` and `headline`.
   */
  schemaVersion: typeof RUN_SUMMARY_SCHEMA_VERSION
  /**
   * Latest `score.defined` of each score name over every project, in first-announced order; labels {@link headline}.
   */
  scoreDefinitions: ScoreDefinedData[]
}

/**
 * One project of {@link RunSummaryFile}.
 */
export interface RunSummaryProject extends CliProjectSummary {
  /** Headline of the project (`result.overall.headline`), or `null` when the project has no result. */
  headline: HeadlineResult | null
  /** Latest `score.defined` of each score name the project announced. */
  scoreDefinitions: NonNullable<CliProjectSummary['scoreDefinitions']>
}

/** Current version of {@link RunSummaryFile}. */
export const RUN_SUMMARY_SCHEMA_VERSION = 2

/**
 * One line of `events.jsonl`.
 */
export type ReportRunEvent = RunEventEnvelope

export interface ReportRunSummaryRow {
  attemptId: null | string
  /**
   * Cases (per task) that ran at least one auto attempt after the first, i.e. had a `case.started` with
   * `attemptIndex > 0`.
   */
  autoAttemptedCases: number
  eventsCount: number
  executedProjects: number
  experimentId: null | string
  failedProjects: number
  /** Highest `attemptIndex` of any `case.started`, or `null` when no task ran auto attempts. */
  maxAttemptIndex: null | number
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
  const summary = readRunSummary(summaryFilePath)
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
 * Reads one `run-summary.json`.
 *
 * Use when:
 * - a report command needs a run's official numbers, headline, or score definitions
 *
 * Returns:
 * - the parsed summary
 * - throws {@link OLDER_REPORT_MESSAGE} for a summary of an older schema version, and an unsupported-version error
 *   for a newer one
 */
export function readRunSummary(summaryFilePath: string): RunSummaryFile {
  const summary = JSON.parse(readFileSync(summaryFilePath, 'utf-8')) as Partial<RunSummaryFile>
  const schemaVersion = summary.schemaVersion as number | undefined
  if (schemaVersion == null || schemaVersion < RUN_SUMMARY_SCHEMA_VERSION) {
    throw new Error(`${OLDER_REPORT_MESSAGE} ("${summaryFilePath}", run summary schema version ${String(schemaVersion ?? 'none')})`)
  }
  if (schemaVersion !== RUN_SUMMARY_SCHEMA_VERSION) {
    throw new Error(`Unsupported run summary "${summaryFilePath}": schema version ${schemaVersion}, this vieval reads ${RUN_SUMMARY_SCHEMA_VERSION}. Use the vieval version that wrote it.`)
  }
  return summary as RunSummaryFile
}

/**
 * Resolves the directory that holds one run's report artifacts.
 *
 * Use when:
 * - a project's run starts and needs a stable place for its live event log and case artifacts
 *
 * Returns:
 * - `<reportRoot>/<workspace>/<project>/<experiment>/<attempt>/<run>`; every project runs as its own run, so the
 *   project segment is always that project's name
 */
export function resolveRunReportDirectory(
  reportRoot: string,
  identity: ReportArtifactIdentity,
  projectName: string,
): string {
  return resolve(
    reportRoot,
    identity.workspaceId,
    sanitizeIdentitySegment(projectName),
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
 * Normalizes one identity id (workspace, experiment, attempt) into a safe report path segment.
 *
 * Before:
 * - " attempt 2026/10/19 ", "", "matrix:model=a"
 *
 * After:
 * - "attempt-2026-10-19", "default", "matrix-model-a"
 */
export function sanitizeIdentitySegment(value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) {
    return 'default'
  }

  return normalized.replace(/[^\w.-]+/g, '-')
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
  const autoAttempts = summarizeAutoAttempts(artifact.events)

  return {
    attemptId: artifact.summary.attemptId ?? null,
    autoAttemptedCases: autoAttempts.autoAttemptedCases,
    eventsCount: artifact.eventsCount,
    executedProjects,
    experimentId: artifact.summary.experimentId ?? null,
    failedProjects,
    maxAttemptIndex: autoAttempts.maxAttemptIndex,
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
 * - `output` holds the invocation identity and exactly the one project of this run
 *
 * Returns:
 * - the report directory path
 */
export async function writeRunReportArtifacts(
  output: CliRunOutput,
  identity: ReportArtifactIdentity,
  reportDirectory: string,
): Promise<string> {
  const projectName = output.projects[0]?.name ?? 'default-project'
  const events = readReportEvents(resolve(reportDirectory, 'events.jsonl'))
  const persistedOutput: RunSummaryFile = {
    ...output,
    headline: resolveRunHeadline(output.projects),
    projects: output.projects.map(project => ({
      ...project,
      headline: project.result?.overall.headline ?? null,
      scoreDefinitions: project.scoreDefinitions ?? [],
    })),
    reportDirectory,
    runId: identity.runId,
    schemaVersion: RUN_SUMMARY_SCHEMA_VERSION,
    // A later project's definition of a name replaces an earlier one, as viewers keep the latest per name.
    scoreDefinitions: [...new Map(output.projects.flatMap(project => (project.scoreDefinitions ?? []).map(definition => [definition.name, definition] as const))).values()],
  }

  await mkdir(reportDirectory, { recursive: true })
  await writeFile(
    resolve(reportDirectory, 'run-summary.json'),
    `${JSON.stringify(persistedOutput, null, 2)}\n`,
    'utf-8',
  )

  const caseRecords = buildCaseRecords({
    events,
    projectName,
  })
  const metricsSummary = buildMetricsSummary(caseRecords, [])
  const otlp = buildLocalOtlpProjection({ identity, records: caseRecords })

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

/**
 * Resolves the headline of a run over the task runs of every project.
 *
 * Expects:
 * - task runs of all projects; the entry id names a task, as in `aggregateRunResults`
 */
function resolveRunHeadline(projects: readonly CliProjectSummary[]): HeadlineResult {
  return resolveHeadline(projects.flatMap(project => (project.result?.runs ?? []).map(run => ({
    completion: run.completion ?? emptyScoreSummary('completion'),
    passed: run.passed ?? emptyScoreSummary('passed'),
    ...(run.primary == null ? {} : { primary: run.primary }),
    scores: run.scores,
    taskId: run.entryId,
  }))))
}

/**
 * Collects auto attempt statistics from the `attemptIndex` of `case.started` events.
 *
 * Before:
 * - starts of `case-a` at attempts 0 and 1, and of `case-b` at attempt 0
 * - starts without `attemptIndex` (no task ran auto attempts, or a log written before the field existed)
 *
 * After:
 * - `{ autoAttemptedCases: 1, maxAttemptIndex: 1 }`
 * - `{ autoAttemptedCases: 0, maxAttemptIndex: null }`
 */
function summarizeAutoAttempts(events: readonly RunEventEnvelope[]): Pick<ReportRunSummaryRow, 'autoAttemptedCases' | 'maxAttemptIndex'> {
  const autoAttemptedCaseKeys = new Set<string>()
  let maxAttemptIndex: null | number = null

  for (const event of events) {
    if (event.event !== caseStarted.id) {
      continue
    }

    const result = v.safeParse(caseStartedDataSchema, event.data)
    const attemptIndex = result.success ? result.output.attemptIndex : undefined
    if (attemptIndex == null) {
      continue
    }

    maxAttemptIndex = Math.max(maxAttemptIndex ?? 0, attemptIndex)
    if (attemptIndex > 0) {
      autoAttemptedCaseKeys.add(`${event.taskId ?? ''}\u0000${event.caseId ?? ''}`)
    }
  }

  return {
    autoAttemptedCases: autoAttemptedCaseKeys.size,
    maxAttemptIndex,
  }
}
