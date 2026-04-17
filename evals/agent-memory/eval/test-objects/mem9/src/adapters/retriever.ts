import type { LoCoMoRetrieverAdapter } from '@vieval/eval-agent-memory'

import { env } from 'node:process'

export interface Mem9RetrieverAdapterOptions {
  baseUrl?: string
  tenantId: string
  topK?: number
}

interface Mem9SearchResponse {
  memory?: {
    content?: string
    id?: string
    score?: number
  }[]
}

/**
 * Creates a mem9 retriever adapter mapped to LoCoMo benchmark contract.
 */
export function createMem9RetrieverAdapter(options: Mem9RetrieverAdapterOptions): LoCoMoRetrieverAdapter {
  const resolvedBaseUrl = (options.baseUrl ?? env.MEM9_BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '')
  const topK = options.topK ?? 10

  return {
    id: 'mem9-retriever',
    async retrieveContext(input) {
      const response = await fetch(`${resolvedBaseUrl}/memory/search`, {
        body: JSON.stringify({
          limit: topK,
          q: input.question,
          tenant_id: options.tenantId,
        }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error(`mem9 retrieve failed: ${response.status} ${response.statusText}`)
      }

      const payload = await response.json() as Mem9SearchResponse
      const memories = payload.memory ?? []

      return {
        contextIds: memories
          .map(memory => memory.id)
          .filter((id): id is string => id != null),
        contextText: memories
          .map((memory, index) => {
            const scoreLabel = typeof memory.score === 'number' ? ` score=${memory.score.toFixed(4)}` : ''
            return `#${index + 1}${scoreLabel}\n${memory.content ?? ''}`
          })
          .join('\n\n'),
      }
    },
  }
}
