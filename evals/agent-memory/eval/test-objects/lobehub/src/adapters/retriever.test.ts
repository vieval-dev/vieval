import { afterEach, describe, expect, it, vi } from 'vitest'

import { createLobeHubRetrieverAdapter } from './retriever'

describe('createLobeHubRetrieverAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lobehub retriever maps endpoint response to benchmark retriever contract', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      items: [
        {
          id: 'l1',
          memory: 'Alice moved to Tokyo in 2020.',
          score: 0.87,
        },
      ],
    }), {
      headers: {
        'content-type': 'application/json',
      },
      status: 200,
    }))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createLobeHubRetrieverAdapter({
      baseUrl: 'http://localhost:3210',
    })

    const output = await adapter.retrieveContext({
      question: 'Where did Alice move?',
      sampleId: 'sample-1',
      topK: 5,
    })

    expect(output.contextIds).toEqual(['l1'])
    expect(output.contextText).toContain('Alice moved to Tokyo')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
