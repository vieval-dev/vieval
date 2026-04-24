import { newQueue } from '@henrygd/queue'

/**
 * Minimal async queue adapter used by the scheduler runtime.
 *
 * Use when:
 * - a scheduler scope needs a concurrency cap
 * - queued work should be delegated through `@henrygd/queue`
 *
 * Expects:
 * - `concurrency` is a positive integer
 *
 * Returns:
 * - a small wrapper with a `run` method for queued work
 */
export interface SchedulerQueue {
  run: <T>(execute: () => Promise<T>) => Promise<T>
}

/**
 * Creates a scheduler queue backed by `@henrygd/queue`.
 *
 * Before:
 * - `2`
 *
 * After:
 * - `SchedulerQueue { run() }`
 */
export function createSchedulerQueue(concurrency: number): SchedulerQueue {
  const queue = newQueue(concurrency)

  return {
    run<T>(execute: () => Promise<T>) {
      return queue.add(execute)
    },
  }
}
