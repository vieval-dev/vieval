import type { ReducedInferenceEvent } from './reduce'

import { describe, expect, it } from 'vitest'

import { groupInferenceCalls, sumInference, summarizeByModel, tokenUsage } from './inference'

const provider = { id: 'openai', model: 'gpt-6.1-sol' }
const toolCall = { args: { command_id: 'display.capture', inputs: {} }, id: 'call_1', name: 'invoke' }

// Shape of one OSWorld step as `emitChatModelResponseTelemetry` writes it (run-1791893465639-f3bd63fe).
function step(seq: number, usage: Record<string, number>): ReducedInferenceEvent[] {
  return [
    { data: { data: { api: 'responses', step: seq }, modality: 'chat', provider }, event: 'inference.requested', roundIndex: 0, seq, time: '2026-10-13T12:13:08.178Z' },
    { data: { metering: { dimensions: { ...usage, tool_call_count: 1 }, latency_ms: 4000 }, metrics: { 'vieval.chat.tool_call_count': 1 }, modality: 'chat', provider, toolCalls: [toolCall] }, event: 'inference.responded', roundIndex: 0, seq: seq + 1, time: '2026-10-13T12:13:12.937Z' },
    { data: { modality: 'chat', provider, toolCall }, event: 'tool-call.started', roundIndex: 0, seq: seq + 2, time: '2026-10-13T12:13:12.937Z' },
    { data: { modality: 'chat', provider, toolCall }, event: 'tool-call.ended', roundIndex: 0, seq: seq + 3, time: '2026-10-13T12:13:12.937Z' },
  ]
}

describe('groupInferenceCalls', () => {
  /**
   * @example
   * expect(calls).toHaveLength(2)
   */
  it('makes one call of a request, its response, and its tool-call events', () => {
    const calls = groupInferenceCalls([...step(1, { input_tokens: 100, output_tokens: 10 }), ...step(5, { input_tokens: 200, output_tokens: 20 })])
    expect(calls).toHaveLength(2)
    expect(calls[0].state).toBe('responded')
    expect(calls[0].events.map(event => event.seq)).toEqual([1, 2, 3, 4])
    expect(calls[0].provider).toEqual(provider)
    expect(calls[0].request).toEqual({ api: 'responses', step: 1 })
    expect(calls[0].toolCalls).toEqual([toolCall])
    expect(calls[0].latencyMs).toBe(4000)
    expect(calls[1].usage.input_tokens).toBe(200)
  })

  /**
   * @example
   * expect(calls.map(call => call.state)).toEqual(['failed', 'pending'])
   */
  it('keeps failed and unanswered requests, and a response whose request is missing', () => {
    const calls = groupInferenceCalls([
      { data: { modality: 'chat', provider }, event: 'inference.requested', seq: 1, time: 't1' },
      { data: { error: 'rate limited', modality: 'chat', provider }, event: 'inference.failed', seq: 2, time: 't2' },
      { data: { metering: { dimensions: {} }, metrics: {}, modality: 'chat', toolCalls: [] }, event: 'inference.responded', seq: 3, time: 't3' },
      { data: { modality: 'chat', provider }, event: 'inference.requested', seq: 4, time: 't4' },
    ])
    expect(calls.map(call => call.state)).toEqual(['failed', 'responded', 'pending'])
    expect(calls[0].error).toBe('rate limited')
    expect(calls[1].requestedAt).toBeUndefined()
    expect(calls[1].settledAt).toBe('t3')
  })
})

describe('summarizeByModel', () => {
  /**
   * @example
   * expect(models.map(model => model.label)).toEqual(['gpt-6.1-sol', 'judge-1'])
   */
  it('sums usage per model and never across models', () => {
    const judge = { id: 'anthropic', model: 'judge-1' }
    const calls = groupInferenceCalls([
      ...step(1, { input_tokens: 100, output_tokens: 10 }),
      { data: { modality: 'chat', provider: judge }, event: 'inference.requested', seq: 5, time: 't5' },
      { data: { metering: { dimensions: { input_tokens: 50, output_tokens: 5 }, latency_ms: 1000 }, metrics: {}, modality: 'chat', provider: judge, toolCalls: [] }, event: 'inference.responded', seq: 6, time: 't6' },
      ...step(7, { input_tokens: 200, output_tokens: 20 }),
    ])
    const models = summarizeByModel(calls)
    expect(models.map(model => model.label)).toEqual(['gpt-6.1-sol', 'judge-1'])
    expect(models[0].calls).toBe(2)
    expect(models[0].toolCalls).toBe(2)
    expect(models[0].latencyMs).toBe(8000)
    expect(models[0].usage.input_tokens).toBe(300)
    expect(models[1].calls).toBe(1)
    expect(models[1].usage.input_tokens).toBe(50)
  })

  /**
   * @example
   * expect(models.map(model => model.label)).toEqual(['openai/gpt-6.1-sol', 'azure/gpt-6.1-sol'])
   */
  it('names the provider when two providers serve a model of the same name', () => {
    const azure = { id: 'azure', model: 'gpt-6.1-sol' }
    const calls = groupInferenceCalls([
      ...step(1, { input_tokens: 100 }),
      { data: { modality: 'chat', provider: azure }, event: 'inference.requested', seq: 5, time: 't5' },
      { data: { error: 'timeout', modality: 'chat', provider: azure }, event: 'inference.failed', seq: 6, time: 't6' },
    ])
    const models = summarizeByModel(calls)
    expect(models.map(model => model.label)).toEqual(['openai/gpt-6.1-sol', 'azure/gpt-6.1-sol'])
    expect(models[1].failed).toBe(1)
    expect(models[1].responses).toBe(0)
  })
})

describe('sumInference', () => {
  /**
   * @example
   * expect(totals.totals.input_tokens).toBe(300)
   */
  it('counts requests and sums usage and latency', () => {
    const totals = sumInference([...step(1, { input_tokens: 100, output_tokens: 10 }), ...step(5, { input_tokens: 200, output_tokens: 20 })])
    expect(totals.requests).toBe(2)
    expect(totals.responses).toBe(2)
    expect(totals.failed).toBe(0)
    expect(totals.totals.input_tokens).toBe(300)
    expect(totals.totals.output_tokens).toBe(30)
    expect(totals.totals.latency_ms).toBe(8000)
  })
})

describe('tokenUsage', () => {
  /**
   * @example
   * expect(tokenUsage({ input_tokens: 7562 }).input).toBe(7562)
   */
  it('reads Responses API usage fields', () => {
    const usage = tokenUsage({ 'input_tokens': 7562, 'input_tokens_details.cached_tokens': 7424, 'output_tokens': 23, 'output_tokens_details.reasoning_tokens': 4, 'total_tokens': 7585 })
    expect(usage).toEqual({ cached: 7424, input: 7562, output: 23, reasoning: 4, total: 7585 })
  })

  /**
   * @example
   * expect(tokenUsage({ prompt_tokens: 120, completion_tokens: 30 }).total).toBe(150)
   */
  it('reads Chat Completions usage fields and adds a missing total', () => {
    const usage = tokenUsage({ 'completion_tokens': 30, 'prompt_tokens': 120, 'prompt_tokens_details.cached_tokens': 100 })
    expect(usage).toEqual({ cached: 100, input: 120, output: 30, reasoning: undefined, total: 150 })
  })
})
