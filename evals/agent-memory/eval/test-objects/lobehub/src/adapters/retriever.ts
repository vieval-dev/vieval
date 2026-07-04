import type { LoCoMoRetrieverAdapter } from '@vieval/eval-agent-memory'

import { env } from 'node:process'

import { errorMessageFrom, withRetry } from '@moeru/std'

/**
 * Configures the LobeHub LoCoMo retriever adapter.
 *
 * Use when:
 * - Vieval needs to query a local or deployed LobeHub memory benchmark endpoint
 * - benchmark runs need to pass local webhook auth headers
 *
 * Expects:
 * - `baseUrl` to point at a LobeHub server with benchmark LoCoMo enabled
 * - `path` to accept the benchmark search request body
 *
 * Returns:
 * - options consumed by {@link createLobeHubRetrieverAdapter}
 */
export interface LobeHubRetrieverAdapterOptions {
  /**
   * Base URL for the LobeHub server.
   *
   * @default process.env.LOBEHUB_BASE_URL ?? 'http://localhost:3210'
   */
  baseUrl?: string
  /**
   * API route for the LobeHub benchmark memory search endpoint.
   *
   * @default '/api/dev/memory-user-memory/benchmark-locomo'
   */
  path?: string
  /**
   * Default number of memories requested from LobeHub when the task input does not override it.
   *
   * @default 10
   */
  topK?: number
  /**
   * Fixed LobeHub user ID. Leave unset for LoCoMo sample-based lookup.
   */
  userId?: string
}

interface LobeHubMemoryRecord {
  id?: string
  layer?: string
  memory?: string | {
    details?: null | string
    summary?: null | string
    title?: null | string
  }
  score?: number
  sourceIds?: string[]
}

interface LobeHubRetrievedContextResponse {
  [layer: string]: undefined | unknown[]
}

interface LobeHubRetrieveResponse {
  contextText?: string
  debug?: {
    itemCount?: number
    joinedMemoryCount?: number
    searched?: Record<string, number>
  }
  items?: LobeHubMemoryRecord[]
  retrievedContext?: LobeHubRetrievedContextResponse
}

/**
 * Creates a LobeHub retriever adapter mapped to the LoCoMo benchmark contract.
 *
 * Use when:
 * - evaluating LobeHub memory retrieval with Vieval LoCoMo cases
 * - comparing LobeHub memory against other memory-agent test objects
 *
 * Expects:
 * - LobeHub benchmark LoCoMo routes to be enabled
 * - imported memories to use `locomo-user-${sampleId}` unless `userId` is fixed
 *
 * Returns:
 * - a retriever adapter that emits text context and source IDs for answer generation
 */
export function createLobeHubRetrieverAdapter(options: LobeHubRetrieverAdapterOptions = {}): LoCoMoRetrieverAdapter {
  const baseUrl = (options.baseUrl ?? env.LOBEHUB_BASE_URL ?? 'http://localhost:3210').replace(/\/$/, '')
  const path = options.path ?? '/api/dev/memory-user-memory/benchmark-locomo'
  const webhookHeaders = parseHeaderPairs(env.MEMORY_USER_MEMORY_WEBHOOK_HEADERS)
  const userId = options.userId ?? env.LOBEHUB_USER_ID

  return {
    id: 'lobehub-retriever',
    async retrieveContext(input) {
      const topK = options.topK ?? input.topK ?? 10
      const response = await fetchWithRetry(`${baseUrl}${path}`, {
        body: JSON.stringify(userId
          ? {
              query: input.question,
              topK,
              userId,
            }
          : {
              query: input.question,
              sampleId: input.sampleId,
              topK,
            }),
        headers: {
          ...webhookHeaders,
          // LobeHub benchmark endpoints accept JSON POST bodies for retrieval.
          'content-type': 'application/json',
        },
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error(`lobehub retrieve failed: ${response.status} ${response.statusText}`)
      }

      const payload = await response.json() as LobeHubRetrieveResponse
      const items = payload.items ?? []
      const retrievedLayerCounts = countRetrievedLayers(payload.retrievedContext)
      const fallbackContextText = items
        .map((item, index) => {
          const scoreLabel = typeof item.score === 'number' ? ` score=${item.score.toFixed(4)}` : ''
          return `#${index + 1}${scoreLabel}\n${formatMemoryRecord(item)}`
        })
        .join('\n\n')

      return {
        contextIds: getContextIds(items),
        contextText: payload.contextText ?? fallbackContextText,
        diagnostics: {
          itemCount: payload.debug?.itemCount ?? items.length,
          joinedMemoryCount: payload.debug?.joinedMemoryCount,
          retrievedContextCount: sumLayerCounts(retrievedLayerCounts),
          retrievedLayerCounts,
          searchedLayerCounts: payload.debug?.searched,
        },
      }
    },
  }
}

function countRetrievedLayers(retrievedContext: LobeHubRetrievedContextResponse | undefined): Record<string, number> | undefined {
  if (retrievedContext == null) {
    return undefined
  }

  return Object.fromEntries(
    Object.entries(retrievedContext).map(([layer, items]) => [
      layer,
      Array.isArray(items) ? items.length : 0,
    ]),
  )
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastErrorMessage = 'Unknown fetch error'
  // NOTICE:
  // Local LobeHub dev benchmark calls can occasionally hit undici header
  // timeouts while the backend is still healthy. Retrying the whole retrieval
  // request keeps long LoCoMo runs from failing after a single slow case.
  // Removal condition: the benchmark endpoint supports server-side job
  // polling or the caller gets first-class retry controls.
  const fetchOnce = withRetry(async () => {
    const response = await fetch(url, init)

    if (response.ok || response.status < 500) {
      return response
    }

    lastErrorMessage = `${response.status} ${response.statusText}`
    throw new Error(`lobehub retrieve returned retryable status: ${lastErrorMessage}`)
  }, {
    onError(error) {
      lastErrorMessage = errorMessageFrom(error) ?? lastErrorMessage
    },
    retry: 2,
    retryDelay: 1000,
    retryDelayFactor: 2,
    retryDelayMax: 3000,
  })

  try {
    return await fetchOnce()
  }
  catch (error) {
    throw new Error(`lobehub retrieve failed after retry: ${errorMessageFrom(error) ?? lastErrorMessage}`)
  }
}

function formatMemoryRecord(item: LobeHubMemoryRecord): string {
  if (typeof item.memory === 'string')
    return item.memory

  const parts = [
    item.layer ? `Layer: ${item.layer}` : undefined,
    item.memory?.title ? `Title: ${item.memory.title}` : undefined,
    item.memory?.summary ? `Summary: ${item.memory.summary}` : undefined,
    item.memory?.details ? `Details: ${item.memory.details}` : undefined,
  ]

  return parts.filter((part): part is string => Boolean(part)).join('\n')
}

function getContextIds(items: LobeHubMemoryRecord[]): string[] {
  return items.flatMap((item) => {
    if (item.sourceIds != null && item.sourceIds.length > 0) {
      return item.sourceIds
    }

    return item.id == null ? [] : [item.id]
  })
}

/**
 * Parses comma-separated header pairs.
 *
 * Before:
 * - "Authorization=Bearer token,X-Benchmark=locomo"
 *
 * After:
 * - { Authorization: "Bearer token", "X-Benchmark": "locomo" }
 */
function parseHeaderPairs(value?: string): Record<string, string> {
  return value
    ?.split(',')
    .filter(Boolean)
    .reduce<Record<string, string>>((headers, pair) => {
      const [key, ...valueParts] = pair.split('=')
      const headerName = key?.trim()
      const headerValue = valueParts.join('=').trim()

      if (headerName && headerValue) {
        headers[headerName] = headerValue
      }

      return headers
    }, {}) ?? {}
}

function sumLayerCounts(counts: Record<string, number> | undefined): number | undefined {
  if (counts == null) {
    return undefined
  }

  return Object.values(counts).reduce((sum, count) => sum + count, 0)
}
