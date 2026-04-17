import type { TaskRunContext } from '../../config/types'

import { describe, expect, it } from 'vitest'

import { emitChatModelErrorTelemetry, emitChatModelRequestTelemetry, emitChatModelResponseTelemetry, extractChatModelToolCalls, extractMeteringDimensions } from './telemetry'

function createTestTaskCacheRuntime() {
  return {
    namespace() {
      return {
        file() {
          throw new Error('not used in telemetry test')
        },
      }
    },
  } as TaskRunContext['cache']
}

describe('extractChatModelToolCalls', () => {
  it('normalizes tool calls from OpenAI-compatible response shapes', () => {
    const toolCalls = extractChatModelToolCalls({
      tool_calls: [
        {
          function: {
            arguments: '{"city":"tokyo","unit":"c"}',
            name: 'weather.lookup',
          },
          id: 'call_1',
        },
      ],
    })

    expect(toolCalls).toEqual([
      {
        args: {
          city: 'tokyo',
          unit: 'c',
        },
        id: 'call_1',
        name: 'weather.lookup',
      },
    ])
  })
})

describe('extractMeteringDimensions', () => {
  it('maps usage token fields into numeric metering dimensions', () => {
    const dimensions = extractMeteringDimensions({
      usage: {
        input_tokens: 12,
        output_tokens: 7,
        total_tokens: 19,
      },
    })

    expect(dimensions).toEqual({
      input_tokens: 12,
      output_tokens: 7,
      total_tokens: 19,
    })
  })
})

describe('emitChatModelResponseTelemetry', () => {
  it('emits inference response and per-tool lifecycle events', () => {
    const events: Array<{ caseId?: string, data?: unknown, event: string }> = []
    const context = {
      cache: createTestTaskCacheRuntime(),
      model() {
        throw new Error('not used in telemetry test')
      },
      reporterHooks: {
        onEvent(payload) {
          events.push(payload)
        },
      },
      task: {} as TaskRunContext['task'],
    } as TaskRunContext

    emitChatModelResponseTelemetry(context, {
      latencyMs: 842,
      provider: {
        id: 'openai',
        model: 'gpt-4.1-mini',
      },
      response: {
        tool_calls: [
          {
            function: {
              arguments: '{"city":"tokyo"}',
              name: 'weather.lookup',
            },
            id: 'call_1',
          },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 25,
          total_tokens: 125,
        },
      },
    })

    expect(events.map(event => event.event)).toEqual([
      'InferenceResponse',
      'ToolCallStarted',
      'ToolCallEnded',
    ])
    expect(events[0]?.caseId).toBeUndefined()
    expect(events[0]?.data).toMatchObject({
      metering: {
        dimensions: {
          input_tokens: 100,
          output_tokens: 25,
          tool_call_count: 1,
          total_tokens: 125,
        },
        latency_ms: 842,
      },
      provider: {
        id: 'openai',
        model: 'gpt-4.1-mini',
      },
    })
    expect(events[1]?.data).toMatchObject({
      toolCall: {
        args: {
          city: 'tokyo',
        },
        id: 'call_1',
        name: 'weather.lookup',
      },
    })
    expect(events[2]?.data).toMatchObject({
      toolCall: {
        args: {
          city: 'tokyo',
        },
        id: 'call_1',
        name: 'weather.lookup',
      },
    })
  })
})

describe('emitChatModelRequestTelemetry', () => {
  it('emits inference request events with model/provider payload', () => {
    const events: Array<{ caseId?: string, data?: unknown, event: string }> = []
    const context = {
      cache: createTestTaskCacheRuntime(),
      model() {
        throw new Error('not used in telemetry test')
      },
      reporterHooks: {
        onEvent(payload) {
          events.push(payload)
        },
      },
      task: {} as TaskRunContext['task'],
    } as TaskRunContext

    emitChatModelRequestTelemetry(context, {
      caseId: 'case-1',
      data: {
        messagesCount: 3,
      },
      provider: {
        id: 'openai',
        model: 'gpt-4.1-mini',
      },
    })

    expect(events).toEqual([
      {
        caseId: 'case-1',
        data: {
          data: {
            messagesCount: 3,
          },
          modality: 'chat',
          provider: {
            id: 'openai',
            model: 'gpt-4.1-mini',
          },
        },
        event: 'InferenceRequest',
      },
    ])
  })
})

describe('emitChatModelErrorTelemetry', () => {
  it('emits inference error events with normalized error message', () => {
    const events: Array<{ caseId?: string, data?: unknown, event: string }> = []
    const context = {
      cache: createTestTaskCacheRuntime(),
      model() {
        throw new Error('not used in telemetry test')
      },
      reporterHooks: {
        onEvent(payload) {
          events.push(payload)
        },
      },
      task: {} as TaskRunContext['task'],
    } as TaskRunContext

    emitChatModelErrorTelemetry(context, {
      caseId: 'case-2',
      error: new Error('provider timeout'),
      provider: {
        id: 'openai',
      },
    })

    expect(events).toEqual([
      {
        caseId: 'case-2',
        data: {
          error: 'provider timeout',
          modality: 'chat',
          provider: {
            id: 'openai',
          },
        },
        event: 'InferenceError',
      },
    ])
  })
})
