import type { LoCoMoAnswerAgentAdapter } from '@vieval/eval-agent-memory'

import { env } from 'node:process'

/**
 * Configures the LobeHub LoCoMo answer-agent adapter.
 *
 * Use when:
 * - Vieval needs LobeHub to answer final benchmark prompts through its agent runtime
 * - benchmark runs need to pass local webhook auth headers
 *
 * Expects:
 * - `baseUrl` to point at a LobeHub server with benchmark answer routes enabled
 * - `path` to accept a synchronous answer request body
 *
 * Returns:
 * - options consumed by {@link createLobeHubAnswerAgentAdapter}
 */
export interface LobeHubAnswerAgentAdapterOptions {
  /**
   * Base URL for the LobeHub server.
   *
   * @default process.env.LOBEHUB_BASE_URL ?? 'http://localhost:3210'
   */
  baseUrl?: string
  /**
   * Maximum agent runtime steps.
   *
   * @default Number(process.env.LOBEHUB_AGENT_MAX_STEPS ?? 10)
   */
  maxSteps?: number
  /**
   * API route for the synchronous answer endpoint.
   *
   * @default '/api/dev/memory-user-memory/benchmark-locomo-answer'
   */
  path?: string
  /**
   * Fixed LobeHub user ID. Leave unset for sample-based lookup.
   */
  userId?: string
}

interface LobeHubAnswerResponse {
  answer?: string
  contextIds?: string[]
  diagnostics?: {
    finalMessageId?: string
    memorySearches?: Array<{
      apiName?: string
      arguments?: unknown
      contextIdCount?: number
      contextIds?: string[]
      layerCounts?: Record<string, number>
    }>
    memoryToolCallCount?: number
    toolCallCount?: number
  }
  operationId?: string
  status?: string
  steps?: number
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

/**
 * Creates a LobeHub answer-agent adapter mapped to the LoCoMo benchmark contract.
 *
 * Use when:
 * - evaluating LobeHub through the real synchronous agent answer endpoint
 * - Vieval should only format prompts and score returned final answers
 *
 * Expects:
 * - LobeHub benchmark answer routes to be enabled
 * - imported memories to use `locomo-user-${sampleId}` unless `userId` is fixed
 *
 * Returns:
 * - an answer-agent adapter that sends prompt, user/sample identity, and step limit only
 */
export function createLobeHubAnswerAgentAdapter(
  options: LobeHubAnswerAgentAdapterOptions = {},
): LoCoMoAnswerAgentAdapter {
  const baseUrl = (options.baseUrl ?? env.LOBEHUB_BASE_URL ?? 'http://localhost:3210').replace(/\/$/, '')
  const path = options.path ?? '/api/dev/memory-user-memory/benchmark-locomo-answer'
  const webhookHeaders = parseHeaderPairs(env.MEMORY_USER_MEMORY_WEBHOOK_HEADERS)
  const userId = options.userId ?? env.LOBEHUB_USER_ID
  const maxSteps = options.maxSteps ?? Number(env.LOBEHUB_AGENT_MAX_STEPS ?? 10)

  return {
    id: 'lobehub-answer-agent',
    async answerCase(input) {
      const response = await fetch(`${baseUrl}${path}`, {
        body: JSON.stringify(userId
          ? {
              maxSteps,
              prompt: input.question,
              userId,
            }
          : {
              maxSteps,
              prompt: input.question,
              sampleId: input.sampleId,
            }),
        headers: {
          ...webhookHeaders,
          // LobeHub benchmark answer endpoints accept JSON POST bodies.
          'content-type': 'application/json',
        },
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error(`lobehub answer failed: ${response.status} ${response.statusText}`)
      }

      const payload = await response.json() as LobeHubAnswerResponse

      return {
        contextIds: payload.contextIds ?? [],
        diagnostics: {
          finalMessageId: payload.diagnostics?.finalMessageId,
          memorySearches: payload.diagnostics?.memorySearches,
          memoryToolCallCount: payload.diagnostics?.memoryToolCallCount,
          operationId: payload.operationId,
          status: payload.status,
          steps: payload.steps,
          toolCallCount: payload.diagnostics?.toolCallCount,
        },
        prediction: payload.answer ?? '',
      }
    },
  }
}
