/** Arguments for building normalized case records from report events. */
export interface BuildCaseRecordsArgs {
  /** Default attempt id for events that do not carry one. */
  attemptId: string
  /** Source report events ordered by occurrence. */
  events: readonly CaseRecordSourceEvent[]
  /** Default experiment id for events that do not carry one. */
  experimentId: string
  /** Default project name for events that do not carry one. */
  projectName: string
  /** Default run id for events that do not carry one. */
  runId: string
  /** Default workspace id for events that do not carry one. */
  workspaceId: string
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

/** Event envelope accepted by the local report record processor. */
export interface CaseRecordSourceEvent {
  /** Optional attempt id override from persisted events. */
  attemptId?: string
  /** Optional case id from current CLI event envelopes. */
  caseId?: string
  /** Optional event payload from reporter hooks or lifecycle capture. */
  data?: unknown
  /** Event name, including `task.case.*` and current CLI lifecycle names. */
  event: string
  /** Optional experiment id override from persisted events. */
  experimentId?: string
  /** Optional project id/name from current CLI event envelopes. */
  projectId?: string
  /** Optional project name from metadata-rich reporter events. */
  projectName?: string
  /** Optional run id override from persisted events. */
  runId?: string
  /** Optional task id from current CLI event envelopes. */
  taskId?: string
  /** Optional event timestamp from current CLI event envelopes. */
  timestamp?: string
  /** Optional workspace id override from persisted events. */
  workspaceId?: string
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
 * - events are ordered by occurrence where possible
 * - lifecycle events use either `task.case.start`/`task.case.end` or current CLI `CaseStarted`/`CaseEnded` names
 *
 * Returns:
 * - records for cases that emitted an end lifecycle event
 */
export function buildCaseRecords(args: BuildCaseRecordsArgs): CaseRecord[] {
  const drafts = new Map<string, CaseDraft>()
  const completedKeys: string[] = []

  for (const event of args.events) {
    const normalizedEvent = normalizeCaseEventName(event.event)
    if (normalizedEvent == null) {
      continue
    }

    const ids = extractEventIds(event, args)
    if (ids.caseId.length === 0 || ids.taskId.length === 0) {
      continue
    }

    const draft = getOrCreateDraft(drafts, ids, event, args)
    applyIdentity(draft, ids, event, args)

    if (normalizedEvent === 'start') {
      applyCaseStart(draft, event)
    }
    else if (normalizedEvent === 'metric') {
      applyCaseMetric(draft, event)
    }
    else if (normalizedEvent === 'score') {
      applyCaseScore(draft, event)
    }
    else {
      applyCaseEnd(draft, event)
      const key = createCaseKey(ids.taskId, ids.caseId)
      if (!completedKeys.includes(key)) {
        completedKeys.push(key)
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

function applyCaseEnd(draft: CaseDraft, event: CaseRecordSourceEvent): void {
  const data = asRecord(event.data)
  draft.caseName = extractCaseName(event) ?? draft.caseName
  draft.endedAt = stringFrom(data?.endedAt) ?? event.timestamp ?? draft.endedAt
  draft.output = data != null && 'output' in data ? data.output : draft.output
  draft.state = normalizeState(stringFrom(data?.state)) ?? 'failed'
  draft.scores.exact ??= draft.state === 'passed' ? 1 : 0
}

function applyCaseMetric(draft: CaseDraft, event: CaseRecordSourceEvent): void {
  const data = asRecord(event.data)
  const name = stringFrom(data?.name)
  if (name == null) {
    return
  }

  const value = data?.value
  if (isCaseMetricValue(value)) {
    draft.metrics[name] = value
  }
}

function applyCaseScore(draft: CaseDraft, event: CaseRecordSourceEvent): void {
  const data = asRecord(event.data)
  const kind = stringFrom(data?.kind) ?? stringFrom(data?.name) ?? stringFrom(data?.['vieval.score.kind'])
  const score = numberFrom(data?.score) ?? numberFrom(data?.value) ?? numberFrom(data?.['vieval.score.value'])
  if (kind == null || score == null) {
    return
  }

  draft.scores[kind] = score
}

function applyCaseStart(draft: CaseDraft, event: CaseRecordSourceEvent): void {
  const data = asRecord(event.data)
  draft.startCount += 1
  draft.caseName = extractCaseName(event) ?? draft.caseName
  draft.startedAt ??= stringFrom(data?.startedAt) ?? event.timestamp
  draft.endedAt = undefined
  draft.input = undefined
  draft.metrics = {}
  draft.output = undefined
  draft.scores = {}
  draft.state = undefined
  draft.input = data != null && 'input' in data ? data.input : draft.input

  const retryIndex = numberFrom(data?.retryIndex)
  if (retryIndex != null) {
    draft.retryCount = Math.max(draft.retryCount, retryIndex)
    return
  }

  draft.retryCount = Math.max(draft.retryCount, draft.startCount - 1)
}

function applyIdentity(
  draft: CaseDraft,
  ids: ReturnType<typeof extractEventIds>,
  event: CaseRecordSourceEvent,
  args: BuildCaseRecordsArgs,
): void {
  draft.attemptId = ids.attemptId || args.attemptId
  draft.experimentId = ids.experimentId || args.experimentId
  draft.projectName = extractExplicitProjectName(event) ?? draft.projectName
  draft.runId = ids.runId || args.runId
  draft.workspaceId = ids.workspaceId || args.workspaceId
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
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

function extractCaseName(event: CaseRecordSourceEvent): string | undefined {
  const data = asRecord(event.data)
  return stringFrom(data?.caseName) ?? stringFrom(data?.name)
}

function extractEventIds(event: CaseRecordSourceEvent, args: BuildCaseRecordsArgs): {
  attemptId: string
  caseId: string
  experimentId: string
  projectName: string
  runId: string
  taskId: string
  workspaceId: string
} {
  const data = asRecord(event.data)

  return {
    attemptId: stringFrom(data?.attemptId) ?? event.attemptId ?? args.attemptId,
    caseId: stringFrom(data?.caseId) ?? event.caseId ?? '',
    experimentId: stringFrom(data?.experimentId) ?? event.experimentId ?? args.experimentId,
    projectName: stringFrom(data?.projectName) ?? event.projectName ?? event.projectId ?? args.projectName,
    runId: stringFrom(data?.runId) ?? event.runId ?? args.runId,
    taskId: stringFrom(data?.taskId) ?? event.taskId ?? '',
    workspaceId: stringFrom(data?.workspaceId) ?? event.workspaceId ?? args.workspaceId,
  }
}

function extractExplicitProjectName(event: CaseRecordSourceEvent): string | undefined {
  const data = asRecord(event.data)
  return stringFrom(data?.projectName) ?? event.projectName ?? event.projectId
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
  ids: ReturnType<typeof extractEventIds>,
  event: CaseRecordSourceEvent,
  args: BuildCaseRecordsArgs,
): CaseDraft {
  const key = createCaseKey(ids.taskId, ids.caseId)
  const existing = drafts.get(key)
  if (existing != null) {
    return existing
  }

  const draft: CaseDraft = {
    attemptId: ids.attemptId,
    caseId: ids.caseId,
    caseName: extractCaseName(event) ?? ids.caseId,
    experimentId: ids.experimentId,
    metrics: {},
    projectName: ids.projectName || args.projectName,
    retryCount: 0,
    runId: ids.runId,
    scores: {},
    startCount: 0,
    taskId: ids.taskId,
    workspaceId: ids.workspaceId,
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

function normalizeCaseEventName(eventName: string): 'end' | 'metric' | 'score' | 'start' | undefined {
  if (eventName === 'task.case.start' || eventName === 'CaseStarted') {
    return 'start'
  }

  if (eventName === 'task.case.metric') {
    return 'metric'
  }

  if (eventName === 'task.case.score') {
    return 'score'
  }

  if (eventName === 'task.case.end' || eventName === 'CaseEnded') {
    return 'end'
  }

  return undefined
}

function normalizeState(value: string | undefined): CaseRecordState | undefined {
  if (value === 'failed' || value === 'passed' || value === 'skipped' || value === 'timeout') {
    return value
  }

  return undefined
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
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
