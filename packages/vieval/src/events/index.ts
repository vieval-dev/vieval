import type { Eventa } from '@moeru/eventa'

import type { TelemetryAttributeValue } from '../core/telemetry/types'

import { defineEventa } from '@moeru/eventa'

import * as v from 'valibot'

/**
 * Re-exported so plugins can define their own run events without depending on `@moeru/eventa` directly.
 *
 * @example
 * const stepFinished = defineEventa<{ step: number }>('plugin.step-finished')
 * await context.events?.emit(stepFinished, { step: 1 })
 */
export { defineEventa } from '@moeru/eventa'

/**
 * Schema version written to every event envelope in `events.jsonl`.
 *
 * Compatibility policy:
 * - adding an optional payload field or a new event name keeps the version, so readers of version 2
 *   keep accepting newer logs (payload schemas ignore unknown keys, and readers skip unknown events)
 * - renaming, removing, or retyping an envelope or payload field bumps the version
 *
 * Version 3 replaced the `exact` / `judge` score kinds with named scores: `score.recorded` carries `name` and
 * `value` (or `unscored`) instead of `kind` and `score`, and `score.defined` declares a score. Readers reject
 * envelopes of older versions.
 */
export const RUN_EVENT_SCHEMA_VERSION = 3

/**
 * One typed run event definition.
 *
 * Use when:
 * - emitting through {@link RunEventEmitter.emit}
 * - a plugin defines its own event with `defineEventa<Data>('<entity>.<past-tense verb>')`
 *
 * @param TData - Event payload stored under the envelope `data` field.
 */
export type RunEventDefinition<TData> = Eventa<TData>

/**
 * Emits run events with the ids of its scope.
 *
 * Use when:
 * - task, case, or plugin code reports activity to every run subscriber (terminal, event log, reporters)
 */
export interface RunEventEmitter {
  /**
   * Emits one event.
   *
   * Resolves once every subscriber settled, and never rejects: subscribers must never affect task scoring.
   * Callers that do not depend on subscriber completion do not await it.
   */
  emit: <TData>(definition: RunEventDefinition<TData>, data: TData) => Promise<void>
  /**
   * Returns an emitter that additionally stamps `scope` ids on every event.
   */
  scope: (scope: RunEventScope) => RunEventEmitter
}

/**
 * Ids stamped on events by a scoped emitter.
 */
export interface RunEventScope {
  /**
   * Stable case id within the task.
   */
  caseId?: string
  /**
   * Project name.
   */
  projectId?: string
  /**
   * Scheduled task id.
   */
  taskId?: string
}

/**
 * Envelope schema for one line of `events.jsonl`.
 *
 * Validates the envelope only; validate `data` with the schema of the event named by `event`.
 */
export const runEventEnvelopeSchema = v.object({
  attemptId: v.string(),
  caseId: v.optional(v.string()),
  /** Comparison the run belongs to, when a comparison started it. */
  comparisonId: v.optional(v.string()),
  data: v.unknown(),
  event: v.string(),
  experimentId: v.string(),
  /** Id shared by every run of one `vieval run` invocation; added in schema version 2 without a bump, so optional. */
  invocationId: v.optional(v.string()),
  projectId: v.optional(v.string()),
  runId: v.string(),
  schemaVersion: v.literal(RUN_EVENT_SCHEMA_VERSION),
  seq: v.number(),
  taskId: v.optional(v.string()),
  time: v.string(),
  workspaceId: v.string(),
})

/**
 * One persisted or delivered run event.
 *
 * `seq` is monotonic per run and orders events from concurrent emitters.
 *
 * @param TData - Event payload type.
 */
export type RunEventEnvelope<TData = unknown> = Omit<v.InferOutput<typeof runEventEnvelopeSchema>, 'data'> & { data: TData }

const metricValueSchema: v.GenericSchema<TelemetryAttributeValue> = v.lazy(() => v.union([
  v.string(),
  v.number(),
  v.boolean(),
  v.null(),
  v.array(metricValueSchema),
]))

const chatProviderSchema = v.object({
  id: v.string(),
  model: v.optional(v.string()),
})

const chatToolCallSchema = v.object({
  args: v.unknown(),
  id: v.optional(v.string()),
  name: v.string(),
})

/** Payload of {@link runStarted}. */
export const runStartedDataSchema = v.object({
  totalTasks: v.number(),
})

/** Payload of {@link runEnded}. */
export const runEndedDataSchema = v.object({
  failedTasks: v.number(),
  passedTasks: v.number(),
  skippedTasks: v.number(),
  totalTasks: v.number(),
})

/** Payload of {@link runInterrupted}. */
export const runInterruptedDataSchema = v.object({
  /** Process signal that interrupted the run, for example `SIGINT`. */
  signal: v.string(),
})

/** Payload of {@link projectStarted}. */
export const projectStartedDataSchema = v.object({
  taskCount: v.number(),
})

/** Payload of {@link projectEnded}. */
export const projectEndedDataSchema = v.object({
  failed: v.boolean(),
})

/** Payload of {@link taskQueued}. */
export const taskQueuedDataSchema = v.object({
  displayName: v.string(),
  /** Cases one run of the task executes, when known before it runs (`TaskDefinition.caseNames`, after `--case`). */
  totalCases: v.optional(v.number()),
})

/** Payload of {@link taskStarted}. */
export const taskStartedDataSchema = v.object({})

/** Payload of {@link taskEnded}. */
export const taskEndedDataSchema = v.object({
  state: v.picklist(['failed', 'passed', 'skipped']),
})

/**
 * Fields that place one case run in a task's auto attempt (a full re-run of every case of the task).
 *
 * Present only when the task runs auto attempts (some case has `autoAttempt > 0`), so events of other
 * tasks are unchanged.
 */
const caseAutoAttemptEntries = {
  /** Zero-based auto attempt of the task this case run belongs to. */
  attemptIndex: v.optional(v.number()),
  /** Additional full task attempts this case allows after the first one. */
  autoAttempt: v.optional(v.number()),
}

/** Payload of {@link caseStarted}. */
export const caseStartedDataSchema = v.object({
  ...caseAutoAttemptEntries,
  autoRetry: v.optional(v.number()),
  index: v.number(),
  input: v.optional(v.unknown()),
  name: v.string(),
  /** Most times this case may go back to the queue (`requeue`); present when the task requeues. */
  requeue: v.optional(v.number()),
  /** Zero-based count of requeues before this run; a run after a requeue continues the same round. */
  requeueIndex: v.optional(v.number()),
  retryIndex: v.optional(v.number()),
  total: v.number(),
})

/**
 * Payload of {@link caseRequeued}: a case ended a run without a result and went back to the queue. It has not
 * ended; a later `case.started` with a higher `requeueIndex` runs it again.
 */
export const caseRequeuedDataSchema = v.object({
  ...caseAutoAttemptEntries,
  /** Least time in ms before the case may start again. */
  delayMs: v.number(),
  errorMessage: v.optional(v.string()),
  errorName: v.optional(v.string()),
  index: v.number(),
  name: v.string(),
  /** Most times this case may go back to the queue. */
  requeue: v.number(),
  /** One-based number of this requeue. */
  requeueIndex: v.number(),
  /** How the run ended: without a result. */
  state: v.picklist(['errored', 'timeout']),
  total: v.number(),
})

/** Payload of {@link caseEnded}. */
export const caseEndedDataSchema = v.object({
  ...caseAutoAttemptEntries,
  errorMessage: v.optional(v.string()),
  /** `name` of the thrown error, for example `AssertionError` or `APICallError`, so readers can group failures. */
  errorName: v.optional(v.string()),
  index: v.number(),
  name: v.string(),
  output: v.optional(v.unknown()),
  /**
   * `failed` is a failed assertion (a wrong result); `errored` and `timeout` produced no result.
   * Adding `errored` and `errorName` kept the schema version: both are additions, so every older report still parses.
   */
  state: v.picklist(['errored', 'failed', 'passed', 'skipped', 'timeout']),
  total: v.number(),
})

/** Payload of {@link caseOutput}. */
export const caseOutputDataSchema = v.object({
  content: v.string(),
  stream: v.picklist(['stderr', 'stdout']),
})

/**
 * Text shown to people: one string, or one string per BCP 47 locale (`{ en: 'Steps', 'zh-Hans': '步数' }`).
 * Viewers pick the locale closest to the reader's language and fall back to `en`, then to the first entry.
 */
export const localizedTextSchema = v.union([v.string(), v.record(v.string(), v.string())])

/** Payload of {@link metricDefined}. */
export const metricDefinedDataSchema = v.object({
  /** Whether a larger value is the better outcome (`higher`), or a smaller one (`lower`). */
  better: v.optional(v.picklist(['higher', 'lower'])),
  /** What the metric measures and how to read it. */
  description: v.optional(localizedTextSchema),
  /** Human-readable name shown instead of `name`. */
  label: v.optional(localizedTextSchema),
  /** Metric name, the same as in `metric.recorded`. */
  name: v.string(),
  /** Unit of numeric values, for example `s`, `tokens`, or `%`. */
  unit: v.optional(v.string()),
})

/** Payload of {@link metricRecorded}. */
export const metricRecordedDataSchema = v.object({
  name: v.string(),
  value: metricValueSchema,
})

/** What produced a score value. */
export const graderSchema = v.object({
  /** Stable name, for example `listener`, `judge`, or `grader.chem`; matches the `role` of the grader's inference events. */
  id: v.optional(v.string()),
  /**
   * `rule`: deterministic code. `model`: an LLM or another model. `human`: a reviewer. `external`: the verifier of
   * another harness, for example a Harbor `tests/test.sh`.
   */
  kind: v.picklist(['external', 'human', 'model', 'rule']),
  /** Model id when `kind` is `model`. */
  model: v.optional(v.string()),
  /** How several votes were reduced to the value, for example `majority` or `median`. */
  reducer: v.optional(v.string()),
  /** Version of the grader: a prompt hash, a rule set version, or a package version. */
  version: v.optional(v.string()),
  /** Number of votes when the value reduces several answers. */
  votes: v.optional(v.number()),
})

/** How a derived score combines other scores of the same case try. */
export const scoreCombinationSchema = v.object({
  inputs: v.array(v.object({
    /** `all` only: the least value at which this input passes. */
    atLeast: v.optional(v.number()),
    name: v.string(),
    /** `weighted` only: the weight of this input; weights are normalized. */
    weight: v.optional(v.number()),
  })),
  /** `all`: 1 when every input reaches its `atLeast` (default 1), else 0. `mean`: the mean. `weighted`: the weighted mean. */
  kind: v.picklist(['all', 'mean', 'weighted']),
})

/** Payload of {@link scoreDefined}. */
export const scoreDefinedDataSchema = v.object({
  /** Present when the runtime derives this score from other scores; a case cannot record it. */
  combine: v.optional(scoreCombinationSchema),
  /** What the score measures and how to read it. */
  description: v.optional(localizedTextSchema),
  /** How an errored or timed-out case counts: left out (`exclude`, the default) or as 0 (`zero`). */
  errors: v.optional(v.picklist(['exclude', 'zero'])),
  /** What usually produces the value; a record can override it. */
  grader: v.optional(graderSchema),
  /** Human-readable name shown instead of `name`. */
  label: v.optional(localizedTextSchema),
  /** Score name, the same as in `score.recorded`. */
  name: v.string(),
  /** Whether this is the headline score of its task. At most one score of a task is primary. */
  primary: v.optional(v.boolean()),
})

const scoreRecordedEntries = {
  /** Whether the runtime derived the value from other scores (`score.defined` `combine`). */
  derived: v.optional(v.boolean()),
  /** What produced this value; overrides the definition's `grader`. */
  grader: v.optional(graderSchema),
  /** Other details of the value. */
  metadata: v.optional(v.record(v.string(), v.unknown())),
  name: v.string(),
  /** Why the score has this value: a judge's reasoning, or the rule that matched. */
  rationale: v.optional(v.string()),
}

/**
 * Payload of {@link scoreRecorded}: a value in `0..1`, or `unscored` when the grader could not produce one.
 */
export const scoreRecordedDataSchema = v.union([
  v.object({ ...scoreRecordedEntries, value: v.number() }),
  v.object({
    ...scoreRecordedEntries,
    /** The grader produced no value, for a reason such as `grader_failed`, `invalid_response`, `no_response`, or `refusal`. */
    unscored: v.object({ reason: v.string() }),
  }),
])

/** Payload of {@link artifactRecorded}. */
export const artifactRecordedDataSchema = v.object({
  contentType: v.string(),
  /** What the file shows, for people browsing the case. */
  description: v.optional(localizedTextSchema),
  /** Human-readable name shown instead of `name`. */
  label: v.optional(localizedTextSchema),
  name: v.string(),
  /** Path relative to the run's artifacts root (`<reportDirectory>/artifacts`), with `/` separators. */
  path: v.string(),
  purpose: v.optional(v.string()),
  size: v.number(),
})

/** Payload of {@link inferenceRequested}. */
export const inferenceRequestedDataSchema = v.object({
  data: v.optional(v.unknown()),
  modality: v.literal('chat'),
  provider: v.optional(chatProviderSchema),
})

/** Payload of {@link inferenceResponded}. */
export const inferenceRespondedDataSchema = v.object({
  metering: v.object({
    dimensions: v.record(v.string(), v.number()),
    latency_ms: v.optional(v.number()),
  }),
  metrics: v.record(v.string(), v.number()),
  modality: v.literal('chat'),
  provider: v.optional(chatProviderSchema),
  toolCalls: v.array(chatToolCallSchema),
})

/** Payload of {@link inferenceFailed}. */
export const inferenceFailedDataSchema = v.object({
  error: v.string(),
  modality: v.literal('chat'),
  provider: v.optional(chatProviderSchema),
})

/** Payload of {@link toolCallStarted} and {@link toolCallEnded}. */
export const toolCallDataSchema = v.object({
  modality: v.literal('chat'),
  provider: v.optional(chatProviderSchema),
  toolCall: chatToolCallSchema,
})

export type ArtifactRecordedData = v.InferOutput<typeof artifactRecordedDataSchema>
export type CaseEndedData = v.InferOutput<typeof caseEndedDataSchema>
export type CaseOutputData = v.InferOutput<typeof caseOutputDataSchema>
export type CaseRequeuedData = v.InferOutput<typeof caseRequeuedDataSchema>
export type CaseStartedData = v.InferOutput<typeof caseStartedDataSchema>
export type Grader = v.InferOutput<typeof graderSchema>
export type InferenceFailedData = v.InferOutput<typeof inferenceFailedDataSchema>
export type InferenceRequestedData = v.InferOutput<typeof inferenceRequestedDataSchema>
export type InferenceRespondedData = v.InferOutput<typeof inferenceRespondedDataSchema>
export type LocalizedText = v.InferOutput<typeof localizedTextSchema>
export type MetricDefinedData = v.InferOutput<typeof metricDefinedDataSchema>
export type MetricRecordedData = v.InferOutput<typeof metricRecordedDataSchema>
export type ProjectEndedData = v.InferOutput<typeof projectEndedDataSchema>
export type ProjectStartedData = v.InferOutput<typeof projectStartedDataSchema>
export type RunEndedData = v.InferOutput<typeof runEndedDataSchema>
export type RunInterruptedData = v.InferOutput<typeof runInterruptedDataSchema>
export type RunStartedData = v.InferOutput<typeof runStartedDataSchema>
export type ScoreCombinationData = v.InferOutput<typeof scoreCombinationSchema>
export type ScoreDefinedData = v.InferOutput<typeof scoreDefinedDataSchema>
export type ScoreRecordedData = v.InferOutput<typeof scoreRecordedDataSchema>
export type TaskEndedData = v.InferOutput<typeof taskEndedDataSchema>
export type TaskQueuedData = v.InferOutput<typeof taskQueuedDataSchema>
export type TaskStartedData = v.InferOutput<typeof taskStartedDataSchema>
export type ToolCallData = v.InferOutput<typeof toolCallDataSchema>

/** The run started; emitted once by the CLI. */
export const runStarted = defineEventa<RunStartedData>('run.started')
/** The run ended; emitted once by the CLI after every project settled. */
export const runEnded = defineEventa<RunEndedData>('run.ended')
/** The run received an interrupt signal; running cases are aborted and new work is not started. */
export const runInterrupted = defineEventa<RunInterruptedData>('run.interrupted')
/** One project started executing its tasks. */
export const projectStarted = defineEventa<ProjectStartedData>('project.started')
/** One project settled. */
export const projectEnded = defineEventa<ProjectEndedData>('project.ended')
/** One scheduled task is known before execution; emitted for every task when the run starts. */
export const taskQueued = defineEventa<TaskQueuedData>('task.queued')
/** One task started executing. */
export const taskStarted = defineEventa<TaskStartedData>('task.started')
/** One task settled, or was skipped after a project failure. */
export const taskEnded = defineEventa<TaskEndedData>('task.ended')
/**
 * One case run started; emitted again for each retry with `retryIndex`, and for each auto attempt of the
 * task with `attemptIndex`.
 */
export const caseStarted = defineEventa<CaseStartedData>('case.started')
/** One case settled after all retries; emitted once per auto attempt with `attemptIndex`. */
export const caseEnded = defineEventa<CaseEndedData>('case.ended')
/** A case without a result went back to the queue; it has not ended. */
export const caseRequeued = defineEventa<CaseRequeuedData>('case.requeued')
/** One chunk written to `process.stdout` / `process.stderr` while the case ran. */
export const caseOutput = defineEventa<CaseOutputData>('case.output')
/**
 * Labels, description, unit, and direction of one metric; emitted by its task before the first value that carries
 * them, and again when they change. Viewers keep the latest per metric name.
 */
export const metricDefined = defineEventa<MetricDefinedData>('metric.defined')
/** Case code recorded one metric. */
export const metricRecorded = defineEventa<MetricRecordedData>('metric.recorded')
/**
 * Label, description, combination, and grader of one score; emitted by its task before the first value of the score,
 * and again when they change. Viewers keep the latest per score name.
 */
export const scoreDefined = defineEventa<ScoreDefinedData>('score.defined')
/** Case code recorded one score value or an unscored value, or the runtime derived one when the case try settled. */
export const scoreRecorded = defineEventa<ScoreRecordedData>('score.recorded')
/** Case code recorded one artifact file. */
export const artifactRecorded = defineEventa<ArtifactRecordedData>('artifact.recorded')
/** A chat model request was sent. */
export const inferenceRequested = defineEventa<InferenceRequestedData>('inference.requested')
/** A chat model response arrived. */
export const inferenceResponded = defineEventa<InferenceRespondedData>('inference.responded')
/** A chat model request failed. */
export const inferenceFailed = defineEventa<InferenceFailedData>('inference.failed')
/** A chat model response contained one tool call. */
export const toolCallStarted = defineEventa<ToolCallData>('tool-call.started')
/** A tool call from a chat model response ended. */
export const toolCallEnded = defineEventa<ToolCallData>('tool-call.ended')
