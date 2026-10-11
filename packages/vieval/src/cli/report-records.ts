import type { CaseEndedData, CaseStartedData, RunEventEnvelope } from '../events'

import * as v from 'valibot'

import { caseEnded, caseEndedDataSchema, caseStarted, caseStartedDataSchema, metricRecorded, metricRecordedDataSchema, scoreRecorded, scoreRecordedDataSchema } from '../events'

/** Arguments for building normalized case records from report events. */
export interface BuildCaseRecordsArgs {
  /** Run events ordered by `seq`. */
  events: readonly RunEventEnvelope[]
  /** Project name for events without `projectId`, for example from custom project executors. */
  projectName: string
}

/** Scalar and array metric values persisted in case records. */
export type CaseMetricValue = boolean | null | number | readonly unknown[] | string

/**
 * Normalized case artifact record written to `cases.jsonl`.
 *
 * Use when:
 * - report commands need dataframe-friendly case inspection records
 * - later processors need generic scores, metrics, lifecycle, and identity fields
 *
 * Expects:
 * - one record represents one final case outcome for one task in one run
 * - `metrics` stores JSON-safe scalar or array values emitted by task code
 *
 * Returns:
 * - a stable schema-versioned case projection for local report artifacts
 */
export interface CaseRecord {
  /** Attempt identity attached to the run. */
  attemptId: string
  /** Stable case id within the task. */
  caseId: string
  /** Human-readable case name. */
  caseName: string
  /** Non-negative duration in milliseconds when timestamps parse cleanly. */
  durationMs: number
  /** ISO-ish case end timestamp, or the best event timestamp available. */
  endedAt: string
  /** Experiment identity attached to the run. */
  experimentId: string
  /** Optional case input when emitted by lifecycle events. */
  input?: unknown
  /** Metric values keyed by metric name. */
  metrics: Record<string, CaseMetricValue>
  /** Optional case output when emitted by lifecycle events. */
  output?: unknown
  /** Project name for the task/case when known. */
  projectName: string
  /** Number of retries represented in the final case outcome. */
  retryCount: number
  /** Run identity attached to the run. */
  runId: string
  /** Case record schema version. */
  schemaVersion: 1
  /** Score values keyed by score kind. */
  scores: Record<string, number>
  /** ISO-ish case start timestamp, or the best event timestamp available. */
  startedAt: string
  /** Final terminal case state. */
  state: CaseRecordState
  /** Scheduled task id that owns the case. */
  taskId: string
  /** Workspace identity attached to the run. */
  workspaceId: string
}

/** Terminal state stored for one normalized case record. */
export type CaseRecordState = 'failed' | 'passed' | 'skipped' | 'timeout'

/** Generic metrics summary for overall scores and requested group facets. */
export interface MetricsSummary {
  /** Score aggregates keyed by `<groupKey>=<groupValue>`. */
  groups: Record<string, ScoreSummary>
  /** Overall score aggregates keyed by score kind. */
  overall: ScoreSummary
}

/** Generic score summary keyed by score kind. */
export type ScoreSummary = Record<string, ScoreSummaryBucket>

/** Score aggregate for one score kind. */
export interface ScoreSummaryBucket {
  /** Average score for this kind, or `0` when count is zero. */
  average: number
  /** Number of records that provided this score kind. */
  count: number
  /** Sum of all score values for this kind. */
  sum: number
}

interface CaseDraft {
  attemptId: string
  caseId: string
  caseName: string
  endedAt?: string
  experimentId: string
  input?: unknown
  metrics: Record<string, CaseMetricValue>
  output?: unknown
  projectName: string
  retryCount: number
  runId: string
  scores: Record<string, number>
  startCount: number
  startedAt?: string
  state?: CaseRecordState
  taskId: string
  workspaceId: string
}

/**
 * Builds normalized case records from lifecycle, metric, and score events.
 *
 * Use when:
 * - `events.jsonl` should be projected into `cases.jsonl`
 * - report commands need one final record per observed case outcome
 *
 * Expects:
 * - events are schema 2 envelopes ordered by `seq`
 * - case events carry `taskId` and `caseId`; payloads that fail their event schema are skipped
 *
 * Returns:
 * - records for cases that emitted an end lifecycle event
 */
export function buildCaseRecords(args: BuildCaseRecordsArgs): CaseRecord[] {
  const drafts = new Map<string, CaseDraft>()
  const completedKeys: string[] = []

  for (const event of args.events) {
    const { caseId, taskId } = event
    if (caseId == null || taskId == null) {
      continue
    }

    if (event.event === caseStarted.id) {
      const data = parseData(caseStartedDataSchema, event)
      if (data != null) {
        applyCaseStart(getOrCreateDraft(drafts, event, args, data.name), event, data)
      }
    }
    else if (event.event === metricRecorded.id) {
      const data = parseData(metricRecordedDataSchema, event)
      if (data != null) {
        getOrCreateDraft(drafts, event, args, caseId).metrics[data.name] = data.value
      }
    }
    else if (event.event === scoreRecorded.id) {
      const data = parseData(scoreRecordedDataSchema, event)
      if (data != null) {
        getOrCreateDraft(drafts, event, args, caseId).scores[data.kind] = data.score
      }
    }
    else if (event.event === caseEnded.id) {
      const data = parseData(caseEndedDataSchema, event)
      if (data != null) {
        applyCaseEnd(getOrCreateDraft(drafts, event, args, data.name), event, data)
        const key = createCaseKey(taskId, caseId)
        if (!completedKeys.includes(key)) {
          completedKeys.push(key)
        }
      }
    }
  }

  return completedKeys
    .map(key => drafts.get(key))
    .filter((draft): draft is CaseDraft => draft != null && draft.endedAt != null)
    .map(toCaseRecord)
}

/**
 * Builds generic score summaries overall and grouped by arbitrary keys.
 *
 * Use when:
 * - report artifacts need benchmark-neutral aggregate score views
 * - callers want to group by metrics such as `benchmark.category` or direct record fields such as `taskId`
 *
 * Expects:
 * - `groupByKeys` are stable metric names or direct `CaseRecord` field names
 * - record score values are normalized numeric scores
 *
 * Returns:
 * - overall score buckets and group buckets keyed by `<key>=<value>`
 */
export function buildMetricsSummary(records: readonly CaseRecord[], groupByKeys: readonly string[]): MetricsSummary {
  const overall: ScoreSummary = {}
  const groups: Record<string, ScoreSummary> = {}

  for (const record of records) {
    addRecordScores(overall, record)

    for (const groupByKey of groupByKeys) {
      const groupValue = getGroupValue(record, groupByKey)
      if (!groupValue.exists) {
        continue
      }

      const groupKey = `${groupByKey}=${String(groupValue.value)}`
      groups[groupKey] ??= {}
      addRecordScores(groups[groupKey], record)
    }
  }

  return {
    groups: finalizeSummaryGroups(groups),
    overall: finalizeScoreSummary(overall),
  }
}

/**
 * Encodes records as newline-delimited JSON.
 *
 * Use when:
 * - writing `cases.jsonl` for command-line tools, dataframes, or streaming parsers
 * - each record should occupy exactly one JSON line
 *
 * Expects:
 * - records are JSON-serializable case records
 *
 * Returns:
 * - one JSON object per line with a trailing newline for non-empty input
 */
export function encodeJsonl(records: readonly CaseRecord[]): string {
  if (records.length === 0) {
    return ''
  }

  return `${records.map(record => JSON.stringify(record)).join('\n')}\n`
}

function addRecordScores(summary: ScoreSummary, record: CaseRecord): void {
  for (const [kind, score] of Object.entries(record.scores)) {
    if (!Number.isFinite(score)) {
      continue
    }

    summary[kind] ??= { average: 0, count: 0, sum: 0 }
    summary[kind].count += 1
    summary[kind].sum += score
  }
}

function applyCaseEnd(draft: CaseDraft, event: RunEventEnvelope, data: CaseEndedData): void {
  draft.caseName = data.name
  draft.endedAt = event.time
  draft.output = data.output ?? draft.output
  draft.state = data.state
  draft.scores.exact ??= draft.state === 'passed' ? 1 : 0
}

function applyCaseStart(draft: CaseDraft, event: RunEventEnvelope, data: CaseStartedData): void {
  draft.startCount += 1
  draft.caseName = data.name
  draft.startedAt ??= event.time
  draft.endedAt = undefined
  draft.metrics = {}
  draft.output = undefined
  draft.scores = {}
  draft.state = undefined
  draft.input = data.input
  draft.retryCount = Math.max(draft.retryCount, data.retryIndex ?? draft.startCount - 1)
}

/**
 * Normalizes duration timestamps.
 *
 * Before:
 * - `startedAt="2026-05-08T00:00:00.000Z"`, `endedAt="2026-05-08T00:00:01.250Z"`
 * - `startedAt="bad"`, `endedAt="2026-05-08T00:00:01.250Z"`
 *
 * After:
 * - `1250`
 * - `0`
 */
function calculateDurationMs(startedAt: string, endedAt: string): number {
  const started = Date.parse(startedAt)
  const ended = Date.parse(endedAt)
  if (!Number.isFinite(started) || !Number.isFinite(ended)) {
    return 0
  }

  return Math.max(0, ended - started)
}

function createCaseKey(taskId: string, caseId: string): string {
  return `${taskId}\u0000${caseId}`
}

function finalizeScoreSummary(summary: ScoreSummary): ScoreSummary {
  return Object.fromEntries(
    Object.entries(summary).map(([kind, bucket]) => [
      kind,
      {
        average: bucket.count === 0 ? 0 : bucket.sum / bucket.count,
        count: bucket.count,
        sum: bucket.sum,
      },
    ]),
  )
}

function finalizeSummaryGroups(groups: Record<string, ScoreSummary>): Record<string, ScoreSummary> {
  return Object.fromEntries(
    Object.entries(groups).map(([key, summary]) => [key, finalizeScoreSummary(summary)]),
  )
}

function getGroupValue(record: CaseRecord, key: string): { exists: false } | { exists: true, value: CaseMetricValue } {
  if (Object.hasOwn(record.metrics, key)) {
    return {
      exists: true,
      value: record.metrics[key]!,
    }
  }

  const directValue = record[key as keyof CaseRecord]
  return isCaseMetricValue(directValue)
    ? {
        exists: true,
        value: directValue,
      }
    : {
        exists: false,
      }
}

function getOrCreateDraft(
  drafts: Map<string, CaseDraft>,
  event: RunEventEnvelope,
  args: BuildCaseRecordsArgs,
  caseName: string,
): CaseDraft {
  const caseId = event.caseId ?? ''
  const taskId = event.taskId ?? ''
  const key = createCaseKey(taskId, caseId)
  const existing = drafts.get(key)
  if (existing != null) {
    return existing
  }

  const draft: CaseDraft = {
    attemptId: event.attemptId,
    caseId,
    caseName,
    experimentId: event.experimentId,
    metrics: {},
    projectName: event.projectId ?? args.projectName,
    retryCount: 0,
    runId: event.runId,
    scores: {},
    startCount: 0,
    taskId,
    workspaceId: event.workspaceId,
  }
  drafts.set(key, draft)
  return draft
}

function isCaseMetricValue(value: unknown): value is CaseMetricValue {
  if (value == null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return true
  }

  return Array.isArray(value)
}

/**
 * Validates the payload of one known event; malformed payloads are skipped instead of failing the whole report.
 */
function parseData<TSchema extends v.GenericSchema>(schema: TSchema, event: RunEventEnvelope): undefined | v.InferOutput<TSchema> {
  const result = v.safeParse(schema, event.data)
  return result.success ? result.output : undefined
}

function toCaseRecord(draft: CaseDraft): CaseRecord {
  const startedAt = draft.startedAt ?? draft.endedAt ?? ''
  const endedAt = draft.endedAt ?? startedAt

  return {
    attemptId: draft.attemptId,
    caseId: draft.caseId,
    caseName: draft.caseName,
    durationMs: calculateDurationMs(startedAt, endedAt),
    endedAt,
    experimentId: draft.experimentId,
    ...(draft.input === undefined ? {} : { input: draft.input }),
    metrics: draft.metrics,
    ...(draft.output === undefined ? {} : { output: draft.output }),
    projectName: draft.projectName,
    retryCount: draft.retryCount,
    runId: draft.runId,
    schemaVersion: 1,
    scores: draft.scores,
    startedAt,
    state: draft.state ?? 'failed',
    taskId: draft.taskId,
    workspaceId: draft.workspaceId,
  }
}
