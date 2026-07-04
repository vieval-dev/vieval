import { afterEach, describe, expect, it, vi } from 'vitest'

import { createLobeHubAnswerAgentAdapter } from './answer-agent'

describe('createLobeHubAnswerAgentAdapter', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('posts the final prompt to the answer endpoint with webhook headers', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      answer: 'a',
      contextIds: ['D1:3', 'mem-1'],
      diagnostics: {
        finalMessageId: 'message-1',
        memorySearches: [
          {
            apiName: 'searchUserMemory',
            arguments: { queries: ['relationship status'] },
            contextIdCount: 2,
            contextIds: ['D1:3', 'mem-1'],
            layerCounts: { identities: 1 },
          },
        ],
        memoryToolCallCount: 1,
        toolCallCount: 1,
      },
      operationId: 'op-1',
      status: 'done',
      steps: 3,
    }), {
      headers: {
        'content-type': 'application/json',
      },
      status: 200,
    }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('MEMORY_USER_MEMORY_WEBHOOK_HEADERS', 'Authorization=Bearer token,X-Benchmark=locomo')

    const adapter = createLobeHubAnswerAgentAdapter({
      baseUrl: 'http://localhost:3011',
      maxSteps: 12,
    })

    const result = await adapter.answerCase({
      caseId: 'case-1',
      category: 5,
      question: 'Select the correct answer: (a) Unknown (b) Some claim.',
      rawQuestion: 'Select?',
      sampleId: 'conv-1',
    })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3011/api/dev/memory-user-memory/benchmark-locomo-answer', {
      body: JSON.stringify({
        maxSteps: 12,
        prompt: 'Select the correct answer: (a) Unknown (b) Some claim.',
        sampleId: 'conv-1',
      }),
      headers: {
        'Authorization': 'Bearer token',
        'content-type': 'application/json',
        'X-Benchmark': 'locomo',
      },
      method: 'POST',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>
    expect(body).not.toHaveProperty('goldAnswer')
    expect(body).not.toHaveProperty('model')
    expect(body).not.toHaveProperty('provider')
    expect(result).toEqual({
      contextIds: ['D1:3', 'mem-1'],
      diagnostics: {
        finalMessageId: 'message-1',
        memorySearches: [
          {
            apiName: 'searchUserMemory',
            arguments: { queries: ['relationship status'] },
            contextIdCount: 2,
            contextIds: ['D1:3', 'mem-1'],
            layerCounts: { identities: 1 },
          },
        ],
        memoryToolCallCount: 1,
        operationId: 'op-1',
        status: 'done',
        steps: 3,
        toolCallCount: 1,
      },
      prediction: 'a',
    })
  })

  it('uses fixed user id and env max steps when configured', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      answer: 'May 2023',
    }), {
      headers: {
        'content-type': 'application/json',
      },
      status: 200,
    }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('LOBEHUB_AGENT_MAX_STEPS', '7')
    vi.stubEnv('LOBEHUB_USER_ID', 'fixed-user')
    vi.stubEnv('MEMORY_USER_MEMORY_WEBHOOK_HEADERS', '')

    const adapter = createLobeHubAnswerAgentAdapter({
      baseUrl: 'http://localhost:3011/',
      path: '/custom-answer',
    })

    await adapter.answerCase({
      caseId: 'case-2',
      category: 2,
      question: 'When did Caroline visit Melanie?',
      rawQuestion: 'When did Caroline visit Melanie?',
      sampleId: 'conv-1',
    })

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3011/custom-answer', {
      body: JSON.stringify({
        maxSteps: 7,
        prompt: 'When did Caroline visit Melanie?',
        userId: 'fixed-user',
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    })
  })

  it('throws on non-ok response', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, {
      status: 500,
      statusText: 'Internal Server Error',
    }))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createLobeHubAnswerAgentAdapter({ baseUrl: 'http://localhost:3011' })

    await expect(adapter.answerCase({
      caseId: 'case-1',
      category: 1,
      question: 'Question?',
      rawQuestion: 'Question?',
      sampleId: 'conv-1',
    })).rejects.toThrow('lobehub answer failed: 500 Internal Server Error')
  })
})
