import type {
  CliReporter,
  CliReporterCaseEndPayload,
  CliReporterCaseStartPayload,
  CliReporterRunEndPayload,
  CliReporterRunStartPayload,
  CliReporterTaskEndPayload,
  CliReporterTaskQueuedPayload,
  CliReporterTaskStartPayload,
  CliReporterTaskState,
} from './types'

import c from 'tinyrainbow'

// NOTICE:
// Adapted from Vitest's SummaryReporter state-model and live summary layout.
// Source permalink: https://github.com/vitest-dev/vitest/blob/v4.1.1/packages/vitest/src/node/reporters/summary.ts
// Adaptation scope: keep the live active-row plus footer summary structure while replacing Vitest's module/test model with vieval's task/case lifecycle events.
// Changes: no direct WindowRenderer ownership in this task, explicit queued/running/finished task state machine, task/case counters, stable task sorting, and `getWindowRows()` for upcoming CLI wiring.

const POINTER = '❯'
const TREE_NODE_END = '└'
const TREE_NODE_MIDDLE = '├'

interface SummaryReporterCounterState {
  completed: number
  failed: number
  passed: number
  skipped: number
  total: number
}

/**
 * Additional task metadata accepted by the live summary reporter.
 *
 * Use when:
 * - queue events can provide richer task labels before CLI wiring is complete
 * - tests need to set deterministic display names and case totals
 *
 * Expects:
 * - all fields are optional and fall back to the base task identifier when absent
 *
 * Returns:
 * - metadata merged into queued task state
 */
export interface SummaryReporterTaskQueuedPayload extends CliReporterTaskQueuedPayload {
  /**
   * Stable display label shown in the active window.
   */
  displayName?: string
  /**
   * Project label rendered as a badge prefix.
   */
  projectName?: string
  /**
   * Total number of cases expected for the task.
   */
  totalCases?: number
}

/**
 * Additional case metadata accepted by the live summary reporter.
 *
 * Use when:
 * - a case start event needs a human-readable name for the slow-task window
 *
 * Expects:
 * - `caseName` is optional and falls back to `caseId`
 *
 * Returns:
 * - metadata stored for slow-row rendering while the case is active
 */
export interface SummaryReporterCaseStartPayload extends CliReporterCaseStartPayload {
  /**
   * Human-readable case label.
   */
  caseName?: string
}

/**
 * Input dependencies for the live summary reporter state machine.
 *
 * Use when:
 * - creating the live TTY summary reporter for CLI runs
 * - testing the state machine with deterministic clocks
 *
 * Expects:
 * - `getNow()` returns milliseconds from a monotonic or deterministic clock
 * - `getWallClockNow()` returns a wall-clock Unix timestamp suitable for `Date`
 * - `slowThresholdMs` is a non-negative duration
 *
 * Returns:
 * - configuration consumed by {@link createSummaryReporter}
 */
export interface SummaryReporterOptions {
  getColumns: () => number
  getNow: () => number
  getWallClockNow: () => number
  isTTY: boolean
  slowThresholdMs: number
  writeError: (value: string) => void
  writeOutput: (value: string) => void
}

/**
 * Row generation options for the live summary window.
 *
 * Use when:
 * - the upcoming WindowRenderer integration needs to cap visible rows
 *
 * Expects:
 * - `maxRows` counts every returned terminal row
 *
 * Returns:
 * - a bounded live summary window
 */
export interface SummaryReporterWindowRowsOptions {
  /**
   * Maximum number of rows to return.
   */
  maxRows?: number
}

/**
 * Reporter contract for live summary state plus window row generation.
 *
 * Use when:
 * - CLI code needs the reporter lifecycle plus `getWindowRows()`
 * - tests need to inspect the rendered terminal rows directly
 *
 * Expects:
 * - lifecycle calls follow the scheduled task execution order
 * - `getWindowRows()` is safe before, during, and after a run
 *
 * Returns:
 * - a `CliReporter`-compatible reporter with row generation helpers
 */
export interface SummaryReporter extends CliReporter {
  /**
   * Builds the current live summary window rows.
   */
  getWindowRows: (options?: SummaryReporterWindowRowsOptions) => string[]
  /**
   * Handles task queue events with additional display metadata.
   */
  onTaskQueued: (payload: SummaryReporterTaskQueuedPayload) => void
  /**
   * Handles case start events with additional display metadata.
   */
  onCaseStart: (payload: SummaryReporterCaseStartPayload) => void
}

interface ActiveCaseState {
  caseId: string
  caseName: string
  order: number
  startedAt: number
}

type SummaryTaskLifecycleState = 'queued' | 'running' | 'finished'

interface TaskRuntimeState {
  caseOrderCounter: number
  completedCases: number
  displayName: string
  projectName: string | undefined
  queueOrder: number
  runningCases: Map<string, ActiveCaseState>
  settledCaseIds: Set<string>
  startedAt: number | undefined
  state: SummaryTaskLifecycleState
  taskId: string
  taskResult: CliReporterTaskState | undefined
  totalCases: number
}

class SummaryReporterStateMachine implements SummaryReporter {
  private readonly options: SummaryReporterOptions
  private readonly taskCounters = createCounterState()
  private readonly caseCounters = createCounterState()
  private readonly tasks = new Map<string, TaskRuntimeState>()
  private queueOrderCounter = 0
  private startedAtMs = 0
  private startTime = ''

  constructor(options: SummaryReporterOptions) {
    this.options = options
  }

  /**
   * Handles run startup.
   *
   * Use when:
   * - a new CLI run is starting and the summary state must reset
   *
   * Expects:
   * - `totalTasks` matches the scheduled task count for the run
   *
   * Returns:
   * - no direct value
   */
  onRunStart(payload: CliReporterRunStartPayload): void {
    this.tasks.clear()
    this.queueOrderCounter = 0
    resetCounterState(this.taskCounters, payload.totalTasks)
    resetCounterState(this.caseCounters, 0)
    this.startedAtMs = this.options.getNow()
    this.startTime = formatTimeString(new Date(this.options.getWallClockNow()))
  }

  /**
   * Handles task queue events.
   *
   * Use when:
   * - a scheduled task becomes visible in the live summary before it starts
   *
   * Expects:
   * - `taskId` is stable across later lifecycle events
   *
   * Returns:
   * - no direct value
   */
  onTaskQueued(payload: SummaryReporterTaskQueuedPayload): void {
    const task = this.getOrCreateTaskState(payload.taskId)

    if (task.state === 'finished') {
      return
    }

    task.displayName = payload.displayName ?? task.displayName
    task.projectName = payload.projectName ?? task.projectName
    this.syncTaskTotalCases(task, payload.totalCases)
  }

  /**
   * Handles task start events.
   *
   * Use when:
   * - a queued task begins executing
   *
   * Expects:
   * - the task was previously queued or can be synthesized from its identifier
   *
   * Returns:
   * - no direct value
   */
  onTaskStart(payload: CliReporterTaskStartPayload): void {
    const task = this.getOrCreateTaskState(payload.taskId)

    if (task.state === 'finished') {
      return
    }

    task.state = 'running'
    task.startedAt ??= this.options.getNow()
  }

  /**
   * Handles case start events.
   *
   * Use when:
   * - a running task starts one case and slow-case tracking may begin
   *
   * Expects:
   * - `caseId` is stable for the lifetime of the running case
   *
   * Returns:
   * - no direct value
   */
  onCaseStart(payload: SummaryReporterCaseStartPayload): void {
    const task = this.getOrCreateTaskState(payload.taskId)

    if (task.state === 'finished') {
      return
    }

    task.state = 'running'
    task.startedAt ??= this.options.getNow()

    if (task.settledCaseIds.has(payload.caseId) || task.runningCases.has(payload.caseId)) {
      return
    }

    task.caseOrderCounter += 1
    task.runningCases.set(payload.caseId, {
      caseId: payload.caseId,
      caseName: payload.caseName ?? payload.caseId,
      order: task.caseOrderCounter,
      startedAt: this.options.getNow(),
    })

    this.syncTaskTotalCases(task)
  }

  /**
   * Handles case completion.
   *
   * Use when:
   * - a running case settles and counters must advance
   *
   * Expects:
   * - duplicate completion for the same `caseId` is ignored
   *
   * Returns:
   * - no direct value
   */
  onCaseEnd(payload: CliReporterCaseEndPayload): void {
    const task = this.getOrCreateTaskState(payload.taskId)

    if (task.state === 'finished') {
      return
    }

    if (task.settledCaseIds.has(payload.caseId)) {
      task.runningCases.delete(payload.caseId)
      return
    }

    task.settledCaseIds.add(payload.caseId)
    task.runningCases.delete(payload.caseId)
    task.completedCases += 1
    this.syncTaskTotalCases(task)
    this.caseCounters.completed += 1

    if (payload.state === 'passed') {
      this.caseCounters.passed += 1
      return
    }

    if (payload.state === 'failed') {
      this.caseCounters.failed += 1
      return
    }

    this.caseCounters.skipped += 1
  }

  /**
   * Handles task completion.
   *
   * Use when:
   * - a task leaves the active window and contributes to terminal totals
   *
   * Expects:
   * - duplicate task completion for the same task is ignored
   *
   * Returns:
   * - no direct value
   */
  onTaskEnd(payload: CliReporterTaskEndPayload): void {
    const task = this.getOrCreateTaskState(payload.taskId)

    if (task.state === 'finished') {
      return
    }

    this.syncTaskTotalCases(task)
    task.state = 'finished'
    task.taskResult = payload.state
    task.runningCases.clear()
    this.taskCounters.completed += 1

    if (payload.state === 'passed') {
      this.taskCounters.passed += 1
      return
    }

    if (payload.state === 'failed') {
      this.taskCounters.failed += 1
      return
    }

    this.taskCounters.skipped += 1
  }

  /**
   * Handles run completion.
   *
   * Use when:
   * - the caller has final task totals and wants the footer normalized
   *
   * Expects:
   * - payload counters are final terminal task totals
   *
   * Returns:
   * - no direct value
   */
  onRunEnd(payload: CliReporterRunEndPayload): void {
    this.taskCounters.total = payload.totalTasks
    this.taskCounters.passed = payload.passedTasks
    this.taskCounters.failed = payload.failedTasks
    this.taskCounters.skipped = payload.skippedTasks
    this.taskCounters.completed = payload.passedTasks + payload.failedTasks + payload.skippedTasks
  }

  /**
   * Releases reporter resources.
   *
   * Use when:
   * - CLI cleanup runs from a `finally` block
   *
   * Expects:
   * - repeated calls are safe
   *
   * Returns:
   * - no direct value
   */
  dispose(): void {}

  /**
   * Builds the current live summary window rows.
   *
   * Use when:
   * - the live reporter or tests need a snapshot of the active window
   *
   * Expects:
   * - `maxRows`, when present, keeps footer rows visible
   *
   * Returns:
   * - terminal rows in display order
   */
  getWindowRows(options?: SummaryReporterWindowRowsOptions): string[] {
    const activeRows = this.createActiveRows()
    const footerRows = this.createFooterRows()
    const maxRows = options?.maxRows
    const activeBlock = ['', ...activeRows, ...(activeRows.length > 0 ? [''] : [])]
    const footerBlock = [...footerRows, '']

    if (maxRows == null || maxRows <= 0) {
      return [...activeBlock, ...footerBlock]
    }

    if (maxRows <= footerBlock.length) {
      return footerBlock.slice(-maxRows)
    }

    const availableActiveRows = Math.max(0, maxRows - footerBlock.length)
    return [...activeBlock.slice(0, availableActiveRows), ...footerBlock]
  }

  private createActiveRows(): string[] {
    const activeTasks = Array
      .from(this.tasks.values())
      .filter(task => task.state !== 'finished')
      .sort(compareActiveTasks)

    const rows: string[] = []

    for (const task of activeTasks) {
      const suffix = task.state === 'queued'
        ? c.dim(' [queued]')
        : ` ${task.completedCases}/${task.totalCases}`
      const badge = formatProjectBadge(task.projectName, this.options.isTTY)
      rows.push(c.bold(c.yellow(` ${POINTER} `)) + badge + task.displayName + c.dim(suffix))

      const slowCases = Array
        .from(task.runningCases.values())
        .filter(activeCase => this.options.getNow() - activeCase.startedAt >= this.options.slowThresholdMs)
        .sort((left, right) => left.order - right.order)

      for (const [index, activeCase] of slowCases.entries()) {
        const icon = index === slowCases.length - 1 ? TREE_NODE_END : TREE_NODE_MIDDLE
        const elapsed = Math.max(0, this.options.getNow() - activeCase.startedAt)
        rows.push(
          c.bold(c.yellow(`   ${icon} `))
          + activeCase.caseName
          + c.bold(c.yellow(` ${formatDuration(elapsed)}`)),
        )
      }
    }

    return rows
  }

  private createFooterRows(): string[] {
    return [
      padSummaryTitle('Tasks') + formatCounterState(this.taskCounters),
      padSummaryTitle('Cases') + formatCounterState(this.caseCounters),
      padSummaryTitle('Start at') + this.startTime,
      padSummaryTitle('Duration') + formatDuration(Math.max(0, this.options.getNow() - this.startedAtMs)),
    ]
  }

  private getOrCreateTaskState(taskId: string): TaskRuntimeState {
    const existing = this.tasks.get(taskId)

    if (existing != null) {
      return existing
    }

    const created: TaskRuntimeState = {
      caseOrderCounter: 0,
      completedCases: 0,
      displayName: taskId,
      projectName: undefined,
      queueOrder: this.queueOrderCounter,
      runningCases: new Map(),
      settledCaseIds: new Set(),
      startedAt: undefined,
      state: 'queued',
      taskId,
      taskResult: undefined,
      totalCases: 0,
    }

    this.queueOrderCounter += 1
    this.tasks.set(taskId, created)
    return created
  }

  private syncTaskTotalCases(task: TaskRuntimeState, reportedTotalCases?: number): void {
    const observedTotalCases = task.completedCases + task.runningCases.size
    task.totalCases = Math.max(task.totalCases, reportedTotalCases ?? 0, observedTotalCases)
    this.caseCounters.total = sumTaskCaseTotals(this.tasks.values())
  }
}

/**
 * Creates the live summary reporter state machine for `vieval` CLI runs.
 *
 * Use when:
 * - the CLI wants Vitest-style active rows and live counters
 * - tests need a deterministic reporter surface without touching the terminal
 *
 * Expects:
 * - queue/start/end events describe task lifecycle in order
 * - `getNow()` remains monotonic within one run
 * - `getWallClockNow()` returns the wall-clock run start timestamp
 *
 * Returns:
 * - a reporter compatible with the base CLI lifecycle plus `getWindowRows()`
 *
 * Call stack:
 *
 * {@link createSummaryReporter}
 *   -> {@link SummaryReporterStateMachine.onTaskQueued}
 *   -> {@link SummaryReporterStateMachine.onCaseStart}
 *   -> {@link SummaryReporterStateMachine.getWindowRows}
 */
export function createSummaryReporter(options: SummaryReporterOptions): SummaryReporter {
  return new SummaryReporterStateMachine(options)
}

function createCounterState(): SummaryReporterCounterState {
  return {
    completed: 0,
    failed: 0,
    passed: 0,
    skipped: 0,
    total: 0,
  }
}

function resetCounterState(counter: SummaryReporterCounterState, total: number): void {
  counter.completed = 0
  counter.failed = 0
  counter.passed = 0
  counter.skipped = 0
  counter.total = total
}

function sumTaskCaseTotals(tasks: Iterable<TaskRuntimeState>): number {
  let total = 0

  for (const task of tasks) {
    total += task.totalCases
  }

  return total
}

function compareActiveTasks(left: TaskRuntimeState, right: TaskRuntimeState): number {
  const leftProject = left.projectName ?? ''
  const rightProject = right.projectName ?? ''

  if (leftProject !== rightProject) {
    return leftProject.localeCompare(rightProject)
  }

  const displayNameOrder = left.displayName.localeCompare(right.displayName)

  if (displayNameOrder !== 0) {
    return displayNameOrder
  }

  return left.queueOrder - right.queueOrder
}

function padSummaryTitle(label: string): string {
  return `${c.dim(label.padEnd(8))} `
}

function formatCounterState(counter: SummaryReporterCounterState): string {
  return [
    c.bold(c.green(`${counter.passed} passed`)),
    counter.failed > 0 ? c.bold(c.red(`${counter.failed} failed`)) : c.dim(`${counter.failed} failed`),
    counter.skipped > 0 ? c.yellow(`${counter.skipped} skipped`) : c.dim(`${counter.skipped} skipped`),
  ].join(c.dim(' | ')) + c.gray(` (${counter.total})`)
}

function formatTimeString(date: Date): string {
  return date.toTimeString().split(' ')[0] ?? ''
}

function formatDuration(durationMs: number): string {
  if (durationMs >= 1_000) {
    return `${(durationMs / 1_000).toFixed(2)}s`
  }

  return `${Math.round(durationMs)}ms`
}

function formatProjectBadge(projectName: string | undefined, isTTY: boolean): string {
  if (projectName == null || projectName.length === 0) {
    return ''
  }

  if (!isTTY || !c.isColorSupported) {
    return `|${projectName}| `
  }

  const backgroundPool = [c.bgYellow, c.bgCyan, c.bgGreen, c.bgMagenta] as const
  const seed = projectName
    .split('')
    .reduce((accumulator, character, index) => accumulator + character.charCodeAt(0) + index, 0)
  const background = backgroundPool[seed % backgroundPool.length]
  return `${c.black(background(` ${projectName} `))} `
}
