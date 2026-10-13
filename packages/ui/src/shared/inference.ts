import type { InferenceFailedData, InferenceRequestedData, InferenceRespondedData, ToolCallData } from 'vieval/events'

import type { MetricsResponse } from './contract'
import type { ReducedInferenceEvent } from './reduce'

/**
 * One model call of a case: its `inference.requested` event paired with the `inference.responded` or
 * `inference.failed` event that settled it, plus the `tool-call.*` events of the response.
 */
export interface InferenceCall {
  /** Error message of `inference.failed`. */
  error?: string
  /** Every event of the call in seq order, for the raw view. */
  events: ReducedInferenceEvent[]
  /** Wall time the provider took, from the response metering. */
  latencyMs?: number
  /** Provider and model of the call. */
  provider?: InferenceRequestedData['provider']
  /** Free-form request data the eval attached (OSWorld: `{ api, step }`). */
  request?: unknown
  /** Time of `inference.requested`; absent when the request event is missing (truncated log). */
  requestedAt?: string
  roundIndex?: number
  /** Seq of the first event of the call; stable key. */
  seq: number
  /** Time of the settling event. */
  settledAt?: string
  state: 'failed' | 'pending' | 'responded'
  /** Tool calls the model asked for in its response. */
  toolCalls: ToolCallData['toolCall'][]
  /** Provider usage fields as they arrived (`input_tokens`, `output_tokens_details.reasoning_tokens`, …). */
  usage: Record<string, number>
}

/** Inference totals of one case or a whole run, as the metrics endpoint returns them. */
export type InferenceTotals = MetricsResponse['inference']

/**
 * Usage of one model (one provider id and model name) across the calls of a case.
 */
export interface ModelUsage {
  calls: number
  failed: number
  /** `provider.id` and `provider.model`; calls without a provider share one group. */
  key: string
  /** Model name for people; prefixed with the provider id when another provider serves a model of the same name. */
  label: string
  /** Summed provider latency of the responded calls. */
  latencyMs: number
  provider?: InferenceCall['provider']
  responses: number
  toolCalls: number
  /** Usage fields summed over the calls of this model only; fields of different models are never added up. */
  usage: Record<string, number>
}

/**
 * Token counts read from provider usage fields, whichever naming the provider uses.
 */
export interface TokenUsage {
  /** Input tokens served from the provider prompt cache (part of `input`). */
  cached?: number
  input?: number
  output?: number
  /** Output tokens spent on hidden reasoning (part of `output`). */
  reasoning?: number
  total?: number
}

/**
 * Groups the inference and tool-call events of one case into model calls.
 *
 * Use when:
 * - a case page lists what the model was asked and what it answered, one row per call
 *
 * Expects:
 * - events of one case in seq order (`ReducedCase.inference`); calls of one case run one after another, so a
 *   response settles the latest pending request
 *
 * Returns:
 * - calls in request order; a response without a request (log cut at the start) becomes its own call, and a
 *   request without a response stays `pending`
 */
export function groupInferenceCalls(events: readonly ReducedInferenceEvent[]): InferenceCall[] {
  const calls: InferenceCall[] = []
  for (const event of events) {
    if (event.event === 'inference.requested') {
      const data = event.data as Partial<InferenceRequestedData>
      calls.push({ events: [event], provider: data.provider, request: data.data, requestedAt: event.time, roundIndex: event.roundIndex, seq: event.seq, state: 'pending', toolCalls: [], usage: {} })
      continue
    }
    if (event.event === 'inference.responded' || event.event === 'inference.failed') {
      let call = calls.at(-1)
      if (call?.state !== 'pending') {
        call = { events: [], roundIndex: event.roundIndex, seq: event.seq, state: 'pending', toolCalls: [], usage: {} }
        calls.push(call)
      }
      call.events.push(event)
      call.settledAt = event.time
      if (event.event === 'inference.failed') {
        const data = event.data as Partial<InferenceFailedData>
        call.state = 'failed'
        call.error = data.error
        call.provider ??= data.provider
        continue
      }
      const data = event.data as Partial<InferenceRespondedData>
      call.state = 'responded'
      call.latencyMs = data.metering?.latency_ms
      call.provider ??= data.provider
      call.toolCalls = data.toolCalls ?? []
      call.usage = { ...data.metering?.dimensions }
      continue
    }
    // `tool-call.*` follow the response that asked for them; their payload repeats `toolCalls` of that response.
    calls.at(-1)?.events.push(event)
  }
  return calls
}

/**
 * Key of the model of a call, the same as {@link ModelUsage.key}.
 */
export function modelKeyOf(provider: InferenceCall['provider']): string {
  return `${provider?.id ?? ''}/${provider?.model ?? ''}`
}

/**
 * Counts requests and sums usage over inference events of any number of cases.
 *
 * Use when:
 * - the metrics endpoint reports inference totals of a run, task, or case
 *
 * Returns:
 * - request, response, and failure counts; `totals` sums every numeric usage field and response metric, plus
 *   `latency_ms`
 */
export function sumInference(events: Iterable<ReducedInferenceEvent>): InferenceTotals {
  const inference: InferenceTotals = { failed: 0, requests: 0, responses: 0, totals: {} }
  for (const entry of events) {
    if (entry.event === 'inference.requested') {
      inference.requests += 1
    }
    else if (entry.event === 'inference.failed') {
      inference.failed += 1
    }
    else if (entry.event === 'inference.responded') {
      inference.responses += 1
      const data = entry.data as Partial<InferenceRespondedData>
      for (const [name, value] of Object.entries({ ...data.metrics, ...data.metering?.dimensions })) {
        if (typeof value === 'number') {
          inference.totals[name] = (inference.totals[name] ?? 0) + value
        }
      }
      if (typeof data.metering?.latency_ms === 'number') {
        inference.totals.latency_ms = (inference.totals.latency_ms ?? 0) + data.metering.latency_ms
      }
    }
  }
  return inference
}

/**
 * Sums the calls of a case per model.
 *
 * Use when:
 * - a case used more than one model (agent plus judge, planner plus grounding) and its token counts must not be
 *   added across tokenizers and prices
 *
 * Expects:
 * - calls from {@link groupInferenceCalls}
 *
 * Returns:
 * - one entry per provider id and model, in the order the models were first called
 */
export function summarizeByModel(calls: readonly InferenceCall[]): ModelUsage[] {
  const models = new Map<string, ModelUsage>()
  for (const call of calls) {
    const key = modelKeyOf(call.provider)
    let model = models.get(key)
    if (model == null) {
      model = { calls: 0, failed: 0, key, label: call.provider?.model ?? call.provider?.id ?? 'unknown model', latencyMs: 0, provider: call.provider, responses: 0, toolCalls: 0, usage: {} }
      models.set(key, model)
    }
    model.calls += 1
    model.toolCalls += call.toolCalls.length
    if (call.state === 'failed')
      model.failed += 1
    if (call.state === 'responded')
      model.responses += 1
    model.latencyMs += call.latencyMs ?? 0
    for (const [name, value] of Object.entries(call.usage))
      model.usage[name] = (model.usage[name] ?? 0) + value
  }
  const list = [...models.values()]
  // The same model name served by two providers (openai and azure): the bare name would not tell them apart.
  const shared = new Set(list.map(model => model.label).filter((label, index, labels) => labels.indexOf(label) !== index))
  for (const model of list) {
    if (model.provider?.model != null && shared.has(model.label))
      model.label = `${model.provider.id}/${model.provider.model}`
  }
  return list
}

/**
 * Normalizes provider usage fields into token counts.
 *
 * Usage fields keep the provider's names: the OpenAI Responses API reports `input_tokens`, Chat Completions
 * `prompt_tokens`. The first name present wins. Anthropic `cache_read_input_tokens` is left out of `cached`: it is
 * not part of Anthropic `input_tokens`, so it would break the "part of input" meaning.
 *
 * Before:
 * - `{ "prompt_tokens": 120, "completion_tokens": 30, "prompt_tokens_details.cached_tokens": 100 }`
 *
 * After:
 * - `{ input: 120, output: 30, cached: 100, total: 150 }`
 */
export function tokenUsage(usage: Readonly<Record<string, number>>): TokenUsage {
  const pick = (...names: string[]): number | undefined => names.map(name => usage[name]).find(value => value != null)
  const input = pick('input_tokens', 'prompt_tokens')
  const output = pick('output_tokens', 'completion_tokens')
  return {
    cached: pick('input_tokens_details.cached_tokens', 'prompt_tokens_details.cached_tokens'),
    input,
    output,
    reasoning: pick('output_tokens_details.reasoning_tokens', 'completion_tokens_details.reasoning_tokens'),
    total: pick('total_tokens') ?? (input == null && output == null ? undefined : (input ?? 0) + (output ?? 0)),
  }
}
