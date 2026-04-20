import type { ModelDefinition } from '../../config/models'
import type { ChatModelHeaders } from './index'

import { envFrom, requiredEnvFrom } from '../../core/inference-executors/env'

/**
 * Runtime config consumed by OpenAI-compatible provider constructors.
 */
export interface OpenAIChatModelRuntimeConfig {
  /**
   * Resolved inference executor kind.
   */
  inferenceExecutor: 'openai'
  /**
   * Concrete model name.
   */
  model: string
  /**
   * Required API key.
   */
  apiKey: string
  /**
   * Optional base URL override.
   */
  baseURL?: string
  /**
   * Optional request headers.
   */
  headers?: ChatModelHeaders
}

/**
 * Runtime config consumed by Ollama provider constructors.
 */
export interface OllamaChatModelRuntimeConfig {
  /**
   * Resolved inference executor kind.
   */
  inferenceExecutor: 'ollama'
  /**
   * Concrete model name.
   */
  model: string
  /**
   * Optional base URL override.
   */
  baseURL?: string
  /**
   * Optional request headers.
   */
  headers?: ChatModelHeaders
}

/**
 * Runtime config consumed by OpenRouter provider constructors.
 */
export interface OpenRouterChatModelRuntimeConfig {
  /**
   * Resolved inference executor kind.
   */
  inferenceExecutor: 'openrouter'
  /**
   * Concrete model name.
   */
  model: string
  /**
   * Required API key.
   */
  apiKey: string
  /**
   * Optional base URL override.
   */
  baseURL?: string
  /**
   * Optional request headers.
   */
  headers?: ChatModelHeaders
}

/**
 * Union of normalized runtime configs for supported chat-model executors.
 */
export type ChatModelRuntimeConfig
  = OpenAIChatModelRuntimeConfig
    | OllamaChatModelRuntimeConfig
    | OpenRouterChatModelRuntimeConfig

function getParameters(model: ModelDefinition): Record<string, unknown> {
  return model.parameters ?? {}
}

function parseOptionalStringParameter(
  parameters: Record<string, unknown>,
  key: string,
  modelId: string,
): string | undefined {
  const value = parameters[key]
  const normalized = value == null ? undefined : String(value)

  return envFrom(normalized, {
    name: `${modelId}.parameters.${key}`,
    type: 'string',
  })
}

function parseRequiredStringParameter(
  parameters: Record<string, unknown>,
  key: string,
  modelId: string,
): string {
  const value = parameters[key]
  const normalized = value == null ? undefined : String(value)

  return requiredEnvFrom(normalized, {
    name: `${modelId}.parameters.${key}`,
    type: 'string',
  })
}

function parseHeadersParameter(
  parameters: Record<string, unknown>,
  modelId: string,
): ChatModelHeaders | undefined {
  const headers = parameters.headers
  if (headers == null) {
    return undefined
  }

  if (typeof headers !== 'object' || Array.isArray(headers)) {
    throw new TypeError(`Invalid ${modelId}.parameters.headers: expected an object.`)
  }

  const normalized: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof value === 'string') {
      normalized[key] = value
      continue
    }

    if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
      normalized[key] = value
      continue
    }

    throw new Error(`Invalid ${modelId}.parameters.headers.${key}: expected string or string[].`)
  }

  return normalized
}

/**
 * Normalizes one configured chat model into runtime executor config.
 *
 * Use when:
 * - eval code needs typed provider constructor options from `context.model()`
 * - model parameters should be validated once with clear error messages
 *
 * Expects:
 * - `model.inferenceExecutorId` to be one of the supported executor ids
 * - required OpenAI fields (apiKey) to exist in `model.parameters`
 *
 * Returns:
 * - validated runtime config union for OpenAI or Ollama
 */
export function toChatModelRuntimeConfig(model: ModelDefinition): ChatModelRuntimeConfig {
  const parameters = getParameters(model)

  if (model.inferenceExecutorId === 'openai') {
    return {
      apiKey: parseRequiredStringParameter(parameters, 'apiKey', model.id),
      baseURL: parseOptionalStringParameter(parameters, 'baseURL', model.id),
      headers: parseHeadersParameter(parameters, model.id),
      inferenceExecutor: 'openai',
      model: model.model,
    }
  }

  if (model.inferenceExecutorId === 'ollama') {
    return {
      baseURL: parseOptionalStringParameter(parameters, 'baseURL', model.id),
      headers: parseHeadersParameter(parameters, model.id),
      inferenceExecutor: 'ollama',
      model: model.model,
    }
  }

  if (model.inferenceExecutorId === 'openrouter') {
    return {
      apiKey: parseRequiredStringParameter(parameters, 'apiKey', model.id),
      baseURL: parseOptionalStringParameter(parameters, 'baseURL', model.id),
      headers: parseHeadersParameter(parameters, model.id),
      inferenceExecutor: 'openrouter',
      model: model.model,
    }
  }

  throw new Error(`Unsupported chat inference executor "${model.inferenceExecutorId}" for model "${model.id}".`)
}

/**
 * Resolves OpenAI runtime config from one resolved run-context model.
 *
 * Use when:
 * - task execution already has `context.model()` output
 * - eval code wants typed OpenAI provider options with a concise helper name
 *
 * Expects:
 * - `model` to resolve to an OpenAI-backed chat model
 *
 * Returns:
 * - validated OpenAI runtime config
 */
export function openaiFromRunContext(model: ModelDefinition): OpenAIChatModelRuntimeConfig {
  const runtimeConfig = toChatModelRuntimeConfig(model)
  if (runtimeConfig.inferenceExecutor !== 'openai') {
    throw new Error(`Expected openai model, got "${runtimeConfig.inferenceExecutor}" for "${model.id}".`)
  }

  return runtimeConfig
}

/**
 * Resolves Ollama runtime config from one resolved run-context model.
 *
 * Use when:
 * - task execution already has `context.model()` output
 * - eval code wants typed Ollama provider options with a concise helper name
 *
 * Expects:
 * - `model` to resolve to an Ollama-backed chat model
 *
 * Returns:
 * - validated Ollama runtime config
 */
export function ollamaFromRunContext(model: ModelDefinition): OllamaChatModelRuntimeConfig {
  const runtimeConfig = toChatModelRuntimeConfig(model)
  if (runtimeConfig.inferenceExecutor !== 'ollama') {
    throw new Error(`Expected ollama model, got "${runtimeConfig.inferenceExecutor}" for "${model.id}".`)
  }

  return runtimeConfig
}

/**
 * Resolves OpenRouter runtime config from one resolved run-context model.
 *
 * Use when:
 * - task execution already has `context.model()` output
 * - eval code wants typed OpenRouter provider options with a concise helper name
 *
 * Expects:
 * - `model` to resolve to an OpenRouter-backed chat model
 *
 * Returns:
 * - validated OpenRouter runtime config
 */
export function openrouterFromRunContext(model: ModelDefinition): OpenRouterChatModelRuntimeConfig {
  const runtimeConfig = toChatModelRuntimeConfig(model)
  if (runtimeConfig.inferenceExecutor !== 'openrouter') {
    throw new Error(`Expected openrouter model, got "${runtimeConfig.inferenceExecutor}" for "${model.id}".`)
  }

  return runtimeConfig
}
