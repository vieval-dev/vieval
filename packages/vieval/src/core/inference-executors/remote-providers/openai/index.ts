import type { ProviderAdapter } from '../../adapters'
import type { RetryPolicyOptions } from '../../retry-policy'

import process from 'node:process'

import { createOpenAI } from '@xsai-ext/providers/create'

import { createProviderAdapter } from '../../adapters'
import { envFrom, requiredEnvFrom } from '../../env'

/**
 * Represents the OpenAI provider instance returned by xsai.
 */
export type OpenAIProvider = ReturnType<typeof createOpenAI>

/**
 * Represents the OpenAI adapter used by vieval.
 */
export type OpenAIProviderAdapter = ProviderAdapter<OpenAIProvider>

/**
 * Configures env key names and source for OpenAI provider setup.
 */
export interface OpenAIEnvSourceOptions {
  /**
   * Environment object used for variable lookup.
   *
   * @default process.env
   */
  env?: NodeJS.ProcessEnv
  /**
   * Env key name for API key.
   *
   * @default 'OPENAI_API_KEY'
   */
  apiKey?: string
  /**
   * Env key name for base URL.
   *
   * @default 'OPENAI_BASE_URL'
   */
  baseURL?: string
  /**
   * Env key name for model.
   *
   * @default 'OPENAI_MODEL'
   */
  model?: string
}

/**
 * Configures fallback defaults when env values are missing.
 */
export interface OpenAIFromEnvDefaultOptions {
  /**
   * API key fallback value.
   */
  apiKey?: string
  /**
   * Base URL fallback value.
   */
  baseURL?: string
  /**
   * Model fallback value.
   */
  model?: string
  /**
   * Retry policy override passed to provider adapter.
   */
  retryOptions?: RetryPolicyOptions
}

/**
 * Result produced by `createOpenAIFromEnv`.
 */
export interface OpenAIFromEnvResult {
  adapter: OpenAIProviderAdapter
  apiKey: string
  baseURL?: string
  model: string
}

/**
 * Minimal response shape returned by text-generation calls.
 */
export interface OpenAITextGenerationResult {
  /**
   * Text output from the provider.
   *
   * Some OpenAI-compatible implementations may return `null`.
   */
  text?: string | null
}

/**
 * Normalizes provider text output to a safe string.
 *
 * Before: `{ text: null }`
 * After: `''`
 *
 * Before: `{ text: 'hello' }`
 * After: `'hello'`
 */
export function normalizeOpenAITextOutput(result: OpenAITextGenerationResult): string {
  return typeof result.text === 'string' ? result.text : ''
}

/**
 * Creates an OpenAI provider adapter using environment variables with defaults.
 *
 * Example:
 * `const runtime = createOpenAIFromEnv({}, { model: 'gpt-4.1-mini' })`
 */
export function createOpenAIFromEnv(
  source: OpenAIEnvSourceOptions = {},
  defaults: OpenAIFromEnvDefaultOptions = {},
): OpenAIFromEnvResult {
  const env = source.env ?? process.env
  const apiKeyEnvKey = source.apiKey ?? 'OPENAI_API_KEY'
  const baseURLEnvKey = source.baseURL ?? 'OPENAI_BASE_URL'
  const modelEnvKey = source.model ?? 'OPENAI_MODEL'

  const apiKey = requiredEnvFrom(env[apiKeyEnvKey] ?? defaults.apiKey, {
    name: apiKeyEnvKey,
    type: 'string',
  })
  const model = requiredEnvFrom(env[modelEnvKey] ?? defaults.model, {
    name: modelEnvKey,
    type: 'string',
  })
  const baseURL = envFrom(env[baseURLEnvKey] ?? defaults.baseURL, {
    name: baseURLEnvKey,
    type: 'string',
  })
  const adapter = createOpenAIProviderAdapter(apiKey, baseURL, defaults.retryOptions)

  return {
    adapter,
    apiKey,
    baseURL,
    model,
  }
}

/**
 * Creates an OpenAI provider adapter for eval-time requests.
 *
 * Use when:
 * - an eval needs the OpenAI SDK surface plus the shared retry runner
 *
 * Expects:
 * - `apiKey` and `baseURL` to point at an OpenAI-compatible endpoint
 * - `retryOptions` to follow the same invariants as `createRetryPolicy`
 */
export function createOpenAIProviderAdapter(apiKey: string, baseURL?: string, retryOptions: RetryPolicyOptions = {}): OpenAIProviderAdapter {
  return createProviderAdapter(createOpenAI(apiKey, baseURL), retryOptions)
}
