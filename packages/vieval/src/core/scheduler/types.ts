/**
 * Options accepted by {@link Scheduler.child} and `createScheduler`.
 */
export interface CreateSchedulerOptions {
  /**
   * Pools owned by this scheduler, keyed by the scope they count.
   *
   * A pool is shared only by work run through this scheduler or its children. Work also has to hold a slot in every
   * pool of every parent scheduler, so a child can only lower concurrency for its own work.
   *
   * @default {} (no pool of its own)
   */
  concurrency?: SchedulerConcurrencyConfig
  /**
   * Ids merged into the context of every unit run through this scheduler and its children.
   *
   * @default {}
   */
  context?: SchedulerBoundContext
  /**
   * Middleware wrapped around every unit run through this scheduler, after all of its slots are held.
   *
   * Listed from outermost to innermost. Middleware of a parent scheduler wraps middleware of its children.
   *
   * @default []
   */
  middleware?: SchedulerMiddleware[]
}

/**
 * Admission boundary for projects, tasks, and cases.
 *
 * Schedulers form a tree. The run owns the root, each project a child of it, each task a child of its project, and
 * each case group a child of its task. A unit run through any node needs a slot in the pool for its scope on that
 * node and on every parent node.
 */
export interface Scheduler {
  /**
   * Creates a scheduler whose pools are shared only by work run through it.
   *
   * Use when:
   * - one project, task, or case group needs its own pool or middleware below a broader scheduler
   *
   * Returns:
   * - a child that admits work through its own pools and middleware, then through every parent's
   */
  child: (options?: CreateSchedulerOptions) => Scheduler
  /**
   * Runs one unit of `context.scope` once it holds a slot in every pool on its path.
   *
   * Use when:
   * - a project, task, or case execution must respect the configured concurrency and middleware
   *
   * Expects:
   * - `context` carries the ids this scheduler does not bind already
   *
   * Returns:
   * - the result of `execute`; slots are acquired from the narrowest pool to the broadest, and released when the
   *   work and every `onRelease` hook settle
   */
  run: <T>(context: SchedulerRunContext, execute: () => Promise<T>) => Promise<T>
}

/**
 * Ids a scheduler binds for every unit run through it.
 */
export type SchedulerBoundContext = Omit<SchedulerScopeContext, 'scope'>

/**
 * Pool sizes keyed by the unit each pool counts.
 *
 * The scheduler that declares a value decides which work shares it: a value on the run scheduler bounds the whole
 * run, a value on a project scheduler bounds one project, and so on.
 */
export interface SchedulerConcurrencyConfig {
  /**
   * Most case executions running at once among the work sharing this pool.
   *
   * @default unlimited
   */
  case?: number
  /**
   * Most projects running at once among the work sharing this pool.
   *
   * @default unlimited
   */
  project?: number
  /**
   * Most scheduled tasks running at once among the work sharing this pool.
   *
   * @default unlimited
   */
  task?: number
}

/**
 * Middleware hooks wrapped around one admitted unit of work.
 *
 * Use when:
 * - recording admission telemetry
 * - holding or rejecting work dynamically, or attaching temporary resources around it
 *
 * Expects:
 * - implementations call `next()` exactly once to continue the pipeline; not calling it skips the work, and the
 *   scheduler rejects the run with a short-circuit error
 */
export interface SchedulerMiddleware {
  /**
   * Runs after every slot is held and before the work starts.
   */
  onAcquire?: (
    context: SchedulerScopeContext,
    next: () => Promise<void>,
  ) => Promise<void> | void
  /**
   * Runs after the work settles, in reverse order of `onAcquire`, before the slots are released.
   */
  onRelease?: (
    context: SchedulerScopeContext,
    next: () => Promise<void>,
  ) => Promise<void> | void
}

/**
 * Context passed to {@link Scheduler.run}; ids the scheduler already binds can be omitted.
 */
export type SchedulerRunContext = Pick<SchedulerScopeContext, 'scope'> & SchedulerBoundContext

/**
 * Units of work the scheduler admits, from broad to narrow.
 */
export type SchedulerScope = 'case' | 'project' | 'task'

/**
 * Context carried through admission, execution, and release of one unit.
 *
 * Ids are present when the scheduler path knows them: `vieval run` binds the workspace, experiment, project, and
 * task ids, and the DSL adds the case id and attempt index. Work run outside `vieval run` may have none.
 */
export interface SchedulerScopeContext {
  /**
   * Auto attempt index of the case execution, starting at `0`.
   */
  attemptIndex?: number
  /**
   * Case id within the task.
   */
  caseId?: string
  /**
   * Experiment id of the run. Metadata only; pools are never partitioned by it.
   */
  experimentId?: string
  /**
   * Project name.
   */
  projectName?: string
  /**
   * Unit being admitted.
   */
  scope: SchedulerScope
  /**
   * Scheduled task id.
   */
  taskId?: string
  /**
   * Workspace id of the run.
   */
  workspaceId?: string
}
