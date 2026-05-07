import type { LoCoMoAnswerGeneratorAdapter } from '../contracts.ts'

import { createHash } from 'node:crypto'

/**
 * Controls how LoCoMo generated-answer cache is used.
 *
 * Use when:
 * - benchmark runs need either reproducible replay or fresh answer generation
 *
 * Expects:
 * - `read-write` to read hits and write misses
 * - `read-only` to fail on misses without model calls
 * - `off` to bypass cache completely
 */
export type LoCoMoAnswerPredictionCacheMode = 'off' | 'read-only' | 'read-write'

/**
 * Stable namespace inputs for generated-answer cache entries.
 *
 * Use when:
 * - answer predictions must be invalidated across dataset, prompt, retriever, or topK changes
 *
 * Expects:
 * - `datasetHash` to identify the normalized LoCoMo sample set
 * - `promptVersion` to change when generation prompt semantics change
 * - `retrieverId` to identify the memory backend adapter
 * - `topK` to match retriever context size
 */
export interface LoCoMoAnswerPredictionCacheNamespaceParts {
  /**
   * Hash of the normalized LoCoMo dataset samples used by this run.
   */
  datasetHash: string
  /**
   * Prompt/cache schema version for answer generation.
   */
  promptVersion: string
  /**
   * Retriever adapter identifier.
   */
  retrieverId: string
  /**
   * Number of retrieved memory items requested for answer context.
   */
  topK: number
}

interface LoCoMoAnswerPredictionCacheRuntime {
  namespace: (name: string) => {
    file: (options: { ext?: string, key: readonly string[] }) => {
      exists: () => Promise<boolean>
      loadAsExpectFixture: <T>() => Promise<T>
      writeJson: (value: unknown) => Promise<void>
    }
  }
}

/**
 * Options for creating a cached LoCoMo answer generator.
 *
 * Use when:
 * - wrapping an existing answer generator with task-cache backed prediction reuse
 *
 * Expects:
 * - `cache` to provide the minimal Vieval cache file APIs
 * - `generator` to be the uncached answer generator
 * - `mode` to define miss behavior
 * - `namespaceParts` to contain stable cache identity inputs
 */
export interface CachedLoCoMoAnswerGeneratorOptions {
  /**
   * Task cache runtime from Vieval case context.
   */
  cache: LoCoMoAnswerPredictionCacheRuntime
  /**
   * Underlying generator used on cache miss when mode allows writes.
   */
  generator: LoCoMoAnswerGeneratorAdapter
  /**
   * Cache hit/miss behavior.
   */
  mode: LoCoMoAnswerPredictionCacheMode
  /**
   * Stable cache identity fields.
   */
  namespaceParts: LoCoMoAnswerPredictionCacheNamespaceParts
}

interface CachedLoCoMoAnswerPrediction {
  prediction: string
}

/**
 * Normalizes LoCoMo answer prediction cache mode.
 *
 * Before:
 * - "readonly"
 *
 * After:
 * - "read-only"
 */
export function normalizeLoCoMoAnswerPredictionCacheMode(value?: string): LoCoMoAnswerPredictionCacheMode {
  if (value == null || value.length === 0) {
    return 'read-write'
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'off' || normalized === 'read-only' || normalized === 'read-write') {
    return normalized
  }
  if (normalized === 'readonly') {
    return 'read-only'
  }
  if (normalized === 'readwrite') {
    return 'read-write'
  }

  throw new Error(`Invalid LoCoMo answer prediction cache mode: ${value}`)
}

function hashPredictionInput(input: {
  contextText: string
  question: string
}): string {
  return createHash('sha256')
    .update(JSON.stringify({
      contextText: input.contextText,
      question: input.question,
    }))
    .digest('hex')
    .slice(0, 16)
}

/**
 * Normalizes LoCoMo case id for cache paths.
 *
 * Before:
 * - "conv-26::1"
 *
 * After:
 * - "conv-26--1"
 */
function normalizeCaseIdForCachePath(caseId: string): string {
  return caseId.replaceAll('::', '--')
}

/**
 * Wraps a LoCoMo answer generator with deterministic prediction caching.
 *
 * Use when:
 * - repeated benchmark runs should not regenerate expensive LLM predictions
 * - read-only benchmark replays should fail instead of making accidental model calls
 *
 * Expects:
 * - cache namespace identity to include dataset, prompt, retriever, generator, and topK
 * - context-sensitive hash to change when retrieved context or generated prompt changes
 *
 * Returns:
 * - a benchmark-compatible answer generator with cache hit/miss behavior controlled by mode
 */
export function createCachedLoCoMoAnswerGenerator(
  options: CachedLoCoMoAnswerGeneratorOptions,
): LoCoMoAnswerGeneratorAdapter {
  if (options.mode === 'off') {
    return options.generator
  }

  return {
    id: `${options.generator.id}-cached-${options.mode}`,
    async generateAnswer(input) {
      const entry = options.cache.namespace('locomo-answer-predictions').file({
        ext: 'json',
        key: [
          options.namespaceParts.datasetHash,
          options.namespaceParts.promptVersion,
          options.namespaceParts.retrieverId,
          options.generator.id,
          `top-k-${options.namespaceParts.topK}`,
          normalizeCaseIdForCachePath(input.caseId),
          hashPredictionInput({
            contextText: input.contextText,
            question: input.question,
          }),
        ],
      })

      if (await entry.exists()) {
        const cached = await entry.loadAsExpectFixture<CachedLoCoMoAnswerPrediction>()
        return cached.prediction
      }

      if (options.mode === 'read-only') {
        throw new Error(`Missing cached LoCoMo answer prediction for ${input.caseId}`)
      }

      const prediction = await options.generator.generateAnswer(input)
      await entry.writeJson({ prediction } satisfies CachedLoCoMoAnswerPrediction)
      return prediction
    },
  }
}
