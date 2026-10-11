import type { TaskRunContext } from '../../config/types'

import { errorMessageFrom } from '@moeru/std'

import { inferenceFailed, inferenceRequested, inferenceResponded, toolCallEnded, toolCallStarted } from '../../events'

/**
 * Provider identity attached to chat-model telemetry events.
 */
export interface ChatModelTelemetryProvider {
  /**
   * Provider id, for example `openai`.
   */
  id: string
  /**
   * Optional concrete model id/name.
   */
  model?: string
}

/**
 * Represents one normalized chat-model tool call.
 *
 * Use when:
 * - report events need tool-call level payloads that remain provider-neutral
 *
 * Expects:
 * - `name` to be stable enough for aggregation and assertion checks
 * - `args` to be JSON-serializable
 */
export interface ChatModelToolCall {
  /**
   * Parsed tool arguments object/value.
   */
  args: unknown
  /**
   * Optional provider-assigned tool-call identifier.
   */
  id?: string
  /**
   * Tool name.
   */
  name: string
}

/**
 * Input options for error telemetry emission.
 */
export interface EmitChatModelErrorTelemetryOptions {
  /**
   * Error payload emitted by the inference client/runtime.
   */
  error: unknown
  /**
   * Optional provider identity payload.
   */
  provider?: ChatModelTelemetryProvider
}

/**
 * Input options for request telemetry emission.
 */
export interface EmitChatModelRequestTelemetryOptions {
  /**
   * Optional request payload metadata.
   */
  data?: unknown
  /**
   * Optional provider identity payload.
   */
  provider?: ChatModelTelemetryProvider
}

/**
 * Input options for response telemetry emission.
 */
export interface EmitChatModelResponseTelemetryOptions {
  /**
   * Optional response latency in milliseconds.
   */
  latencyMs?: number
  /**
   * Optional provider identity payload.
   */
  provider?: ChatModelTelemetryProvider
  /**
   * Raw chat-model response object from the inference library/provider.
   */
  response: unknown
}

/**
 * Emits chat-model failure telemetry as a reportable task event.
 *
 * Use when:
 * - one inference call fails and report artifacts should include normalized error context
 *
 * Expects:
 * - `context.events` to be available in CLI execution paths; pass the case context to stamp the case id
 */
export function emitChatModelErrorTelemetry(
  context: TaskRunContext,
  options: EmitChatModelErrorTelemetryOptions,
): void {
  void context.events?.emit(inferenceFailed, {
    error: errorMessageFrom(options.error) ?? 'Unknown inference error.',
    modality: 'chat',
    provider: options.provider,
  })
}

/**
 * Emits chat-model request telemetry as a reportable task event.
 *
 * Use when:
 * - task code submits one model request and wants request-side traceability
 *
 * Expects:
 * - `context.events` to be available in CLI execution paths; pass the case context to stamp the case id
 */
export function emitChatModelRequestTelemetry(
  context: TaskRunContext,
  options: EmitChatModelRequestTelemetryOptions,
): void {
  void context.events?.emit(inferenceRequested, {
    data: options.data,
    modality: 'chat',
    provider: options.provider,
  })
}

/**
 * Emits chat-model response telemetry as reportable task events.
 *
 * Use when:
 * - task code receives one chat-model response and wants standardized report events
 * - `tool-call.*` events and metering metrics should be persisted in `events.jsonl`
 *
 * Expects:
 * - `context.events` to be available in CLI execution paths; pass the case context to stamp the case id
 *
 * Returns:
 * - no return value; this is a best-effort reporting helper
 */
export function emitChatModelResponseTelemetry(
  context: TaskRunContext,
  options: EmitChatModelResponseTelemetryOptions,
): void {
  const toolCalls = extractChatModelToolCalls(options.response)
  const meteringDimensions = extractMeteringDimensions(options.response)

  if (toolCalls.length > 0) {
    meteringDimensions.tool_call_count = toolCalls.length
  }

  void context.events?.emit(inferenceResponded, {
    metering: {
      dimensions: meteringDimensions,
      latency_ms: options.latencyMs,
    },
    metrics: {
      'vieval.chat.tool_call_count': toolCalls.length,
    },
    modality: 'chat',
    provider: options.provider,
    toolCalls,
  })

  for (const toolCall of toolCalls) {
    void context.events?.emit(toolCallStarted, { modality: 'chat', provider: options.provider, toolCall })
    void context.events?.emit(toolCallEnded, { modality: 'chat', provider: options.provider, toolCall })
  }
}

/**
 * Extracts normalized tool calls from one chat-model response shape.
 *
 * Use when:
 * - downstream scoring, reporting, or analysis should inspect tool call usage
 * - provider payload differences should stay hidden behind one stable shape
 *
 * Returns:
 * - normalized list of `{ id?, name, args }` tool calls
 */
export function extractChatModelToolCalls(response: unknown): ChatModelToolCall[] {
  const responseRecord = asRecord(response)
  if (responseRecord == null) {
    return []
  }

  const rawToolCalls = responseRecord.toolCalls ?? responseRecord.tool_calls
  if (!Array.isArray(rawToolCalls)) {
    return []
  }

  const toolCalls: ChatModelToolCall[] = []

  for (const rawToolCall of rawToolCalls) {
    const toolCallRecord = asRecord(rawToolCall)
    if (toolCallRecord == null) {
      continue
    }

    const functionPayload = asRecord(toolCallRecord.function)
    const name = typeof toolCallRecord.name === 'string'
      ? toolCallRecord.name
      : typeof functionPayload?.name === 'string'
        ? functionPayload.name
        : undefined

    if (name == null || name.length === 0) {
      continue
    }

    const rawArgs = toolCallRecord.args
      ?? toolCallRecord.arguments
      ?? functionPayload?.args
      ?? functionPayload?.arguments

    toolCalls.push({
      args: parseMaybeJson(rawArgs),
      id: typeof toolCallRecord.id === 'string' ? toolCallRecord.id : undefined,
      name,
    })
  }

  return toolCalls
}

/**
 * Extracts numeric metering dimensions from one chat-model response usage block.
 *
 * Use when:
 * - report events should capture usage dimensions in a modality-neutral map
 *
 * Returns:
 * - numeric dimensions keyed by provider usage field names
 */
export function extractMeteringDimensions(response: unknown): Record<string, number> {
  const responseRecord = asRecord(response)
  const usage = asRecord(responseRecord?.usage)
  if (usage == null) {
    return {}
  }

  const dimensions: Record<string, number> = {}

  for (const [key, value] of Object.entries(usage)) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      continue
    }

    dimensions[key] = value
  }

  return dimensions
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value == null || typeof value !== 'object') {
    return undefined
  }

  return value as Record<string, unknown>
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  try {
    return JSON.parse(value)
  }
  catch {
    return value
  }
}
