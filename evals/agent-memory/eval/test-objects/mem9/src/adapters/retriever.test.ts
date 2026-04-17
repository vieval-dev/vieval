import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMem9RetrieverAdapter } from './retriever'

describe('createMem9RetrieverAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mem9 retriever adapter returns contextText for locomo case input', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      memory: [
        {
          content: 'Alice moved to Tokyo',
          id: 'm1',
          score: 0.91,
        },
      ],
    }), {
      headers: {
        'content-type': 'application/json',
      },
      status: 200,
    }))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createMem9RetrieverAdapter({
      baseUrl: 'http://localhost:10010',
      tenantId: 'tenant-1',
    })

    const output = await adapter.retrieveContext({
      question: 'Where did Alice move?',
      sampleId: 'sample-1',
      topK: 5,
    })

    expect(output.contextText).toContain('Alice moved to Tokyo')
    expect(output.contextIds).toEqual(['m1'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
