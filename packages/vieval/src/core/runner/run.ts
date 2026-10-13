import type { TaskCacheRuntime } from '../cache'
import type { Scheduler } from '../scheduler/types'
import type { AggregatedRunResults, RunResult } from './aggregate'
import type { ScheduledTask } from './schedule'
import type { TaskExecutionContext } from './task-context'

import { errorMessageFrom } from '@moeru/std'

import { createScheduler } from '../scheduler/runtime'
import { aggregateRunResults } from './aggregate'

/**
 * Terminal task state reported by runner lifecycle hooks.
 *
 * Use when:
 * - reporting the outcome of one scheduled task to lifecycle observers
 *
 * Expects:
 * - hooks treat the value as final for the completed task
 */
export type RunnerTaskState = 'failed' | 'passed'

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
   * - executor code needs per-task models, cache, or other task-scoped data
   */
  createExecutionContext?: (task: ScheduledTask) => TaskExecutionContext
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
   * Scheduler that admits every task with `scope: 'task'`.
   *
   * Use when:
   * - tasks should run concurrently under task pools and scheduler middleware
   *
   * @default a scheduler with a task pool of `1`, so tasks run one after another in schedule order
   */
  scheduler?: Scheduler
  /**
   * Stops starting new tasks once aborted, for example when the run is interrupted.
   *
   * Expects:
   * - tasks that already started keep running; they observe the abort through their own execution context
   *
   * @default undefined
   */
  signal?: AbortSignal
}

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

/**
 * Executes runner tasks through a scheduler and aggregates the normalized results in schedule order.
 *
 * Call stack:
 *
 * {@link createRunnerSchedule}
 *   -> {@link runScheduledTasks}
 *     -> {@link Scheduler.run} (`scope: 'task'`)
 *       -> `executor(task)`
 *     -> {@link aggregateRunResults}
 *
 * Use when:
 * - the caller already expanded the runner matrix
 * - task execution should stay deterministic and easy to debug
 *
 * Expects:
 * - `executor` to return normalized `0..1` scores
 * - `options.scheduler` to own task concurrency; without it tasks run one after another
 * - `onTaskStart` / `onTaskEnd` hooks to be synchronous lifecycle observers
 *
 * Returns:
 * - aggregated results of the tasks that ran; tasks not started before `signal` aborted are left out
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

  // Tasks queued behind a failed task must not start: the caller already treats the whole run as failed.
  let failed = false

  async function executeScheduledTask(task: ScheduledTask): Promise<RunResult | undefined> {
    // An interrupted run finishes the tasks in flight but starts no new ones.
    if (options.signal?.aborted === true || failed) {
      return undefined
    }

    let executionContext: TaskExecutionContext

    try {
      executionContext = options.createExecutionContext?.(task) ?? createDefaultExecutionContext()
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

    let runResult: RunResult
    try {
      runResult = await executor(task, executionContext)
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

    return runResult
  }

  const scheduler = options.scheduler ?? createScheduler({ concurrency: { task: 1 } })
  const resultPairs = await Promise.all(tasks.map(async (task, index) => {
    const result = await scheduler.run({ scope: 'task', taskId: task.id }, async () => {
      try {
        return await executeScheduledTask(task)
      }
      catch (error) {
        failed = true
        throw error
      }
    })
    return { index, result }
  }))

  const sortedResults = resultPairs
    .sort((left, right) => left.index - right.index)
    .flatMap(item => item.result == null ? [] : [item.result])

  return aggregateRunResults(sortedResults)
}

function createDefaultExecutionContext(): TaskExecutionContext {
  const cache: TaskCacheRuntime = {
    namespace(name) {
      return {
        file(options) {
          const key = options.key.join('/')
          throw new Error(`Task cache runtime is not configured. Requested namespace "${name}" and key "${key}".`)
        },
      }
    },
  }

  return {
    cache,
    models: [],
  }
}

function createRunnerExecutionError(taskId: string, cause: unknown): RunnerExecutionError {
  if (cause instanceof RunnerExecutionError && cause.taskId === taskId) {
    return cause
  }

  return new RunnerExecutionError(taskId, cause)
}
