import type { ComparisonRun } from './compare'
import type { CaseDetail, ExternalLogsResponse, FileTreeResponse, LogLine, MetricsResponse, OtelLogsResponse, OtelMetricsResponse, OtelTracesResponse, ProgressResponse, RunListItem, RunSnapshot, ScoresResponse, ScreenshotTimeline, TimelineResponse } from './contract'

/** Entry point of a static site, ordered by most recent run first. */
export interface PublishedCatalog {
  /** Run summaries in file order. */
  runs: RunListItem[]
  /** Format version expected by the accompanying Viewer. */
  version: 1
}

/** Comparison and matrix inputs published independently of case details and logs. */
export type PublishedComparison = Omit<ComparisonRun, 'item'>

/** Data needed to inspect one completed run and its cases. */
export interface PublishedRun {
  /** Directory views for included evidence, keyed by link ID. */
  evidenceViews: Record<string, { timeline?: ScreenshotTimeline, tree: FileTreeResponse }>
  /** Relative file URLs, keyed by file identity. */
  files: Record<string, string>
  /** Console lines in recorded order. */
  logs: LogLine[]
  /** Unfiltered metrics for the run. */
  metrics: MetricsResponse
  /** Paths and reasons for artifacts or evidence left out of the site. */
  omitted: { path: string, reason: string }[]
  /** Telemetry views. Raw files remain separate. */
  otel: { logs: OtelLogsResponse, metrics: OtelMetricsResponse, traces: OtelTracesResponse }
  /** Timing and score summaries. */
  progress: ProgressResponse
  scores: ScoresResponse
  /** Execution tree and final run state. */
  snapshot: RunSnapshot
  /** Task views indexed by task ID. */
  tasks: Record<string, PublishedTask>
  /** Retry timeline for the entire run. */
  timeline: TimelineResponse
}

/** Inspection views of a task and its individual cases. */
export interface PublishedTask {
  /** Detail views indexed by case ID. */
  cases: Record<string, { detail: CaseDetail, externalLogs?: ExternalLogsResponse, timeline: TimelineResponse }>
  /** Full metric series and retry timeline for the task. */
  metrics: MetricsResponse
  timeline: TimelineResponse
}

export const CATALOG_PATH = 'report/catalog.json'

/** Identifies one file within a run, including the evidence link when applicable. */
export function fileKey(path: string, linkId?: string): string {
  return JSON.stringify([linkId ?? null, path])
}

/** Locates the report or comparison data of a run by its index in the published catalog. */
export function runDataPath(index: number, kind: 'comparison' | 'run'): string {
  return `report/${kind}/${index}.json`
}

/** Identifies the optional raw telemetry document of a published run. */
export function telemetryPath(index: number, signal: 'logs' | 'metrics' | 'traces'): string {
  return `report/otel/${index}/${signal}.json`
}
