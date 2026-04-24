/**
 * Hierarchical scheduler scopes used by the queue runtime.
 *
 * Use when:
 * - selecting which concurrency cap applies to a unit of work
 * - ordering middleware acquisition and release hooks
 *
 * Expects:
 * - values move from broad to narrow scope in this order:
 *   `workspace -> project -> task -> attempt -> case`
 *
 * Returns:
 * - a string literal scope identifier
 */
export type SchedulerScope = 'workspace' | 'project' | 'task' | 'attempt' | 'case'

/**
 * Context carried through queue acquisition, execution, and release.
 *
 * Use when:
 * - middleware needs stable identifiers for logging or instrumentation
 * - runtime helpers need to know which hierarchical scope is being executed
 *
 * Expects:
 * - `workspaceId` and `experimentId` are always present
 * - narrower ids are only provided when the selected scope requires them
 *
 * Returns:
 * - a serializable scope context object
 */
export interface SchedulerScopeContext {
  scope: SchedulerScope
  workspaceId: string
  experimentId: string
  projectName?: string
  taskId?: string
  attemptIndex?: number
  caseId?: string
}

/**
 * Middleware hooks wrapped around scheduler execution.
 *
 * Use when:
 * - recording queue lifecycle telemetry
 * - attaching tracing or temporary resources around queued work
 *
 * Expects:
 * - implementations call `next()` exactly once to continue the pipeline
 *
 * Returns:
 * - optional async acquire and release hooks
 */
export interface SchedulerMiddleware {
  onAcquire?: (
    context: SchedulerScopeContext,
    next: () => Promise<void>,
  ) => Promise<void> | void
  onRelease?: (
    context: SchedulerScopeContext,
    next: () => Promise<void>,
  ) => Promise<void> | void
}

/**
 * Per-scope concurrency limits used by the scheduler runtime.
 *
 * Use when:
 * - bounding parallel work for a specific scope
 * - disabling a scope cap by omitting its entry
 *
 * Expects:
 * - values are positive integers when provided
 *
 * Returns:
 * - a partial map of scheduler scope to concurrency cap
 */
export interface SchedulerConcurrencyConfig {
  workspace?: number
  project?: number
  task?: number
  attempt?: number
  case?: number
}

/**
 * Options accepted by {@link createSchedulerRuntime}.
 *
 * Use when:
 * - constructing a scheduler runtime with queue limits or middleware
 *
 * Expects:
 * - omitted configuration falls back to unbounded execution for that concern
 *
 * Returns:
 * - queue and middleware configuration for the runtime
 */
export interface CreateSchedulerRuntimeOptions {
  concurrency?: SchedulerConcurrencyConfig
  middleware?: SchedulerMiddleware[]
}

/**
 * Runtime API used to execute case-level work through scheduler policies.
 *
 * Use when:
 * - the runner needs to enqueue case execution under middleware and queue caps
 *
 * Expects:
 * - `runCase` receives a case context and a callback that performs the work
 *
 * Returns:
 * - a promise that resolves with the callback result once all guards release
 */
export interface SchedulerRuntime {
  runCase: <T>(
    context: SchedulerScopeContext,
    execute: () => Promise<T>,
  ) => Promise<T>
}
