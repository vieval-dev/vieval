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

  it('lobehub retriever prefers benchmark source ids for evidence recall when available', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      items: [
        {
          id: 'mem-1',
          layer: 'experience',
          memory: {
            details: 'Alice moved to Tokyo in 2020.',
            summary: 'Alice moved to Tokyo.',
            title: 'Alice relocation',
          },
          sourceIds: ['D2:7', 'D2:8'],
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

    expect(output.contextIds).toEqual(['D2:7', 'D2:8'])
    expect(output.contextText).toContain('Alice relocation')
  })

  it('lobehub retriever uses endpoint formatted context when the benchmark route provides it', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      contextText: '<activities><activity><startsAt>2023-05-07</startsAt></activity></activities>',
      items: [
        {
          id: 'mem-1',
          layer: 'activity',
          memory: {
            summary: 'Caroline went to the LGBTQ support group.',
          },
          sourceIds: ['D1:3'],
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
      question: 'When did Caroline go to the LGBTQ support group?',
      sampleId: 'sample-1',
      topK: 5,
    })

    expect(output.contextIds).toEqual(['D1:3'])
    expect(output.contextText).toBe('<activities><activity><startsAt>2023-05-07</startsAt></activity></activities>')
  })

  it('lobehub retriever preserves benchmark retrieval diagnostics from endpoint response', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      debug: {
        itemCount: 0,
        joinedMemoryCount: 0,
        searched: {
          activities: 0,
          contexts: 1,
          experiences: 0,
          preferences: 0,
        },
      },
      items: [],
      retrievedContext: {
        contexts: [
          {
            description: 'Alice moved to Tokyo in 2020.',
            id: 'ctx-raw-1',
            userMemoryIds: ['missing-memory'],
          },
        ],
        experiences: [],
      },
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

    expect(output.contextIds).toEqual([])
    expect(output.contextText).toBe('')
    expect(output.diagnostics).toEqual({
      itemCount: 0,
      joinedMemoryCount: 0,
      retrievedContextCount: 1,
      retrievedLayerCounts: {
        contexts: 1,
        experiences: 0,
      },
      searchedLayerCounts: {
        activities: 0,
        contexts: 1,
        experiences: 0,
        preferences: 0,
      },
    })
  })
})
