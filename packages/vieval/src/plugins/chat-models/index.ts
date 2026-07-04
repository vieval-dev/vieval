import type { MatrixDefinition, TaskExecutionPolicy } from '../../config'
import type { ModelDefinition } from '../../config/models'
import type { ConfigHookPlugin } from '../../config/plugin'
import type { TaskRunContext } from '../../config/types'
import type { EnvFromOptions, RequiredEnvFromOptions } from '../../core/inference-executors/env'

import process from 'node:process'

import { resolveModelByName } from '../../config/models'
import { envFrom, requiredEnvFrom } from '../../core/inference-executors/env'

/**
 * Chat-model specific specialization of the canonical `ModelDefinition`.
 */
export type ChatModelDefinition = Omit<ModelDefinition, 'inferenceExecutor'> & {
  inferenceExecutor: ChatModelExecutorInput
  provider?: string
  runtimeResolvers?: {
    apiKey?: ChatModelResolverValue<string>
    baseURL?: ChatModelResolverValue<string>
    headers?: ChatModelResolverValue<ChatModelHeaders>
  }
}

/**
 * Inference-executor input accepted by `chatModelFrom`.
 */
export type ChatModelExecutorInput = ChatModelExecutorLike | string

/**
 * Minimal inference-executor shape expected by chat model runtime callers.
 */
export interface ChatModelExecutorLike {
  chat: (model: string) => Record<string, unknown>
}

/**
 * Common builder input fields for `chatModelFrom`.
 */
export interface ChatModelFromBaseOptions {
  /**
   * Alias names used by `resolveModelByName`.
   */
  aliases?: string[]
  /**
   * Additional full task attempts allowed after the current attempt settles.
   *
   * @default 0
   */
  autoAttempt?: number
  /**
   * Additional retries allowed within the current attempt.
   *
   * @default 0
   */
  autoRetry?: number
  /**
   * Delay in milliseconds before a retry starts.
   *
   * @default retryIndex => 500 * 2 ** (retryIndex - 1)
   */
  autoRetryDelay?: TaskExecutionPolicy['autoRetryDelay']
  /**
   * Optional execution policy hints attached to this model.
   */
  executionPolicy?: TaskExecutionPolicy
  /**
   * Optional stable model id.
   *
   * @default `${inferenceExecutorId}:${model}`
   */
  id?: string
  /**
   * Inference-executor id or inference-executor instance.
   */
  inferenceExecutor?: ChatModelExecutorInput
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
   * Optional model-level call parameters.
   */
  parameters?: Record<string, unknown>
  /**
   * Provider id registered through `ChatProviders`.
   *
   * Use when:
   * - model runtime transport and credentials should be delegated to a named provider preset
   *
   * Expects:
   * - one `ChatProviders` plugin entry to expose the same id
   */
  provider?: string
  /**
   * Timeout in milliseconds for model-backed work.
   */
  timeout?: number
}

/**
 * Builder input for `chatModelFrom`.
 */
export type ChatModelFromOptions = ChatModelFromBaseOptions & ChatModelInferenceExecutor

/**
 * Chat-model header payload accepted by executor parameters.
 */
export type ChatModelHeaders = Record<string, string | string[]>

/**
 * Union of supported inference executor config shapes for `chatModelFrom`.
 */
export type ChatModelInferenceExecutor
  = GenericChatModelInferenceExecutor
    | OllamaChatModelInferenceExecutor
    | OpenAIChatModelInferenceExecutor
    | OpenRouterChatModelInferenceExecutor

/**
 * Runtime env context passed to model callback resolvers.
 */
export interface ChatModelResolverContext {
  env: Record<string, string>
}

/**
 * Value-or-callback resolver used by model runtime fields.
 */
export type ChatModelResolverValue<TValue> = ((config: ChatModelResolverContext) => Promise<TValue> | TValue) | TValue

/**
 * Options for the built-in `ChatModels` plugin.
 */
export interface ChatModelsPluginOptions {
  /**
   * Chat model definitions to append to config.
   */
  models: readonly ChatModelDefinition[]
}

/**
 * One provider definition consumed by chat model presets.
 */
export interface ChatProviderDefinition {
  /**
   * Stable provider id referenced by `chatModelFrom({ provider })`.
   */
  id: string
  /**
   * Inference-executor id or instance used by this provider preset.
   */
  inferenceExecutor: ChatModelExecutorInput
  /**
   * Optional explicit inference-executor id for inference-executor instances.
   *
   * @default 'custom'
   */
  inferenceExecutorId?: string
  /**
   * Optional provider parameters resolved via `envFrom`.
   *
   * Expects:
   * - map key is the provider parameter name
   * - map value is the env key name
   */
  optionalEnv?: OptionalProviderEnvMap
  /**
   * Optional literal provider-level parameters.
   */
  parameters?: Record<string, unknown>
  /**
   * Required provider parameters resolved via `requiredEnvFrom`.
   *
   * Expects:
   * - map key is the provider parameter name
   * - map value is the env key name
   */
  requiredEnv?: RequiredProviderEnvMap
}

/**
 * Builder input for `chatProviderFrom`.
 */
export interface ChatProviderFromOptions extends ChatProviderDefinition {
}

/**
 * Options for the built-in `ChatProviders` plugin.
 */
export interface ChatProvidersPluginOptions {
  /**
   * Optional explicit env source used for env-backed provider parameters.
   *
   * @default process.env
   */
  env?: NodeJS.ProcessEnv
  /**
   * Provider definitions to append to config.
   */
  providers: readonly ChatProviderDefinition[]
}

/**
 * Generic inference executor config shape.
 */
export interface GenericChatModelInferenceExecutor {
  inferenceExecutor?: ChatModelExecutorInput
}

/**
 * Matrix scope that can carry a chat model selector.
 */
export type MatrixModelScope = 'eval' | 'run'

/**
 * Options for resolving a chat model from a matrix axis.
 */
export interface ModelFromMatrixOptions {
  /**
   * Matrix axis whose selected value is a model id, model name, or alias.
   */
  axis: string
}

/**
 * Ollama-specific inference executor config shape.
 */
export interface OllamaChatModelInferenceExecutor {
  baseURL?: ChatModelResolverValue<string>
  headers?: ChatModelResolverValue<ChatModelHeaders>
  inferenceExecutor: 'ollama'
}

/**
 * OpenAI-specific inference executor config shape.
 */
export interface OpenAIChatModelInferenceExecutor {
  apiKey?: ChatModelResolverValue<string>
  baseURL?: ChatModelResolverValue<string>
  headers?: ChatModelResolverValue<ChatModelHeaders>
  inferenceExecutor: 'openai'
}

/**
 * OpenRouter-specific inference executor config shape.
 */
export interface OpenRouterChatModelInferenceExecutor {
  apiKey?: ChatModelResolverValue<string>
  baseURL?: ChatModelResolverValue<string>
  headers?: ChatModelResolverValue<ChatModelHeaders>
  inferenceExecutor: 'openrouter'
}

/**
 * Env-key map for optional provider parameters.
 *
 * Use when:
 * - provider parameter values should be read from env keys
 * - missing keys should resolve to `undefined`
 */
export type OptionalProviderEnvMap = Record<string, string>

/**
 * Plugin type bound to the minimal config shape used by model plugins.
 */
export type Plugin = ConfigHookPlugin<PluginConfig>

/**
 * Partial config shape needed by the chat models plugin.
 */
export interface PluginConfig {
  chatProviders?: ChatProviderDefinition[]
  env?: NodeJS.ProcessEnv
  models?: ModelDefinition[]
}

/**
 * Env-key map for required provider parameters.
 *
 * Use when:
 * - provider parameter values must exist before model execution
 * - missing keys should throw with key-aware error messages
 */
export type RequiredProviderEnvMap = Record<string, string>

type MatrixModelContext = Pick<TaskRunContext, 'models' | 'task'>

/**
 * Builds one normalized chat model definition.
 *
 * Use when:
 * - registering chat models through config plugins
 * - a single model needs aliases for matrix selection or judge lookup
 */
export function chatModelFrom(options: ChatModelFromOptions): ChatModelDefinition {
  const fallbackInferenceExecutor = options.inferenceExecutor ?? options.provider ?? 'custom'
  const inferenceExecutorId = normalizeInferenceExecutorId(fallbackInferenceExecutor, options.inferenceExecutorId)
  const runtimeResolvers = isOpenAIChatModelInferenceExecutor(options)
    ? {
        apiKey: options.apiKey,
        baseURL: options.baseURL,
        headers: options.headers,
      }
    : isOllamaChatModelInferenceExecutor(options)
      ? {
          baseURL: options.baseURL,
          headers: options.headers,
        }
      : isOpenRouterChatModelInferenceExecutor(options)
        ? {
            apiKey: options.apiKey,
            baseURL: options.baseURL,
            headers: options.headers,
          }
        : undefined

  return {
    aliases: options.aliases ?? [],
    executionPolicy: resolveModelExecutionPolicy(options),
    id: options.id ?? createDefaultModelId(inferenceExecutorId, options.model),
    inferenceExecutor: fallbackInferenceExecutor,
    inferenceExecutorId,
    model: options.model,
    parameters: options.parameters,
    provider: options.provider,
    runtimeResolvers,
  }
}

/**
 * Creates a run-matrix `model` axis from configured chat model names.
 *
 * Use when:
 * - run matrix should iterate over explicit chat model ids/aliases
 * - project configs want a concise model-axis helper
 *
 * Expects:
 * - each provided name to match a configured model id or alias at runtime
 *
 * Returns:
 * - matrix axis object compatible with `runMatrix.extend/override`
 */
export function chatModelMatrix(...names: string[]): MatrixDefinition {
  return {
    model: Array.from(new Set(names)),
  }
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
    async configVieval(config) {
      const resolvedModels = await Promise.all(options.models.map(async model => resolveChatModelDefinition(model, config)))

      return {
        ...config,
        models: [
          ...(config.models ?? []),
          ...resolvedModels,
        ],
      }
    },
    name: 'vieval:chat-models',
  }
}

/**
 * Builds one normalized chat provider definition.
 *
 * Use when:
 * - one provider preset should be reused across multiple chat models
 * - provider configuration should support required/optional env-backed parameters
 */
export function chatProviderFrom(options: ChatProviderFromOptions): ChatProviderDefinition {
  return {
    id: options.id,
    inferenceExecutor: options.inferenceExecutor,
    inferenceExecutorId: normalizeInferenceExecutorId(options.inferenceExecutor, options.inferenceExecutorId),
    optionalEnv: options.optionalEnv,
    parameters: options.parameters,
    requiredEnv: options.requiredEnv,
  }
}

/**
 * Built-in chat providers plugin that contributes provider presets to config.
 *
 * Use when:
 * - provider runtime config should be centralized and reusable
 * - provider parameters should be resolved from env via `envFrom`/`requiredEnvFrom`
 */
export function ChatProviders(options: ChatProvidersPluginOptions): Plugin {
  return {
    configVieval(config) {
      const env = config.env ?? options.env ?? process.env
      const normalizedProviders = options.providers.map(provider => normalizeChatProviderDefinition(provider, env))

      return {
        ...config,
        chatProviders: [
          ...(config.chatProviders ?? []),
          ...normalizedProviders,
        ],
      }
    },
    name: 'vieval:chat-providers',
  }
}

/**
 * Resolves a configured chat model from one eval-matrix axis.
 *
 * Use when:
 * - eval matrix selects a judge, rubric, or evaluator model
 * - callers want the scoped helper instead of passing `scope: 'eval'`
 *
 * Expects:
 * - `options.axis` to exist in `context.task.matrix.eval`
 *
 * Returns:
 * - the configured model matching the selected eval-matrix value
 */
export function modelFromEval(
  context: MatrixModelContext,
  options: ModelFromMatrixOptions,
): ModelDefinition {
  return modelFromMatrix(context, 'eval', options)
}

/**
 * Resolves a configured chat model from one scoped matrix axis.
 *
 * Use when:
 * - a matrix axis selects the agent, judge, or another chat model role
 * - eval code should keep model lookup semantics inside the chat-models plugin
 *
 * Expects:
 * - `scope` to identify `context.task.matrix.run` or `context.task.matrix.eval`
 * - `options.axis` to exist and contain a model id, model name, or alias
 *
 * Returns:
 * - the configured model matching the selected matrix value
 */
export function modelFromMatrix(
  context: MatrixModelContext,
  scope: MatrixModelScope,
  options: ModelFromMatrixOptions,
): ModelDefinition {
  const selectedModelName = context.task.matrix[scope][options.axis]

  if (selectedModelName == null) {
    throw new Error(`Missing ${scope} matrix axis "${options.axis}".`)
  }

  const model = resolveModelByName(context.models, selectedModelName)
  if (model == null) {
    throw new Error(`Unknown configured chat model "${selectedModelName}" from ${scope} matrix axis "${options.axis}".`)
  }

  return model
}

/**
 * Resolves a configured chat model from one run-matrix axis.
 *
 * Use when:
 * - run matrix selects the model used by the system under evaluation
 * - callers want the scoped helper instead of passing `scope: 'run'`
 *
 * Expects:
 * - `options.axis` to exist in `context.task.matrix.run`
 *
 * Returns:
 * - the configured model matching the selected run-matrix value
 */
export function modelFromRun(
  context: MatrixModelContext,
  options: ModelFromMatrixOptions,
): ModelDefinition {
  return modelFromMatrix(context, 'run', options)
}

function createDefaultModelId(inferenceExecutorId: string, model: string): string {
  return `${inferenceExecutorId}:${model}`
}

function createProviderMap(config: PluginConfig): Map<string, ChatProviderDefinition> {
  const providerMap = new Map<string, ChatProviderDefinition>()
  for (const provider of config.chatProviders ?? []) {
    providerMap.set(provider.id, provider)
  }

  return providerMap
}

function hasJudgeAlias(model: Pick<ChatModelFromBaseOptions, 'aliases' | 'id' | 'model'>): boolean {
  return [
    ...(model.aliases ?? []),
    ...(model.id == null ? [] : [model.id]),
    model.model,
  ].some(value => value.toLowerCase().includes('judge'))
}

function isOllamaChatModelInferenceExecutor(
  options: ChatModelFromOptions,
): options is ChatModelFromBaseOptions & OllamaChatModelInferenceExecutor {
  return options.inferenceExecutor === 'ollama'
}

function isOpenAIChatModelInferenceExecutor(
  options: ChatModelFromOptions,
): options is ChatModelFromBaseOptions & OpenAIChatModelInferenceExecutor {
  return options.inferenceExecutor === 'openai'
}

function isOpenRouterChatModelInferenceExecutor(
  options: ChatModelFromOptions,
): options is ChatModelFromBaseOptions & OpenRouterChatModelInferenceExecutor {
  return options.inferenceExecutor === 'openrouter'
}

function normalizeChatProviderDefinition(
  provider: ChatProviderDefinition,
  env: NodeJS.ProcessEnv,
): ChatProviderDefinition {
  return {
    id: provider.id,
    inferenceExecutor: provider.inferenceExecutor,
    inferenceExecutorId: normalizeInferenceExecutorId(provider.inferenceExecutor, provider.inferenceExecutorId),
    optionalEnv: provider.optionalEnv,
    parameters: resolveProviderParameters(provider, env),
    requiredEnv: provider.requiredEnv,
  }
}

function normalizeEnvRecord(env: NodeJS.ProcessEnv): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      normalized[key] = value
    }
  }

  return normalized
}

function normalizeExecutionPolicy(
  policy: TaskExecutionPolicy | undefined,
): TaskExecutionPolicy | undefined {
  if (policy == null) {
    return undefined
  }

  const normalized = {
    autoAttempt: policy.autoAttempt,
    autoRetry: policy.autoRetry,
    autoRetryDelay: policy.autoRetryDelay,
    timeout: policy.timeout,
  }

  return Object.values(normalized).some(value => value != null)
    ? normalized
    : undefined
}

function normalizeInferenceExecutorId(
  inferenceExecutor: ChatModelExecutorInput,
  inferenceExecutorId: string | undefined,
): string {
  if (typeof inferenceExecutor === 'string') {
    return inferenceExecutor
  }

  return inferenceExecutorId ?? 'custom'
}

async function resolveChatModelDefinition(
  model: ChatModelDefinition,
  config: PluginConfig,
): Promise<ChatModelDefinition> {
  const providerResolvedModel = resolveModelProvider(model, createProviderMap(config))
  const resolvedRuntimeParameters = await resolveModelRuntimeResolvers(providerResolvedModel, {
    env: normalizeEnvRecord(config.env ?? process.env),
  })

  if (resolvedRuntimeParameters == null) {
    return providerResolvedModel
  }

  return {
    ...providerResolvedModel,
    parameters: {
      ...providerResolvedModel.parameters,
      ...resolvedRuntimeParameters,
    },
  }
}

async function resolveChatModelResolverValue<TValue>(
  value: ChatModelResolverValue<TValue>,
  context: ChatModelResolverContext,
): Promise<TValue> {
  if (typeof value === 'function') {
    const resolver = value as (config: ChatModelResolverContext) => Promise<TValue> | TValue
    return await resolver(context)
  }

  return value
}

function resolveModelExecutionPolicy(options: ChatModelFromOptions): TaskExecutionPolicy | undefined {
  const explicitPolicy = normalizeExecutionPolicy({
    autoAttempt: options.autoAttempt ?? options.executionPolicy?.autoAttempt,
    autoRetry: options.autoRetry ?? options.executionPolicy?.autoRetry,
    autoRetryDelay: options.autoRetryDelay ?? options.executionPolicy?.autoRetryDelay,
    timeout: options.timeout ?? options.executionPolicy?.timeout,
  })

  if (explicitPolicy != null && Object.keys(explicitPolicy).length > 0) {
    return explicitPolicy
  }

  if (hasJudgeAlias(options)) {
    return {
      autoRetry: 3,
    }
  }

  return undefined
}

function resolveModelProvider(
  model: ChatModelDefinition,
  providerMap: ReadonlyMap<string, ChatProviderDefinition>,
): ChatModelDefinition {
  if (model.provider == null) {
    return model
  }

  const provider = providerMap.get(model.provider)
  if (provider == null) {
    throw new Error(`Unknown chat provider "${model.provider}" referenced by model "${model.id}".`)
  }

  return {
    ...model,
    inferenceExecutor: provider.inferenceExecutor,
    inferenceExecutorId: provider.inferenceExecutorId ?? normalizeInferenceExecutorId(provider.inferenceExecutor, provider.inferenceExecutorId),
    parameters: {
      ...provider.parameters,
      ...model.parameters,
    },
  }
}

async function resolveModelRuntimeResolvers(
  model: ChatModelDefinition,
  context: ChatModelResolverContext,
): Promise<Record<string, unknown> | undefined> {
  if (model.runtimeResolvers == null) {
    return undefined
  }

  const resolvedParameters: Record<string, unknown> = {}

  if (model.runtimeResolvers.apiKey != null) {
    const resolvedApiKey = await resolveChatModelResolverValue(model.runtimeResolvers.apiKey, context)
    resolvedParameters.apiKey = resolveRequiredStringValue(resolvedApiKey, `${model.id}.apiKey`)
  }

  if (model.runtimeResolvers.baseURL != null) {
    const resolvedBaseURL = await resolveChatModelResolverValue(model.runtimeResolvers.baseURL, context)
    const normalizedBaseURL = resolveOptionalStringValue(resolvedBaseURL, `${model.id}.baseURL`)
    if (normalizedBaseURL != null) {
      resolvedParameters.baseURL = normalizedBaseURL
    }
  }

  if (model.runtimeResolvers.headers != null) {
    const resolvedHeaders = await resolveChatModelResolverValue(model.runtimeResolvers.headers, context)
    resolvedParameters.headers = resolvedHeaders
  }

  return Object.keys(resolvedParameters).length > 0 ? resolvedParameters : undefined
}

function resolveOptionalEnvValue(
  env: NodeJS.ProcessEnv,
  envKey: string,
): string | undefined {
  const options: EnvFromOptions = {
    name: envKey,
    type: 'string',
  }

  return envFrom(env, options)
}

function resolveOptionalStringValue(value: string | undefined, name: string): string | undefined {
  return envFrom({ [name]: value }, {
    name,
    type: 'string',
  })
}

function resolveProviderParameters(
  provider: ChatProviderDefinition,
  env: NodeJS.ProcessEnv,
): Record<string, unknown> | undefined {
  const parameters: Record<string, unknown> = {
    ...provider.parameters,
  }

  for (const [parameterName, envKey] of Object.entries(provider.optionalEnv ?? {})) {
    const resolved = resolveOptionalEnvValue(env, envKey)
    if (resolved != null) {
      parameters[parameterName] = resolved
    }
  }

  for (const [parameterName, envKey] of Object.entries(provider.requiredEnv ?? {})) {
    parameters[parameterName] = resolveRequiredEnvValue(env, envKey)
  }

  return Object.keys(parameters).length > 0 ? parameters : undefined
}

function resolveRequiredEnvValue(
  env: NodeJS.ProcessEnv,
  envKey: string,
): string {
  const options: RequiredEnvFromOptions = {
    name: envKey,
    type: 'string',
  }

  return requiredEnvFrom(env, options)
}

function resolveRequiredStringValue(value: string | undefined, name: string): string {
  return requiredEnvFrom({ [name]: value }, {
    name,
    type: 'string',
  })
}

export * from './runtime-config'
export * from './telemetry'
