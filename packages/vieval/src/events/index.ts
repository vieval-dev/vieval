import type { Eventa } from '@moeru/eventa'

import type { RunScoreKind } from '../core/runner/aggregate'
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
 */
export const RUN_EVENT_SCHEMA_VERSION = 2

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
  data: v.unknown(),
  event: v.string(),
  experimentId: v.string(),
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
})

/** Payload of {@link taskStarted}. */
export const taskStartedDataSchema = v.object({})

/** Payload of {@link taskEnded}. */
export const taskEndedDataSchema = v.object({
  state: v.picklist(['failed', 'passed', 'skipped']),
})

/** Payload of {@link caseStarted}. */
export const caseStartedDataSchema = v.object({
  autoRetry: v.optional(v.number()),
  index: v.number(),
  input: v.optional(v.unknown()),
  name: v.string(),
  retryIndex: v.optional(v.number()),
  total: v.number(),
})

/** Payload of {@link caseEnded}. */
export const caseEndedDataSchema = v.object({
  errorMessage: v.optional(v.string()),
  index: v.number(),
  name: v.string(),
  output: v.optional(v.unknown()),
  state: v.picklist(['failed', 'passed', 'skipped', 'timeout']),
  total: v.number(),
})

/** Payload of {@link caseOutput}. */
export const caseOutputDataSchema = v.object({
  content: v.string(),
  stream: v.picklist(['stderr', 'stdout']),
})

/** Payload of {@link metricRecorded}. */
export const metricRecordedDataSchema = v.object({
  name: v.string(),
  value: metricValueSchema,
})

/** Payload of {@link scoreRecorded}. */
export const scoreRecordedDataSchema = v.object({
  kind: v.picklist(['exact', 'judge'] satisfies RunScoreKind[]),
  score: v.number(),
})

/** Payload of {@link artifactRecorded}. */
export const artifactRecordedDataSchema = v.object({
  contentType: v.string(),
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
export type CaseStartedData = v.InferOutput<typeof caseStartedDataSchema>
export type InferenceFailedData = v.InferOutput<typeof inferenceFailedDataSchema>
export type InferenceRequestedData = v.InferOutput<typeof inferenceRequestedDataSchema>
export type InferenceRespondedData = v.InferOutput<typeof inferenceRespondedDataSchema>
export type MetricRecordedData = v.InferOutput<typeof metricRecordedDataSchema>
export type ProjectEndedData = v.InferOutput<typeof projectEndedDataSchema>
export type ProjectStartedData = v.InferOutput<typeof projectStartedDataSchema>
export type RunEndedData = v.InferOutput<typeof runEndedDataSchema>
export type RunStartedData = v.InferOutput<typeof runStartedDataSchema>
export type ScoreRecordedData = v.InferOutput<typeof scoreRecordedDataSchema>
export type TaskEndedData = v.InferOutput<typeof taskEndedDataSchema>
export type TaskQueuedData = v.InferOutput<typeof taskQueuedDataSchema>
export type TaskStartedData = v.InferOutput<typeof taskStartedDataSchema>
export type ToolCallData = v.InferOutput<typeof toolCallDataSchema>

/** The run started; emitted once by the CLI. */
export const runStarted = defineEventa<RunStartedData>('run.started')
/** The run ended; emitted once by the CLI after every project settled. */
export const runEnded = defineEventa<RunEndedData>('run.ended')
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
/** One case attempt started; emitted again for each retry with `retryIndex`. */
export const caseStarted = defineEventa<CaseStartedData>('case.started')
/** One case settled after all retries. */
export const caseEnded = defineEventa<CaseEndedData>('case.ended')
/** One chunk written to `process.stdout` / `process.stderr` while the case ran. */
export const caseOutput = defineEventa<CaseOutputData>('case.output')
/** Case code recorded one metric. */
export const metricRecorded = defineEventa<MetricRecordedData>('metric.recorded')
/** Case code recorded one score. */
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
