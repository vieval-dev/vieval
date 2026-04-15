import type { ModelDefinition } from '../../config/models'
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
  models: readonly ModelDefinition[]
  task: ScheduledTask
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

  if (models.length > 0) {
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
