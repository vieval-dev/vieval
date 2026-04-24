import type { TaskExecutionPolicy } from './types'

/**
 * Canonical model definition consumed by vieval runtime and config.
 *
 * Use when:
 * - declaring models in `vieval.config.*`
 * - resolving task runtime models by id, alias, or concrete model name
 *
 * Expects:
 * - `id` to be stable and unique within one config
 * - `inferenceExecutorId` to match scheduler/executor identifiers
 *
 * Returns:
 * - one normalized model registration record
 */
export interface ModelDefinition {
  /**
   * Stable model id.
   */
  id: string
  /**
   * Inference-executor id used for matching and reporting.
   */
  inferenceExecutorId: string
  /**
   * Executor reference passed through config.
   *
   * `vieval` core treats this as opaque runtime metadata. Builder plugins can
   * narrow this field with plugin-specific executor input types.
   */
  inferenceExecutor: unknown
  /**
   * Concrete model name passed to the inference executor.
   */
  model: string
  /**
   * Alias names that can resolve this model.
   */
  aliases: string[]
  /**
   * Optional execution policy hints attached to this model.
   */
  executionPolicy?: TaskExecutionPolicy
  /**
   * Optional model-level call parameters.
   */
  parameters?: Record<string, unknown>
}

/**
 * Resolves one model by id, model name, or alias in registration order.
 *
 * Returns:
 * - the first matching model, or `undefined` when no match exists
 */
export function resolveModelByName(
  models: readonly ModelDefinition[],
  name: string,
): ModelDefinition | undefined {
  return models.find(model => model.id === name || model.model === name || model.aliases.includes(name))
}
