import type { ModelDefinition } from '../../config/models'
import type { TaskCacheRuntime } from '../cache'
import type { ScheduledTask } from './schedule'

/**
 * Inputs used to build task execution context.
 */
export interface CreateTaskExecutionContextOptions {
  cache?: TaskCacheRuntime
  models: readonly ModelDefinition[]
  task: ScheduledTask
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
   * Configured model registrations available to model plugins.
   */
  models: readonly ModelDefinition[]
}

/**
 * Creates task-scoped context data for runner execution.
 *
 * Call stack:
 *
 * {@link runScheduledTasks}
 *   -> {@link createTaskExecutionContext}
 *     -> `TaskExecutionContext`
 */
export function createTaskExecutionContext(options: CreateTaskExecutionContextOptions): TaskExecutionContext {
  return {
    cache: options.cache ?? createNoopTaskCacheRuntime(),
    models: options.models,
  }
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
