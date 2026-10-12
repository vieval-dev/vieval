import { fileURLToPath } from 'node:url'

/**
 * Absolute path of one committed fixture file under `fixtures/`.
 */
export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
}

/**
 * Model name of the current matrix row (`mock:model-a` or `mock:model-b`).
 */
export function modelOf(context: { task: { matrix: { run: Record<string, unknown> } } }): string {
  return String(context.task.matrix.run.model)
}

/**
 * Repeat number of the current matrix row (`1` or `2`).
 */
export function repeatOf(context: { task: { matrix: { run: Record<string, unknown> } } }): number {
  return Number(context.task.matrix.run.repeat)
}

/**
 * Deterministic number in `[0, 1)` derived from a string (FNV-1a hash).
 *
 * Use when:
 * - a case needs "random" values that stay the same between runs
 */
export function seeded(key: string): number {
  let hash = 0x811C9DC5
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0) / 0x1_0000_0000
}

const executionCounts = new Map<string, number>()

/**
 * Counts executions of one case in one task, starting at 0.
 *
 * Use when:
 * - a case should fail on its first executions and pass later (auto retry, auto attempt)
 *
 * Expects:
 * - `key` includes the task id, because every matrix row runs the same case names
 */
export function nextExecution(key: string): number {
  const count = executionCounts.get(key) ?? 0
  executionCounts.set(key, count + 1)
  return count
}
