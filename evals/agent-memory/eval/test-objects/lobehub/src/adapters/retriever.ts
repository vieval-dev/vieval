import type { LoCoMoRetrieverAdapter } from '@vieval/eval-agent-memory'

import { env } from 'node:process'

export interface LobeHubRetrieverAdapterOptions {
  baseUrl?: string
  path?: string
  topK?: number
  userId?: string
}

interface LobeHubMemoryRecord {
  id?: string
  memory?: string
  score?: number
}

interface LobeHubRetrieveResponse {
  items?: LobeHubMemoryRecord[]
}

/**
 * Creates a LobeHub retriever adapter mapped to LoCoMo benchmark contract.
 */
export function createLobeHubRetrieverAdapter(options: LobeHubRetrieverAdapterOptions = {}): LoCoMoRetrieverAdapter {
  const baseUrl = (options.baseUrl ?? env.LOBEHUB_BASE_URL ?? 'http://localhost:3210').replace(/\/$/, '')
  const path = options.path ?? '/api/dev/memory-user-memory/eval-agent-memory'
  const topK = options.topK ?? 10
  const userId = options.userId ?? env.LOBEHUB_USER_ID ?? 'benchmark-locomo'

  return {
    id: 'lobehub-retriever',
    async retrieveContext(input) {
      const response = await fetch(`${baseUrl}${path}`, {
        body: JSON.stringify({
          limit: topK,
          query: input.question,
          userId,
        }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error(`lobehub retrieve failed: ${response.status} ${response.statusText}`)
      }

      const payload = await response.json() as LobeHubRetrieveResponse
      const items = payload.items ?? []

      return {
        contextIds: items.map(item => item.id).filter((id): id is string => id != null),
        contextText: items
          .map((item, index) => {
            const scoreLabel = typeof item.score === 'number' ? ` score=${item.score.toFixed(4)}` : ''
            return `#${index + 1}${scoreLabel}\n${item.memory ?? ''}`
          })
          .join('\n\n'),
      }
    },
  }
}
