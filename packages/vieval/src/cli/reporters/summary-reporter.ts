import type {
  CliReporter,
  CliReporterCaseEndPayload,
  CliReporterCaseOutputPayload,
  CliReporterCaseStartPayload,
  CliReporterRunEndPayload,
  CliReporterRunStartPayload,
  CliReporterTaskEndPayload,
  CliReporterTaskQueuedPayload,
  CliReporterTaskStartPayload,
  CliReporterTaskState,
} from './types'

// NOTICE:
// Output line width must be measured per grapheme so CJK/emoji lines are cut to exactly one terminal row.
// `fast-string-width` is the enforced replacement for `string-width` in this repository.
import stringWidth from 'fast-string-width'
import c from 'tinyrainbow'

import { CASE_OUTPUT_VISIBLE_LINES, CaseOutputCollector, truncateToWidth } from './case-output'
import { formatHumanDuration } from './format-duration'

// NOTICE:
// Adapted from Vitest's SummaryReporter state-model and live summary layout.
// Source permalink: https://github.com/vitest-dev/vitest/blob/v4.1.1/packages/vitest/src/node/reporters/summary.ts
// Adaptation scope: keep the live active-row plus footer summary structure while replacing Vitest's module/test model with vieval's task/case lifecycle events.
// Changes: no direct WindowRenderer ownership in this task, explicit queued/running/finished task state machine, task/case counters, stable task sorting, and `getWindowRows()` for upcoming CLI wiring.

const POINTER = '❯'
/** Finished cases the throughput is measured over; enough to smooth single slow cases, small enough to follow a change of pace. */
const THROUGHPUT_WINDOW_CASES = 50
/** Finished cases needed before the time left is shown; fewer give an estimate that jumps around. */
const MIN_CASES_FOR_ESTIMATE = 3
const TREE_NODE_END = '└'
const TREE_NODE_LINE = '│'
const TREE_NODE_MIDDLE = '├'

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
   * Handles case start events with additional display metadata.
   */
  onCaseStart: (payload: SummaryReporterCaseStartPayload) => void
  /**
   * Handles task queue events with additional display metadata.
   */
  onTaskQueued: (payload: SummaryReporterTaskQueuedPayload) => void
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
  /**
   * Workspace of the task, when a comparison shows several workspaces in one window.
   */
  workspaceName?: string
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

interface ActiveCaseState {
  autoRetry: number | undefined
  caseId: string
  caseName: string
  order: number
  retryIndex: number | undefined
  startedAt: number
}

interface ActiveTaskView {
  slowCases: ActiveCaseState[]
  task: TaskRuntimeState
}

interface SummaryReporterCounterState {
  completed: number
  /** Cases that ended without a result because they threw something other than an assertion. */
  errored: number
  failed: number
  passed: number
  skipped: number
  timeout: number
  total: number
}

type SummaryTaskLifecycleState = 'finished' | 'queued' | 'running'

interface TaskRuntimeState {
  caseOrderCounter: number
  /** The case total came from `task.queued` (`TaskDefinition.caseNames`) or a started case, not only from observation. */
  caseTotalKnown: boolean
  completedCases: number
  displayName: string
  projectName: string | undefined
  queueOrder: number
  runningCases: Map<string, ActiveCaseState>
  settledCaseIds: Set<string>
  /** When the task's first case started; a task holding a task slot while it waits for a case slot has none. */
  startedAt: number | undefined
  state: SummaryTaskLifecycleState
  taskId: string
  taskResult: CliReporterTaskState | undefined
  totalCases: number
  workspaceName: string | undefined
}

class SummaryReporterStateMachine implements SummaryReporter {
  private readonly caseCounters = createCounterState()
  /** Finish times of the most recent cases, oldest first, for the throughput behind the time-left estimate. */
  private readonly caseEndTimes: number[] = []
  /**
   * Case output; finished blocks are held until the run ends so they do not scroll past the live window.
   */
  private caseOutput: CaseOutputCollector
  private readonly options: SummaryReporterOptions
  private queueOrderCounter = 0
  private startedAtMs = 0
  private startTime = ''
  private readonly taskCounters = createCounterState()
  private readonly tasks = new Map<string, TaskRuntimeState>()

  constructor(options: SummaryReporterOptions) {
    this.options = options
    this.caseOutput = this.createCaseOutput()
  }

  /**
   * Releases reporter resources.
   *
   * Use when:
   * - CLI cleanup runs from a `finally` block
   *
   * Expects:
   * - repeated calls are safe
   * - finished case output not printed yet (for example after an interrupted run) is printed here
   *
   * Returns:
   * - no direct value
   */
  dispose(): void {
    this.caseOutput.flush()
  }

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
    const footerRows = this.createFooterRows()
    const maxRows = options?.maxRows
    const footerBlock = [...footerRows, '']
    const now = this.options.getNow()
    const activeTasks = this.collectActiveTasks(now)
    const activeRows = this.createActiveRows(activeTasks, now, this.resolveOutputLinesPerCase(activeTasks, maxRows, footerBlock.length))

    if (maxRows == null || maxRows <= 0) {
      const activeBlock = ['', ...activeRows, ...(activeRows.length > 0 ? [''] : [])]
      return [...activeBlock, ...footerBlock]
    }

    if (maxRows <= footerBlock.length) {
      return footerBlock.slice(-maxRows)
    }

    const availableActiveRows = Math.max(0, maxRows - footerBlock.length)
    return [...createBoundedActiveBlock(activeRows, availableActiveRows), ...footerBlock]
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

    this.caseOutput.onCaseEnd(payload)
    if (task.settledCaseIds.has(payload.caseId)) {
      task.runningCases.delete(payload.caseId)
      return
    }

    task.settledCaseIds.add(payload.caseId)
    task.runningCases.delete(payload.caseId)
    task.completedCases += 1
    this.syncTaskTotalCases(task)
    this.caseCounters.completed += 1
    this.caseEndTimes.push(this.options.getNow())
    if (this.caseEndTimes.length > THROUGHPUT_WINDOW_CASES) {
      this.caseEndTimes.shift()
    }

    if (payload.state === 'passed') {
      this.caseCounters.passed += 1
      return
    }

    if (payload.state === 'failed') {
      this.caseCounters.failed += 1
      return
    }

    if (payload.state === 'timeout') {
      this.caseCounters.timeout += 1
      return
    }

    if (payload.state === 'errored') {
      this.caseCounters.errored += 1
      return
    }

    this.caseCounters.skipped += 1
  }

  /**
   * Handles process output written by a running case.
   *
   * Use when:
   * - case output should be shown as a live tail under the case row while the case runs
   * - the collapsed block of every finished case should be printed together once the run ends
   *
   * Expects:
   * - chunks arrive in write order
   *
   * Returns:
   * - no direct value
   */
  onCaseOutput(payload: CliReporterCaseOutputPayload): void {
    this.caseOutput.onCaseOutput(payload)
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

    this.caseOutput.onCaseStart(payload)
    task.state = 'running'
    task.startedAt ??= this.options.getNow()

    if (task.settledCaseIds.has(payload.caseId)) {
      return
    }

    const existingCase = task.runningCases.get(payload.caseId)
    if (existingCase != null) {
      existingCase.autoRetry = payload.autoRetry
      existingCase.caseName = payload.caseName ?? payload.caseId
      existingCase.retryIndex = payload.retryIndex
      return
    }

    task.caseOrderCounter += 1
    task.runningCases.set(payload.caseId, {
      autoRetry: payload.autoRetry,
      caseId: payload.caseId,
      caseName: payload.caseName ?? payload.caseId,
      order: task.caseOrderCounter,
      retryIndex: payload.retryIndex,
      startedAt: this.options.getNow(),
    })

    this.syncTaskTotalCases(task)
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
    this.caseOutput.flush()
    this.taskCounters.total = payload.totalTasks
    this.taskCounters.passed = payload.passedTasks
    this.taskCounters.failed = payload.failedTasks
    this.taskCounters.skipped = payload.skippedTasks
    this.taskCounters.completed = payload.passedTasks + payload.failedTasks + payload.skippedTasks
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
    this.caseOutput = this.createCaseOutput()
    this.queueOrderCounter = 0
    resetCounterState(this.taskCounters, payload.totalTasks)
    resetCounterState(this.caseCounters, 0)
    this.caseEndTimes.length = 0
    this.startedAtMs = this.options.getNow()
    this.startTime = formatTimeString(new Date(this.options.getWallClockNow()))
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
    this.caseOutput.onTaskEnd(task.taskId)
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
    task.workspaceName = payload.workspaceName ?? task.workspaceName
    this.caseOutput.onTaskQueued({ displayName: task.displayName, projectName: task.projectName, taskId: task.taskId })
    if (payload.totalCases != null) {
      task.caseTotalKnown = true
    }
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
  }

  /**
   * Collects unfinished tasks in display order with their cases past the slow threshold, once per frame.
   */
  private collectActiveTasks(now: number): ActiveTaskView[] {
    return Array
      .from(this.tasks.values())
      .filter(task => task.state !== 'finished')
      .sort(compareActiveTasks)
      .map(task => ({
        slowCases: Array
          .from(task.runningCases.values())
          .filter(activeCase => now - activeCase.startedAt >= this.options.slowThresholdMs)
          .sort((left, right) => left.order - right.order),
        task,
      }))
  }

  private createActiveRows(activeTasks: readonly ActiveTaskView[], now: number, outputLinesPerCase: number): string[] {
    const rows: string[] = []

    for (const { slowCases, task } of activeTasks) {
      const suffix = task.state === 'queued'
        ? c.dim(' [queued]')
        : task.startedAt == null
          ? c.dim(` 0/${formatTaskTotal(task)}, waiting for a case slot`)
          : formatTaskProgressSuffix(task, now)
      const badge = formatProjectBadge(task.workspaceName == null ? task.projectName : `${task.workspaceName}/${task.projectName ?? ''}`, this.options.isTTY)
      rows.push(c.bold(c.yellow(` ${POINTER} `)) + badge + task.displayName + c.dim(suffix))

      for (const [index, activeCase] of slowCases.entries()) {
        const isLastCase = index === slowCases.length - 1
        const icon = isLastCase ? TREE_NODE_END : TREE_NODE_MIDDLE
        const elapsed = Math.max(0, now - activeCase.startedAt)
        rows.push(
          c.bold(c.yellow(`   ${icon} `))
          + activeCase.caseName
          + formatRetrySuffix(activeCase)
          + c.bold(c.yellow(` ${formatDuration(elapsed)}`)),
        )

        if (outputLinesPerCase <= 0) {
          continue
        }

        // Live tail of the case output, like a running pnpm script: older lines stay hidden until the case ends.
        const outputPrefix = isLastCase ? '     ' : `   ${c.bold(c.yellow(TREE_NODE_LINE))} `
        const outputWidth = Math.max(1, this.options.getColumns() - stringWidth(outputPrefix) - 2)
        const lines = this.caseOutput.linesOf(task.taskId, activeCase.caseId)
        const hiddenCount = Math.max(0, lines.length - outputLinesPerCase)
        if (hiddenCount > 0) {
          rows.push(`${outputPrefix}${c.dim(`[${hiddenCount} lines collapsed]`)}`)
        }
        for (const line of lines.slice(-outputLinesPerCase)) {
          rows.push(`${outputPrefix}${c.magentaBright('│')} ${c.dim(truncateToWidth(line.text, outputWidth))}`)
        }
      }
    }

    return rows
  }

  private createCaseOutput(): CaseOutputCollector {
    return new CaseOutputCollector({
      collapse: true,
      colors: true,
      getNow: this.options.getNow,
      holdUntilFlush: true,
      write: this.options.writeOutput,
    })
  }

  private createFooterRows(): string[] {
    const now = this.options.getNow()
    const runElapsedDurationMs = Math.max(0, now - this.startedAtMs)
    const taskRunningCount = countRunningTasks(this.tasks.values())
    const caseRunningCount = countRunningCases(this.tasks.values())
    const totalsKnown = [...this.tasks.values()].every(task => task.caseTotalKnown || task.state === 'finished')
    const projects = summarizeGroups(this.tasks.values(), task => `${task.workspaceName ?? ''}/${task.projectName ?? ''}`)
    const workspaces = summarizeGroups(this.tasks.values(), task => task.workspaceName ?? '')

    return [
      ...(workspaces.total > 1
        ? [padSummaryTitle('Workspaces') + formatCounterState(workspaces, workspaces.running, true)]
        : []),
      ...(projects.total > 1
        ? [padSummaryTitle('Projects') + formatCounterState(projects, projects.running, true)]
        : []),
      // A comparison learns about tasks while its workspaces start, so the total is at least the tasks seen.
      padSummaryTitle('Tasks') + formatCounterState({ ...this.taskCounters, total: Math.max(this.taskCounters.total, this.tasks.size) }, taskRunningCount, true),
      padSummaryTitle('Cases') + formatCounterState(this.caseCounters, caseRunningCount, totalsKnown),
      padSummaryTitle('Concurrency') + formatActiveConcurrencyState({
        caseRunningCount,
        taskRunningCount,
      }),
      padSummaryTitle('Time') + formatRunTiming({
        elapsedDurationMs: runElapsedDurationMs,
        leftDurationMs: totalsKnown ? this.estimateCasesLeftMs(now) : undefined,
        startTime: this.startTime,
        wallClockNow: this.options.getWallClockNow(),
      }),
    ]
  }

  /**
   * Time until every planned case has finished, from the recent case throughput.
   *
   * Throughput is taken over the last {@link THROUGHPUT_WINDOW_CASES} finished cases rather than the whole run, so a slow
   * start (model warm-up, module loading) or a change of concurrency stops skewing the estimate once enough cases ended.
   */
  private estimateCasesLeftMs(now: number): number | undefined {
    const left = this.caseCounters.total - this.caseCounters.completed
    if (left <= 0) {
      return 0
    }
    if (this.caseEndTimes.length < MIN_CASES_FOR_ESTIMATE) {
      return undefined
    }

    // With a full window, measure from the oldest kept finish; before that, from the run start.
    const windowStart = this.caseEndTimes.length === THROUGHPUT_WINDOW_CASES ? this.caseEndTimes[0]! : this.startedAtMs
    const windowCases = this.caseEndTimes.length === THROUGHPUT_WINDOW_CASES ? this.caseEndTimes.length - 1 : this.caseEndTimes.length
    const windowMs = Math.max(1, now - windowStart)
    return Math.round((left * windowMs) / Math.max(1, windowCases))
  }

  private getOrCreateTaskState(taskId: string): TaskRuntimeState {
    const existing = this.tasks.get(taskId)

    if (existing != null) {
      return existing
    }

    const created: TaskRuntimeState = {
      caseOrderCounter: 0,
      caseTotalKnown: false,
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
      workspaceName: undefined,
    }

    this.queueOrderCounter += 1
    this.tasks.set(taskId, created)
    return created
  }

  /**
   * Splits the rows left over by task rows and the footer between running cases that have output.
   * Each case shows at most {@link CASE_OUTPUT_VISIBLE_LINES} lines plus one collapsed-count row.
   */
  private resolveOutputLinesPerCase(activeTasks: readonly ActiveTaskView[], maxRows: number | undefined, footerRowCount: number): number {
    const slowCaseRowCount = activeTasks.reduce((sum, { slowCases }) => sum + slowCases.length, 0)
    const casesWithOutput = activeTasks
      .flatMap(({ slowCases, task }) => slowCases.filter(activeCase => this.caseOutput.linesOf(task.taskId, activeCase.caseId).length > 0))
      .length

    if (casesWithOutput === 0) {
      return 0
    }
    if (maxRows == null || maxRows <= 0) {
      return CASE_OUTPUT_VISIBLE_LINES
    }

    // Task rows, slow case rows, and the leading and trailing spacer rows of the active block.
    const baseRowCount = activeTasks.length + slowCaseRowCount + 2
    const freeRows = maxRows - footerRowCount - baseRowCount
    return Math.min(CASE_OUTPUT_VISIBLE_LINES, Math.max(0, Math.floor(freeRows / casesWithOutput) - 1))
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

function countRunningCases(tasks: Iterable<TaskRuntimeState>): number {
  let runningCount = 0

  for (const task of tasks) {
    runningCount += task.runningCases.size
  }

  return runningCount
}

function countRunningTasks(tasks: Iterable<TaskRuntimeState>): number {
  let runningCount = 0

  for (const task of tasks) {
    if (task.state === 'running') {
      runningCount += 1
    }
  }

  return runningCount
}

/**
 * Creates the active task block while keeping room for summary footer rows.
 *
 * Use when:
 * - the live TTY window is smaller than the number of running task/case rows
 * - active rows need a visible truncation marker instead of silently disappearing
 *
 * Expects:
 * - `activeRows` contains already-formatted task and slow-case rows
 * - `maxRows` counts the leading spacer and truncation marker
 *
 * Returns:
 * - rows that fit inside `maxRows`
 * - a final hidden-row marker when active rows were omitted
 */
function createBoundedActiveBlock(activeRows: readonly string[], maxRows: number): string[] {
  if (maxRows <= 0) {
    return []
  }

  if (activeRows.length === 0) {
    return ['']
  }

  const fullBlock = ['', ...activeRows, '']

  if (fullBlock.length <= maxRows) {
    return fullBlock
  }

  if (maxRows === 1) {
    return ['']
  }

  const visibleActiveRows = Math.max(0, maxRows - 2)
  const hiddenRows = Math.max(0, activeRows.length - visibleActiveRows)

  return [
    '',
    ...activeRows.slice(0, visibleActiveRows),
    c.dim(`   ${TREE_NODE_END} ... ${hiddenRows} more running rows hidden`),
  ]
}

function createCounterState(): SummaryReporterCounterState {
  return {
    completed: 0,
    errored: 0,
    failed: 0,
    passed: 0,
    skipped: 0,
    timeout: 0,
    total: 0,
  }
}

/** Time left for one task from its own average case duration since its first case started. */
function estimateTaskLeftMs(task: TaskRuntimeState, now: number): number | undefined {
  if (task.startedAt == null || task.completedCases === 0 || !task.caseTotalKnown) {
    return undefined
  }

  const averageDurationMs = Math.max(0, now - task.startedAt) / task.completedCases
  return Math.round(averageDurationMs * Math.max(0, task.totalCases - task.completedCases))
}

function formatActiveConcurrencyState(options: {
  caseRunningCount: number
  taskRunningCount: number
}): string {
  return [
    options.taskRunningCount > 0
      ? c.bold(c.yellow(`${options.taskRunningCount} ${pluralize('task', options.taskRunningCount)} running`))
      : c.dim('0 tasks running'),
    options.caseRunningCount > 0
      ? c.bold(c.yellow(`${options.caseRunningCount} ${pluralize('case', options.caseRunningCount)} running`))
      : c.dim('0 cases running'),
  ].join(c.dim(' | '))
}

function formatCounterState(
  counter: SummaryReporterCounterState,
  runningCount: number,
  totalKnown: boolean,
): string {
  const plannedCount = Math.max(0, counter.total - counter.completed - runningCount)

  return [
    plannedCount > 0 ? c.bold(c.blue(`${plannedCount} planned`)) : c.dim(`${plannedCount} planned`),
    runningCount > 0 ? c.bold(c.yellow(`${runningCount} running`)) : c.dim(`${runningCount} running`),
    c.bold(c.green(`${counter.passed} passed`)),
    counter.failed > 0 ? c.bold(c.red(`${counter.failed} failed`)) : c.dim(`${counter.failed} failed`),
    // Only cases can error, so the task line leaves the count out until one does.
    ...(counter.errored > 0 ? [c.bold(c.yellow(`${counter.errored} errored`))] : []),
    counter.timeout > 0 ? c.bold(c.yellow(`${counter.timeout} timeout`)) : c.dim(`${counter.timeout} timeout`),
    counter.skipped > 0 ? c.yellow(`${counter.skipped} skipped`) : c.dim(`${counter.skipped} skipped`),
  ].join(c.dim(' | ')) + c.gray(` (${counter.total}${totalKnown ? '' : '+'})`)
}

function formatDuration(durationMs: number): string {
  return formatHumanDuration(durationMs)
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

function formatRetrySuffix(activeCase: ActiveCaseState): string {
  if (activeCase.retryIndex == null || activeCase.retryIndex <= 0 || activeCase.autoRetry == null || activeCase.autoRetry <= 0) {
    return ''
  }

  return c.dim(` retry ${activeCase.retryIndex}/${activeCase.autoRetry}`)
}

/**
 * Formats the run's one timing row: start, elapsed, and, once the estimate is known, time left and the end time.
 *
 * Before:
 * - `{ elapsed: 190_000, left: 100_000, start: '07:49:58', now: 07:53:08 }`
 * - `{ elapsed: 5_000, left: undefined, ... }`
 *
 * After:
 * - `started 07:49:58 · elapsed 3 minutes 10 seconds · ~1 minute 40 seconds left · ETA 07:54:48`
 * - `started 07:49:58 · elapsed 5 seconds · ~? left`
 */
function formatRunTiming(options: { elapsedDurationMs: number, leftDurationMs: number | undefined, startTime: string, wallClockNow: number }): string {
  const parts = [`started ${options.startTime}`, `elapsed ${formatHumanDuration(options.elapsedDurationMs)}`]
  if (options.leftDurationMs == null) {
    parts.push('~? left')
  }
  else {
    parts.push(`~${formatHumanDuration(options.leftDurationMs)} left`, `ETA ${formatTimeString(new Date(options.wallClockNow + options.leftDurationMs))}`)
  }
  return parts.join(c.dim(' · '))
}

function formatTaskProgressSuffix(task: TaskRuntimeState, now: number): string {
  const elapsedDurationMs = task.startedAt == null
    ? 0
    : Math.max(0, now - task.startedAt)
  const leftDurationMs = estimateTaskLeftMs(task, now)
  const timing = [`elapsed ${formatHumanDuration(elapsedDurationMs)}`, ...(leftDurationMs == null ? [] : [`~${formatHumanDuration(leftDurationMs)} left`])]

  return ` ${task.completedCases}/${formatTaskTotal(task)}, ${task.runningCases.size} ${pluralize('case', task.runningCases.size)} running (${timing.join(', ')})`
}

function formatTaskTotal(task: TaskRuntimeState): string {
  if (task.caseTotalKnown) {
    return String(task.totalCases)
  }
  // Only cases seen so far: more may come.
  return task.totalCases > 0 ? `${task.totalCases}+` : '?'
}

function formatTimeString(date: Date): string {
  return date.toTimeString().split(' ')[0] ?? ''
}

function padSummaryTitle(label: string): string {
  // Wide enough for the longest label ("Concurrency"), so every row starts its values in one column.
  return `${c.dim(label.padEnd(11))} `
}

function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`
}

function resetCounterState(counter: SummaryReporterCounterState, total: number): void {
  counter.completed = 0
  counter.errored = 0
  counter.failed = 0
  counter.passed = 0
  counter.skipped = 0
  counter.timeout = 0
  counter.total = total
}

/**
 * Counters of projects or workspaces derived from task states: a group runs while any of its tasks runs, and fails
 * when any of its tasks failed. Groups are named by `task.queued`, so one with no scheduled task is not counted.
 */
function summarizeGroups(tasks: Iterable<TaskRuntimeState>, groupOf: (task: TaskRuntimeState) => string): SummaryReporterCounterState & { running: number } {
  const byProject = Map.groupBy([...tasks], groupOf)
  const counter = { ...createCounterState(), running: 0, total: byProject.size }
  for (const projectTasks of byProject.values()) {
    if (projectTasks.some(task => task.state === 'running')) {
      counter.running += 1
      continue
    }
    if (!projectTasks.every(task => task.state === 'finished')) {
      continue
    }
    counter.completed += 1
    if (projectTasks.some(task => task.taskResult === 'failed')) {
      counter.failed += 1
    }
    else if (projectTasks.every(task => task.taskResult === 'skipped')) {
      counter.skipped += 1
    }
    else {
      counter.passed += 1
    }
  }
  return counter
}

function sumTaskCaseTotals(tasks: Iterable<TaskRuntimeState>): number {
  let total = 0

  for (const task of tasks) {
    total += task.totalCases
  }

  return total
}
