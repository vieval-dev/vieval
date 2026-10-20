import type { CaseOutcomeState, ScoreSummary } from '../core/scoring'
import type { CaseEndedData, CaseStartedData, Grader, RunEventEnvelope, ScoreDefinedData } from '../events'

import { readFileSync } from 'node:fs'

import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

import { caseEnded, caseEndedDataSchema, caseStarted, caseStartedDataSchema, metricRecorded, metricRecordedDataSchema, scoreDefined, scoreDefinedDataSchema, scoreRecorded, scoreRecordedDataSchema } from '../events'
import { OLDER_REPORT_MESSAGE } from './report-log'

/** Current version of {@link CaseRecord}; `cases.jsonl` readers reject other versions. */
export const CASE_RECORD_SCHEMA_VERSION = 2

/** Arguments for building normalized case records from report events. */
export interface BuildCaseRecordsArgs {
  /** Run events ordered by `seq`. */
  events: readonly RunEventEnvelope[]
  /** Project name for events without `projectId`, for example from custom project executors. */
  projectName: string
}

/**
 * Outcome of one auto attempt of a case, kept in {@link CaseRecord.attempts}.
 */
export interface CaseAttemptRecord {
  /** Zero-based auto attempt of the task. */
  attemptIndex: number
  /** Non-negative duration of this attempt in milliseconds, from its first start to its end. */
  durationMs: number
  /** Timestamp of the attempt's `case.ended`. */
  endedAt: string
  /** Error message of a failed or timed-out attempt. */
  errorMessage?: string
  /** Retries within this attempt. */
  retryCount: number
  /** Counted score values of this attempt by score name, with the same rule as {@link CaseRecord.scores}. */
  scores: Record<string, number>
  /** Timestamp of the attempt's first `case.started`. */
  startedAt: string
  /** Terminal state of this attempt. */
  state: CaseRecordState
  /** Scores this attempt recorded as unscored, by score name, with the reason. */
  unscored: Record<string, string>
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
 * - for tasks with auto attempts, the top-level fields describe the last attempt and `attempts` lists all of them
 *
 * Returns:
 * - a stable schema-versioned case projection for local report artifacts; optional fields are added
 *   without bumping `schemaVersion`
 */
export interface CaseRecord {
  /** Attempt identity attached to the run (the `--attempt` label, not an auto attempt). */
  attemptId: string
  /**
   * Zero-based auto attempt of the final outcome. Present only when the task ran auto attempts.
   */
  attemptIndex?: number
  /**
   * Outcome of every auto attempt in order. Present only when the task ran auto attempts.
   */
  attempts?: CaseAttemptRecord[]
  /**
   * Additional full task attempts the case allows. Present only when the task ran auto attempts.
   */
  autoAttempt?: number
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
  /** Times the case went back to the queue without a result (`requeue`) before its final outcome. */
  requeueCount?: number
  /** Number of retries (`autoRetry`) within the final case outcome; auto attempts are not counted. */
  retryCount: number
  /** Run identity attached to the run. */
  runId: string
  /** Case record schema version. */
  schemaVersion: typeof CASE_RECORD_SCHEMA_VERSION
  /** What each score record of the final outcome carried (rationale, grader, metadata), by score name. */
  scoreDetails: Record<string, CaseScoreDetail>
  /**
   * Counted score values by score name, with the rule of `scoreCases`, so `cases.jsonl` and `run-summary.json`
   * agree:
   * - `passed`: the recorded value; a score the case did not record, or recorded as unscored, is absent
   * - `failed`: 0 for every score of the task, whatever the case recorded
   * - `errored` and `timeout`: 0 for scores declared `errors: 'zero'`, otherwise absent
   * - `skipped`: no score
   */
  scores: Record<string, number>
  /** ISO-ish case start timestamp, or the best event timestamp available. */
  startedAt: string
  /** Final terminal case state. */
  state: CaseRecordState
  /** Scheduled task id that owns the case. */
  taskId: string
  /** Scores the final outcome recorded as unscored, by score name, with the reason. They never count. */
  unscored: Record<string, string>
  /** Workspace identity attached to the run. */
  workspaceId: string
}

/** Terminal state stored for one normalized case record. */
export type CaseRecordState = CaseOutcomeState

/**
 * What one `score.recorded` of a case carried besides its value.
 */
export interface CaseScoreDetail {
  /** Whether the runtime derived the value from other scores. */
  derived?: boolean
  /** What produced the value, when the record named it. */
  grader?: Grader
  /** Other details of the value. */
  metadata?: Record<string, unknown>
  /** Why the score has its value. */
  rationale?: string
}

/** Content of `metrics-summary.json`: score summaries overall and per requested group facet. */
export interface MetricsSummary {
  /** Score summaries by score name, per group keyed by `<groupKey>=<groupValue>`. */
  groups: Record<string, Record<string, ScoreSummary>>
  /** Score summaries by score name over every record. */
  overall: Record<string, ScoreSummary>
}

/** One auto attempt as recorded, before the task's score names are known. */
interface AttemptDraft extends Omit<CaseAttemptRecord, 'scores'> {
  recorded: Record<string, number>
}

interface CaseDraft {
  attemptId: string
  attemptIndex?: number
  attempts?: AttemptDraft[]
  attemptStartedAt?: string
  autoAttempt?: number
  caseId: string
  caseName: string
  endedAt?: string
  experimentId: string
  input?: unknown
  metrics: Record<string, CaseMetricValue>
  output?: unknown
  projectName: string
  requeueCount: number
  retryCount: number
  runId: string
  scoreDetails: Record<string, CaseScoreDetail>
  /** Values the final outcome recorded (or the runtime derived), before the state rule counts them. */
  scores: Record<string, number>
  startCount: number
  startedAt?: string
  state?: CaseRecordState
  taskId: string
  unscored: Record<string, string>
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
 * - events are schema 3 envelopes ordered by `seq`
 * - case events carry `taskId` and `caseId`, `score.defined` carries `taskId`; payloads that fail their event schema
 *   are skipped
 *
 * Returns:
 * - records for cases that emitted an end lifecycle event, with scores counted by the state rule of `scoreCases`
 *   over the task's scores: its `score.defined` names plus every name a case of the task recorded
 */
export function buildCaseRecords(args: BuildCaseRecordsArgs): CaseRecord[] {
  const drafts = new Map<string, CaseDraft>()
  const completedKeys: string[] = []
  const definitionsByTask = new Map<string, Map<string, ScoreDefinedData>>()

  for (const event of args.events) {
    const { caseId, taskId } = event
    if (taskId != null && event.event === scoreDefined.id) {
      const data = parseData(scoreDefinedDataSchema, event)
      if (data != null) {
        const definitions = definitionsByTask.get(taskId) ?? new Map<string, ScoreDefinedData>()
        definitions.set(data.name, data)
        definitionsByTask.set(taskId, definitions)
      }
      continue
    }
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
        applyScoreRecord(getOrCreateDraft(drafts, event, args, caseId), data)
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

  const completed = completedKeys
    .map(key => drafts.get(key))
    .filter((draft): draft is CaseDraft => draft != null && draft.endedAt != null)

  // A failed case scores 0 on every score of its task, so the task's names are collected before any case is counted.
  const taskScoreNames = new Map<string, Set<string>>()
  for (const draft of completed) {
    const names = taskScoreNames.get(draft.taskId) ?? new Set(definitionsByTask.get(draft.taskId)?.keys())
    for (const outcome of [draft, ...(draft.attempts ?? []).map(attempt => ({ scores: attempt.recorded, unscored: attempt.unscored }))]) {
      Object.keys(outcome.scores).forEach(name => names.add(name))
      Object.keys(outcome.unscored).forEach(name => names.add(name))
    }
    taskScoreNames.set(draft.taskId, names)
  }

  return completed.map(draft => toCaseRecord(draft, {
    definitions: definitionsByTask.get(draft.taskId) ?? new Map(),
    names: taskScoreNames.get(draft.taskId) ?? new Set(),
  }))
}

/**
 * Builds score summaries by score name, overall and grouped by arbitrary keys.
 *
 * Use when:
 * - report artifacts need benchmark-neutral aggregate score views (`metrics-summary.json`)
 * - callers want to group by metrics such as `benchmark.category` or direct record fields such as `taskId`
 *
 * Expects:
 * - `groupByKeys` are stable metric names or direct `CaseRecord` field names
 * - records built by {@link buildCaseRecords}
 *
 * Returns:
 * - overall summaries and group summaries keyed by `<key>=<value>`, each from {@link summarizeRecordScores}
 */
export function buildMetricsSummary(records: readonly CaseRecord[], groupByKeys: readonly string[]): MetricsSummary {
  const groups = new Map<string, CaseRecord[]>()
  for (const record of records) {
    for (const groupByKey of groupByKeys) {
      const groupValue = getGroupValue(record, groupByKey)
      if (!groupValue.exists) {
        continue
      }

      const groupKey = `${groupByKey}=${String(groupValue.value)}`
      groups.set(groupKey, [...(groups.get(groupKey) ?? []), record])
    }
  }

  return {
    groups: Object.fromEntries([...groups].map(([groupKey, groupRecords]) => [groupKey, summarizeRecordScores(groupRecords)])),
    overall: summarizeRecordScores(records),
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

/**
 * Reads the case records of one `cases.jsonl` file.
 *
 * Use when:
 * - a report command or `--resume` reads the cases of a finished run
 *
 * Expects:
 * - one {@link CaseRecord} JSON object per non-empty line
 *
 * Returns:
 * - records in file order
 * - throws {@link OLDER_REPORT_MESSAGE} for a record of an older schema version, and a parse error with the line
 *   number for a line that is not JSON
 */
export function readCaseRecordFile(filePath: string): CaseRecord[] {
  return readFileSync(filePath, 'utf-8').split('\n').flatMap((line, index) => {
    if (line.trim() === '') {
      return []
    }

    let record: CaseRecord
    try {
      record = JSON.parse(line) as CaseRecord
    }
    catch (error) {
      throw new Error(`Invalid cases.jsonl line ${index + 1} in "${filePath}": ${errorMessageFrom(error) ?? 'Unknown JSON parse failure.'}`)
    }
    if (record.schemaVersion !== CASE_RECORD_SCHEMA_VERSION) {
      throw new Error(`${OLDER_REPORT_MESSAGE} ("${filePath}" line ${index + 1}, case record schema version ${String(record.schemaVersion ?? 'none')})`)
    }
    return [record]
  })
}

/**
 * Pools the counted scores of case records into one summary per score name.
 *
 * Use when:
 * - `metrics-summary.json` or `vieval report cases --group-by` summarizes a group of records
 *
 * Expects:
 * - records built by {@link buildCaseRecords}, so `scores` already holds counted values
 *
 * Returns:
 * - per score name, sorted by name: `sum` and `n` over the records that count it, `total` over the records of
 *   tasks that have the score and were not skipped, and the unscored reasons of passed records; the same numbers
 *   `scoreCases` gives for the cases of the records
 */
export function summarizeRecordScores(records: readonly CaseRecord[]): Record<string, ScoreSummary> {
  // A record of a task without the score must not add to its `total`, so names are resolved per task.
  const namesByTask = new Map<string, Set<string>>()
  for (const record of records) {
    const names = namesByTask.get(record.taskId) ?? new Set<string>()
    Object.keys(record.scores).forEach(name => names.add(name))
    Object.keys(record.unscored).forEach(name => names.add(name))
    namesByTask.set(record.taskId, names)
  }

  const summaries = new Map<string, ScoreSummary>()
  for (const record of records) {
    if (record.state === 'skipped') {
      continue
    }
    for (const name of namesByTask.get(record.taskId) ?? []) {
      const summary = summaries.get(name) ?? { mean: null, n: 0, name, sum: 0, total: 0, unscored: {} }
      summaries.set(name, summary)
      summary.total += 1
      const value = record.scores[name]
      if (value != null && Number.isFinite(value)) {
        summary.n += 1
        summary.sum += value
        continue
      }
      const reason = record.state === 'passed' ? record.unscored[name] : undefined
      if (reason != null) {
        summary.unscored[reason] = (summary.unscored[reason] ?? 0) + 1
      }
    }
  }

  return Object.fromEntries([...summaries.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(summary => [summary.name, { ...summary, mean: summary.n === 0 ? null : summary.sum / summary.n }]))
}

function applyCaseEnd(draft: CaseDraft, event: RunEventEnvelope, data: CaseEndedData): void {
  draft.caseName = data.name
  draft.endedAt = event.time
  draft.output = data.output ?? draft.output
  draft.state = data.state
  // The comment here previously described the default `exact` score of a case with a result. It was removed with the
  // `exact` score itself: a case that records no score has no score, and the state rule counts values in
  // `toCaseRecord`, once the task's score names are known.

  if (data.attemptIndex != null) {
    const startedAt = draft.attemptStartedAt ?? event.time
    draft.attempts ??= []
    draft.attempts.push({
      attemptIndex: data.attemptIndex,
      durationMs: calculateDurationMs(startedAt, event.time),
      endedAt: event.time,
      ...(data.errorMessage == null ? {} : { errorMessage: data.errorMessage }),
      recorded: { ...draft.scores },
      retryCount: draft.retryCount,
      startedAt,
      state: data.state,
      unscored: { ...draft.unscored },
    })
  }
}

function applyCaseStart(draft: CaseDraft, event: RunEventEnvelope, data: CaseStartedData): void {
  draft.startCount += 1
  draft.caseName = data.name
  draft.startedAt ??= event.time
  draft.endedAt = undefined
  draft.metrics = {}
  draft.output = undefined
  draft.scoreDetails = {}
  draft.scores = {}
  draft.state = undefined
  draft.unscored = {}
  draft.input = data.input
  draft.requeueCount = Math.max(draft.requeueCount, data.requeueIndex ?? 0)

  if (data.attemptIndex == null) {
    // Without auto attempts, every start after the first is a retry.
    draft.retryCount = Math.max(draft.retryCount, data.retryIndex ?? draft.startCount - 1)
    return
  }

  // A new auto attempt re-runs the case from scratch, so its retries are counted on their own.
  if (draft.attemptIndex !== data.attemptIndex) {
    draft.attemptIndex = data.attemptIndex
    draft.attemptStartedAt = event.time
    draft.retryCount = 0
  }
  draft.autoAttempt = data.autoAttempt
  draft.retryCount = Math.max(draft.retryCount, data.retryIndex ?? 0)
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
function applyScoreRecord(draft: CaseDraft, data: v.InferOutput<typeof scoreRecordedDataSchema>): void {
  // A value and an unscored record of one name replace each other; the last one of the try wins.
  if ('value' in data) {
    draft.scores[data.name] = data.value
    delete draft.unscored[data.name]
  }
  else {
    draft.unscored[data.name] = data.unscored.reason
    delete draft.scores[data.name]
  }

  const detail: CaseScoreDetail = {
    ...(data.derived == null ? {} : { derived: data.derived }),
    ...(data.grader == null ? {} : { grader: data.grader }),
    ...(data.metadata == null ? {} : { metadata: data.metadata }),
    ...(data.rationale == null ? {} : { rationale: data.rationale }),
  }
  if (Object.keys(detail).length === 0) {
    delete draft.scoreDetails[data.name]
    return
  }
  draft.scoreDetails[data.name] = detail
}

function calculateDurationMs(startedAt: string, endedAt: string): number {
  const started = Date.parse(startedAt)
  const ended = Date.parse(endedAt)
  if (!Number.isFinite(started) || !Number.isFinite(ended)) {
    return 0
  }

  return Math.max(0, ended - started)
}

/**
 * Counts the recorded values of one case outcome with the state rule of `scoreCases`.
 *
 * NOTICE:
 * `scoreCases` (`core/scoring/index.ts`) returns summaries, not per-case values, so this repeats its per-case rule.
 * Both must change together; `report-records.test.ts` checks that pooled records equal `scoreCases` summaries.
 */
function countScores(
  outcome: { scores: Record<string, number>, state: CaseRecordState },
  task: { definitions: ReadonlyMap<string, ScoreDefinedData>, names: ReadonlySet<string> },
): Record<string, number> {
  if (outcome.state === 'passed') {
    return { ...outcome.scores }
  }
  if (outcome.state === 'skipped') {
    return {}
  }

  const counted: Record<string, number> = {}
  for (const name of [...task.names].sort()) {
    if (outcome.state === 'failed' || task.definitions.get(name)?.errors === 'zero') {
      counted[name] = 0
    }
  }
  return counted
}

function createCaseKey(taskId: string, caseId: string): string {
  return `${taskId}\u0000${caseId}`
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
    requeueCount: 0,
    retryCount: 0,
    runId: event.runId,
    scoreDetails: {},
    scores: {},
    startCount: 0,
    taskId,
    unscored: {},
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

function toCaseRecord(
  draft: CaseDraft,
  task: { definitions: ReadonlyMap<string, ScoreDefinedData>, names: ReadonlySet<string> },
): CaseRecord {
  const startedAt = draft.startedAt ?? draft.endedAt ?? ''
  const endedAt = draft.endedAt ?? startedAt
  const state = draft.state ?? 'failed'

  return {
    attemptId: draft.attemptId,
    ...(draft.attemptIndex == null ? {} : { attemptIndex: draft.attemptIndex }),
    ...(draft.attempts == null
      ? {}
      : {
          attempts: draft.attempts.map(({ recorded, ...attempt }) => ({
            ...attempt,
            scores: countScores({ scores: recorded, state: attempt.state }, task),
          })),
        }),
    ...(draft.autoAttempt == null ? {} : { autoAttempt: draft.autoAttempt }),
    caseId: draft.caseId,
    caseName: draft.caseName,
    durationMs: calculateDurationMs(startedAt, endedAt),
    endedAt,
    experimentId: draft.experimentId,
    ...(draft.input === undefined ? {} : { input: draft.input }),
    metrics: draft.metrics,
    ...(draft.output === undefined ? {} : { output: draft.output }),
    projectName: draft.projectName,
    ...(draft.requeueCount === 0 ? {} : { requeueCount: draft.requeueCount }),
    retryCount: draft.retryCount,
    runId: draft.runId,
    schemaVersion: CASE_RECORD_SCHEMA_VERSION,
    scoreDetails: draft.scoreDetails,
    scores: countScores({ scores: draft.scores, state }, task),
    startedAt,
    state,
    taskId: draft.taskId,
    unscored: draft.unscored,
    workspaceId: draft.workspaceId,
  }
}
