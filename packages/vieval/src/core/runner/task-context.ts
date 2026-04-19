import type { ModelDefinition } from '../../config/models'
import type { TaskCacheRuntime } from '../cache'
import type { ScheduledTask } from './schedule'

import { resolveModelByName } from '../../config/models'

/**
 * Options for selecting a model from the execution context.
 */
export interface TaskModelSelectionOptions {
  /**
   * Model id or alias name.
   */
  name: string
}

/**
 * Task-scoped execution context exposed to runner executors.
 */
export interface TaskExecutionContext {
  /**
   * Deterministic cache runtime scoped to the current task project.
   */
  cache: TaskCacheRuntime
  /**
   * Resolves model configuration for the current task.
   *
   * Use when:
   * - no arguments are provided to use the model selected by run matrix/inferenceExecutor
   * - `name` is provided to resolve a specific model id or alias
   */
  model: (
    selection?: string | TaskModelSelectionOptions,
  ) => ModelDefinition
}

/**
 * Inputs used to build task execution context.
 */
export interface CreateTaskExecutionContextOptions {
  cache?: TaskCacheRuntime
  models: readonly ModelDefinition[]
  task: ScheduledTask
}

function createNoopTaskCacheRuntime(): TaskCacheRuntime {
  return {
    namespace(name) {
      return {
        file(options) {
          const key = options.key.join('/')
          throw new Error(`Task cache runtime is not configured. Requested namespace "${name}" and key "${key}".`)
        },
      }
    },
  }
}

function resolveDefaultTaskModel(
  models: readonly ModelDefinition[],
  task: ScheduledTask,
): ModelDefinition {
  const runMatrixModelName = task.matrix.run.model
  if (runMatrixModelName != null) {
    const matrixSelectedModel = resolveModelByName(models, runMatrixModelName)
    if (matrixSelectedModel != null) {
      return matrixSelectedModel
    }

    throw new Error(`Unknown configured model "${runMatrixModelName}" from task.matrix.run.model.`)
  }

  const matched = resolveModelByName(models, task.inferenceExecutor.id)
  if (matched != null) {
    return matched
  }

  if (models.length > 1) {
    throw new Error(
      [
        `Multiple configured models are available, but no default model is selected for inferenceExecutor "${task.inferenceExecutor.id}".`,
        'Select one model explicitly by either:',
        '- setting runMatrix.override.model (or task matrix run.model)',
        '- setting project.inferenceExecutors to a matching model id',
        '- calling context.model({ name: "your-model-id-or-alias" })',
      ].join('\n'),
    )
  }

  if (models.length === 1) {
    const firstModel = models[0]
    if (firstModel != null) {
      return firstModel
    }
  }

  throw new Error(`No configured model found for inferenceExecutor id "${task.inferenceExecutor.id}".`)
}

/**
 * Creates task-scoped model resolver context for runner execution.
 *
 * Call stack:
 *
 * {@link runScheduledTasks}
 *   -> {@link createTaskExecutionContext}
 *     -> {@link resolveModelByName}
 *       -> `task.model()` / `task.model({ name })`
 */
export function createTaskExecutionContext(options: CreateTaskExecutionContextOptions): TaskExecutionContext {
  return {
    cache: options.cache ?? createNoopTaskCacheRuntime(),
    model(selection) {
      if (selection == null) {
        return resolveDefaultTaskModel(options.models, options.task)
      }

      const name = typeof selection === 'string' ? selection : selection.name

      const namedModel = resolveModelByName(options.models, name)
      if (namedModel == null) {
        throw new Error(`Unknown configured model "${name}".`)
      }

      return namedModel
    },
  }
}
