import { afterEach, describe, expect, it, vi } from 'vitest'

import { createLobeHubRetrieverAdapter } from './retriever'

describe('createLobeHubRetrieverAdapter', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('lobehub retriever maps current benchmark endpoint response to benchmark retriever contract', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      items: [
        {
          id: 'l1',
          layer: 'experience',
          memory: {
            details: 'Alice moved to Tokyo in 2020.',
            summary: 'Alice moved to Tokyo.',
            title: 'Alice relocation',
          },
        },
      ],
    }), {
      headers: {
        'content-type': 'application/json',
      },
      status: 200,
    }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('MEMORY_USER_MEMORY_WEBHOOK_HEADERS', 'Authorization=Bearer test-token,X-Benchmark=locomo')

    const adapter = createLobeHubRetrieverAdapter({
      baseUrl: 'http://localhost:3210',
    })

    const output = await adapter.retrieveContext({
      question: 'Where did Alice move?',
      sampleId: 'sample-1',
      topK: 5,
    })

    expect(output.contextIds).toEqual(['l1'])
    expect(output.contextText).toContain('experience')
    expect(output.contextText).toContain('Alice relocation')
    expect(output.contextText).toContain('Alice moved to Tokyo')
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3210/api/dev/memory-user-memory/benchmark-locomo', {
      body: JSON.stringify({
        query: 'Where did Alice move?',
        sampleId: 'sample-1',
        topK: 5,
      }),
      headers: {
        'Authorization': 'Bearer test-token',
        'X-Benchmark': 'locomo',
        'content-type': 'application/json',
      },
      method: 'POST',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
