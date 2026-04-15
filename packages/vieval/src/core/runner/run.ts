import type { AggregatedRunResults, RunResult } from './aggregate'
import type { ScheduledTask } from './schedule'
import type { TaskExecutionContext } from './task-context'

import { errorMessageFrom } from '@moeru/std'

import { aggregateRunResults } from './aggregate'

/**
 * Executes one scheduled runner task and returns a normalized run result.
 *
 * Use when:
 * - a scheduler already selected the task and execution context
 * - the caller wants a typed executor contract for runner workers
 *
 * Expects:
 * - the task context to be ready for model resolution and task-scoped work
 *
 * Returns:
 * - a normalized run result with score entries ready for aggregation
 */
export type ScheduledTaskExecutor = (
  task: ScheduledTask,
  context: TaskExecutionContext,
) => Promise<RunResult>

/**
 * Terminal task state reported by runner lifecycle hooks.
 *
 * Use when:
 * - reporting the outcome of one scheduled task to lifecycle observers
 *
 * Expects:
 * - hooks treat the value as final for the completed task
 */
export type RunnerTaskState = 'passed' | 'failed'

/**
 * Optional runner execution hooks used while processing scheduled tasks.
 *
 * Use when:
 * - callers want lifecycle visibility around sequential task execution
 * - task execution should remain deterministic while still observable
 *
 * Expects:
 * - hook functions are synchronous lifecycle observers
 */
export interface RunScheduledTasksOptions {
  /**
   * Creates per-task execution context.
   *
   * Use when:
   * - executor code needs per-task model resolution or other task-scoped data
   */
  createExecutionContext?: (task: ScheduledTask) => TaskExecutionContext
  /**
   * Runs before the executor starts handling a task.
   *
   * Use when:
   * - callers want to observe task activation before execution begins
   *
   * Expects:
   * - thrown errors abort the task before executor work starts
   */
  onTaskStart?: (task: ScheduledTask) => void
  /**
   * Runs after the executor settles for a task.
   *
   * Use when:
   * - callers want to observe successful and failed task completion
   *
   * Expects:
   * - thrown errors abort successful runs
   * - failed-task observers do not override the executor error for the task
   */
  onTaskEnd?: (task: ScheduledTask, state: RunnerTaskState) => void
}

function createDefaultExecutionContext(task: ScheduledTask): TaskExecutionContext {
  return {
    model(options) {
      const requestedModelName = typeof options === 'string' ? options : options?.name
      if (requestedModelName != null) {
        throw new Error(`No model registry configured. Requested model: ${requestedModelName}`)
      }

      throw new Error(`No model registry configured for task inferenceExecutor id "${task.inferenceExecutor.id}".`)
    },
  }
}

/**
 * Error thrown when a scheduled run fails before producing a normalized result.
 */
export class RunnerExecutionError extends Error {
  /**
   * Stable task id that failed.
   */
  taskId: string

  constructor(taskId: string, cause: unknown) {
    const message = errorMessageFrom(cause) ?? 'Unknown runner execution failure.'
    super(`Runner task "${taskId}" failed: ${message}`)
    this.name = 'RunnerExecutionError'
    this.taskId = taskId
    this.cause = cause
  }
}

function createRunnerExecutionError(taskId: string, cause: unknown): RunnerExecutionError {
  if (cause instanceof RunnerExecutionError && cause.taskId === taskId) {
    return cause
  }

  return new RunnerExecutionError(taskId, cause)
}

/**
 * Executes runner tasks sequentially and aggregates the normalized results.
 *
 * Call stack:
 *
 * {@link createRunnerSchedule}
 *   -> {@link runScheduledTasks}
 *     -> `executor(task)`
 *       -> {@link aggregateRunResults}
 *
 * Use when:
 * - the caller already expanded the runner matrix
 * - task execution should stay deterministic and easy to debug
 *
 * Expects:
 * - `executor` to return normalized `0..1` scores
 * - callers to handle concurrency outside this helper when needed
 * - `onTaskStart` / `onTaskEnd` hooks to be synchronous lifecycle observers
 *
 * Throws:
 * - `RunnerExecutionError` when task setup, hooks, or the executor throws
 */
export async function runScheduledTasks(
  tasks: readonly ScheduledTask[],
  executor: ScheduledTaskExecutor,
  options: RunScheduledTasksOptions = {},
): Promise<AggregatedRunResults> {
  if (tasks.length === 0) {
    return aggregateRunResults([])
  }

  const results: RunResult[] = []

  for (const task of tasks) {
    let executionContext: TaskExecutionContext

    try {
      executionContext = options.createExecutionContext?.(task) ?? createDefaultExecutionContext(task)
    }
    catch (error) {
      throw createRunnerExecutionError(task.id, error)
    }

    try {
      options.onTaskStart?.(task)
    }
    catch (error) {
      throw createRunnerExecutionError(task.id, error)
    }

    try {
      results.push(await executor(task, executionContext))
    }
    catch (error) {
      try {
        options.onTaskEnd?.(task, 'failed')
      }
      catch {
        // Failed-task observers must not mask the task execution failure.
      }
      throw createRunnerExecutionError(task.id, error)
    }

    try {
      options.onTaskEnd?.(task, 'passed')
    }
    catch (error) {
      throw createRunnerExecutionError(task.id, error)
    }
  }

  return aggregateRunResults(results)
}
