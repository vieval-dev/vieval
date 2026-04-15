import type { ModelDefinition } from '../../config/models'
import type { ConfigHookPlugin } from '../../config/plugin'

/**
 * Minimal inference-executor shape expected by chat model runtime callers.
 */
export interface ChatModelExecutorLike {
  chat: (model: string) => Record<string, unknown>
}

/**
 * Inference-executor input accepted by `chatModelFrom`.
 */
export type ChatModelExecutorInput = string | ChatModelExecutorLike

/**
 * Builder input for `chatModelFrom`.
 */
export interface ChatModelFromOptions {
  /**
   * Inference-executor id or inference-executor instance.
   */
  inferenceExecutor: ChatModelExecutorInput
  /**
   * Optional explicit inference-executor id for inference-executor instances.
   *
   * @default 'custom'
   */
  inferenceExecutorId?: string
  /**
   * Concrete model name.
   */
  model: string
  /**
   * Optional stable model id.
   *
   * @default `${inferenceExecutorId}:${model}`
   */
  id?: string
  /**
   * Alias names used by `resolveModelByName`.
   */
  aliases?: string[]
  /**
   * Optional model-level call parameters.
   */
  parameters?: Record<string, unknown>
}

/**
 * Chat-model specific specialization of the canonical `ModelDefinition`.
 */
export type ChatModelDefinition = Omit<ModelDefinition, 'inferenceExecutor'> & {
  inferenceExecutor: ChatModelExecutorInput
}

/**
 * Partial config shape needed by the chat models plugin.
 */
export interface PluginConfig {
  models?: ModelDefinition[]
}

/**
 * Plugin type bound to the minimal config shape used by model plugins.
 */
export type Plugin = ConfigHookPlugin<PluginConfig>

function normalizeInferenceExecutorId(
  inferenceExecutor: ChatModelExecutorInput,
  inferenceExecutorId: string | undefined,
): string {
  if (typeof inferenceExecutor === 'string') {
    return inferenceExecutor
  }

  return inferenceExecutorId ?? 'custom'
}

function createDefaultModelId(inferenceExecutorId: string, model: string): string {
  return `${inferenceExecutorId}:${model}`
}

/**
 * Builds one normalized chat model definition.
 *
 * Use when:
 * - registering chat models through config plugins
 * - a single model needs aliases for matrix selection or judge lookup
 */
export function chatModelFrom(options: ChatModelFromOptions): ChatModelDefinition {
  const inferenceExecutorId = normalizeInferenceExecutorId(options.inferenceExecutor, options.inferenceExecutorId)

  return {
    aliases: options.aliases ?? [],
    id: options.id ?? createDefaultModelId(inferenceExecutorId, options.model),
    inferenceExecutor: options.inferenceExecutor,
    inferenceExecutorId,
    model: options.model,
    parameters: options.parameters,
  }
}

/**
 * Options for the built-in `ChatModels` plugin.
 */
export interface ChatModelsPluginOptions {
  /**
   * Chat model definitions to append to config.
   */
  models: readonly ModelDefinition[]
}

/**
 * Built-in chat models plugin that contributes model definitions to vieval config.
 *
 * Use when:
 * - chat-model registration should stay in config-level plugin setup
 * - tasks and assertions resolve models by name or alias at runtime
 */
export function ChatModels(options: ChatModelsPluginOptions): Plugin {
  return {
    configVieval(config) {
      return {
        ...config,
        models: [
          ...(config.models ?? []),
          ...options.models,
        ],
      }
    },
    name: 'vieval:chat-models',
  }
}
