/**
 * Allowed lifecycle outcomes for one task case.
 *
 * Use when:
 * - reporting case completion state
 * - aggregating task progress into a final summary
 *
 * Expects:
 * - reporters treat the values as terminal case results
 */
export type CliReporterCaseState = 'passed' | 'failed' | 'skipped'

/**
 * Allowed lifecycle outcomes for one task.
 *
 * Use when:
 * - reporting task completion state
 * - aggregating task execution into a terminal summary
 *
 * Expects:
 * - reporters treat the values as terminal task results
 */
export type CliReporterTaskState = 'passed' | 'failed' | 'skipped'

/**
 * Payload emitted when a run begins.
 *
 * Use when:
 * - initializing reporter state before any task is queued
 *
 * Expects:
 * - `totalTasks` reflects the number of scheduled tasks known at start time
 */
export interface CliReporterRunStartPayload {
  /**
   * Total number of tasks included in the run.
   */
  totalTasks: number
}

/**
 * Payload emitted when a task is queued for execution.
 *
 * Use when:
 * - tracking discovered tasks before execution starts
 *
 * Expects:
 * - `taskId` uniquely identifies the scheduled task
 */
export interface CliReporterTaskQueuedPayload {
  /**
   * Stable task identifier.
   */
  taskId: string
}

/**
 * Payload emitted when a task starts executing.
 *
 * Use when:
 * - switching a task row from queued to active state
 *
 * Expects:
 * - `taskId` matches a previously queued task
 */
export interface CliReporterTaskStartPayload {
  /**
   * Stable task identifier.
   */
  taskId: string
}

/**
 * Payload emitted when a case starts executing.
 *
 * Use when:
 * - showing fine-grained progress within a task
 *
 * Expects:
 * - `taskId` matches the owning task
 * - `caseId` uniquely identifies the case within the task
 */
export interface CliReporterCaseStartPayload {
  /**
   * Stable task identifier.
   */
  taskId: string
  /**
   * Stable case identifier within the task.
   */
  caseId: string
}

/**
 * Payload emitted when a case finishes executing.
 *
 * Use when:
 * - updating in-flight counters and case completion state
 *
 * Expects:
 * - `taskId` matches the owning task
 * - `caseId` matches the started case
 * - `state` is the terminal case result
 */
export interface CliReporterCaseEndPayload {
  /**
   * Stable task identifier.
   */
  taskId: string
  /**
   * Stable case identifier within the task.
   */
  caseId: string
  /**
   * Terminal outcome for the case.
   */
  state: CliReporterCaseState
  /**
   * Optional failure message when `state` is `failed`.
   */
  errorMessage?: string
}

/**
 * Payload emitted when a task finishes executing.
 *
 * Use when:
 * - moving a task from active state into a terminal state
 *
 * Expects:
 * - `taskId` matches the started task
 * - `state` is the terminal task result
 */
export interface CliReporterTaskEndPayload {
  /**
   * Stable task identifier.
   */
  taskId: string
  /**
   * Terminal outcome for the task.
   */
  state: CliReporterTaskState
}

/**
 * Payload emitted when the overall run finishes.
 *
 * Use when:
 * - rendering final totals after all tasks settle
 *
 * Expects:
 * - counters represent the final terminal totals for the run
 */
export interface CliReporterRunEndPayload {
  /**
   * Total number of tasks included in the run.
   */
  totalTasks: number
  /**
   * Total number of passed tasks.
   */
  passedTasks: number
  /**
   * Total number of failed tasks.
   */
  failedTasks: number
  /**
   * Total number of skipped tasks.
   */
  skippedTasks: number
}

/**
 * Reporter lifecycle contract for `vieval` CLI output.
 *
 * Use when:
 * - wiring live or no-op reporting into CLI execution
 * - testing reporter orchestration without touching terminal state
 *
 * Expects:
 * - lifecycle methods are called in run order
 * - `dispose()` is safe to call more than once
 */
export interface CliReporter {
  /**
   * Handles run startup.
   */
  onRunStart: (payload: CliReporterRunStartPayload) => void
  /**
   * Handles task queueing.
   */
  onTaskQueued: (payload: CliReporterTaskQueuedPayload) => void
  /**
   * Handles task start.
   */
  onTaskStart: (payload: CliReporterTaskStartPayload) => void
  /**
   * Handles case start.
   */
  onCaseStart: (payload: CliReporterCaseStartPayload) => void
  /**
   * Handles case completion.
   */
  onCaseEnd: (payload: CliReporterCaseEndPayload) => void
  /**
   * Handles task completion.
   */
  onTaskEnd: (payload: CliReporterTaskEndPayload) => void
  /**
   * Handles run completion.
   */
  onRunEnd: (payload: CliReporterRunEndPayload) => void
  /**
   * Releases any reporter resources.
   */
  dispose: () => void
}
