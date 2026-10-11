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

import { CASE_OUTPUT_VISIBLE_LINES, CaseOutputLines, formatCaseOutputBlock, truncateToWidth } from './case-output'
import { formatHumanDuration } from './format-duration'

// NOTICE:
// Adapted from Vitest's SummaryReporter state-model and live summary layout.
// Source permalink: https://github.com/vitest-dev/vitest/blob/v4.1.1/packages/vitest/src/node/reporters/summary.ts
// Adaptation scope: keep the live active-row plus footer summary structure while replacing Vitest's module/test model with vieval's task/case lifecycle events.
// Changes: no direct WindowRenderer ownership in this task, explicit queued/running/finished task state machine, task/case counters, stable task sorting, and `getWindowRows()` for upcoming CLI wiring.

const POINTER = '❯'
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
  output: CaseOutputLines
  retryIndex: number | undefined
  startedAt: number
}

interface FinishedCaseBlock {
  caseOrder: number
  taskOrder: number
  text: string
}

interface ProgressTimingState {
  elapsedDurationMs: number
  estimatedDurationMs?: number
}

interface SummaryReporterCounterState {
  completed: number
  failed: number
  passed: number
  skipped: number
  timeout: number
  total: number
}

type SummaryTaskLifecycleState = 'finished' | 'queued' | 'running'

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
  private readonly caseCounters = createCounterState()
  /**
   * Output blocks of finished cases, held back until the run ends so they do not scroll past the live window.
   */
  private finishedBlocks: FinishedCaseBlock[] = []
  private readonly options: SummaryReporterOptions
  private queueOrderCounter = 0
  private startedAtMs = 0
  private startTime = ''
  private readonly taskCounters = createCounterState()
  private readonly tasks = new Map<string, TaskRuntimeState>()

  constructor(options: SummaryReporterOptions) {
    this.options = options
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
    this.printFinishedBlocks()
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
    const activeRows = this.createActiveRows(this.resolveOutputLinesPerCase(maxRows, footerBlock.length))

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

    if (task.settledCaseIds.has(payload.caseId)) {
      task.runningCases.delete(payload.caseId)
      return
    }

    task.settledCaseIds.add(payload.caseId)
    const endedCase = task.runningCases.get(payload.caseId)
    if (endedCase != null) {
      this.holdCaseOutputBlock(task, endedCase, payload.state, payload.errorMessage)
    }
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

    if (payload.state === 'timeout') {
      this.caseCounters.timeout += 1
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
    const task = this.getOrCreateTaskState(payload.taskId)
    const activeCase = task.runningCases.get(payload.caseId)

    if (activeCase != null) {
      activeCase.output.append(payload.stream, payload.content)
      return
    }

    // A timed-out case may keep running after it settled; its late output is printed after the task's blocks.
    const lateOutput = new CaseOutputLines()
    lateOutput.append(payload.stream, payload.content)
    this.finishedBlocks.push({
      caseOrder: Number.POSITIVE_INFINITY,
      taskOrder: task.queueOrder,
      text: [
        this.formatCaseHeader(task, payload.caseId),
        ...lateOutput.lines.map(line => `${c.magentaBright('│')} ${line.text}`),
        '',
      ].join('\n'),
    })
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

    if (task.settledCaseIds.has(payload.caseId)) {
      return
    }

    const existingCase = task.runningCases.get(payload.caseId)
    if (existingCase != null) {
      if (payload.retryIndex != null && payload.retryIndex > 0 && existingCase.output.lines.length > 0) {
        existingCase.output.appendMarker(`── retry ${payload.retryIndex}/${payload.autoRetry ?? payload.retryIndex} ──`)
      }
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
      output: new CaseOutputLines(),
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
    this.printFinishedBlocks()
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
    this.finishedBlocks = []
    this.queueOrderCounter = 0
    resetCounterState(this.taskCounters, payload.totalTasks)
    resetCounterState(this.caseCounters, 0)
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
    for (const activeCase of task.runningCases.values()) {
      this.holdCaseOutputBlock(task, activeCase, 'stopped')
    }
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

  private createActiveRows(outputLinesPerCase: number): string[] {
    const activeTasks = Array
      .from(this.tasks.values())
      .filter(task => task.state !== 'finished')
      .sort(compareActiveTasks)

    const rows: string[] = []

    for (const task of activeTasks) {
      const now = this.options.getNow()
      const suffix = task.state === 'queued'
        ? c.dim(' [queued]')
        : formatTaskProgressSuffix(task, now)
      const badge = formatProjectBadge(task.projectName, this.options.isTTY)
      rows.push(c.bold(c.yellow(` ${POINTER} `)) + badge + task.displayName + c.dim(suffix))

      const slowCases = Array
        .from(task.runningCases.values())
        .filter(activeCase => now - activeCase.startedAt >= this.options.slowThresholdMs)
        .sort((left, right) => left.order - right.order)

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
        const lines = activeCase.output.lines
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

  private createFooterRows(): string[] {
    const now = this.options.getNow()
    const runElapsedDurationMs = Math.max(0, now - this.startedAtMs)
    const taskRunningCount = countRunningTasks(this.tasks.values())
    const caseRunningCount = countRunningCases(this.tasks.values())

    return [
      padSummaryTitle('Tasks') + formatCounterState(
        this.taskCounters,
        taskRunningCount,
        {
          elapsedDurationMs: runElapsedDurationMs,
          estimatedDurationMs: estimateTotalDurationMs(this.taskCounters.completed, this.taskCounters.total, runElapsedDurationMs),
        },
      ),
      padSummaryTitle('Cases') + formatCounterState(
        this.caseCounters,
        caseRunningCount,
        {
          elapsedDurationMs: runElapsedDurationMs,
          estimatedDurationMs: estimateTotalDurationMs(this.caseCounters.completed, this.caseCounters.total, runElapsedDurationMs),
        },
      ),
      padSummaryTitle('Concurrency') + formatActiveConcurrencyState({
        caseRunningCount,
        taskRunningCount,
      }),
      padSummaryTitle('Start at') + this.startTime,
      padSummaryTitle('Duration') + formatHumanDuration(runElapsedDurationMs),
    ]
  }

  private formatCaseHeader(task: TaskRuntimeState, caseName: string): string {
    return `${formatProjectBadge(task.projectName, this.options.isTTY)}${task.displayName} ${c.dim('>')} ${caseName}`
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

  private holdCaseOutputBlock(task: TaskRuntimeState, activeCase: ActiveCaseState, state: 'stopped' | CliReporterCaseEndPayload['state'], errorMessage?: string): void {
    if (activeCase.output.lines.length === 0) {
      return
    }

    this.finishedBlocks.push({
      caseOrder: activeCase.order,
      taskOrder: task.queueOrder,
      text: formatCaseOutputBlock({
        collapse: true,
        colors: true,
        durationMs: Math.max(0, this.options.getNow() - activeCase.startedAt),
        errorMessage,
        header: this.formatCaseHeader(task, activeCase.caseName),
        lines: activeCase.output.lines,
        state,
      }),
    })
  }

  /**
   * Prints held case blocks grouped by task in queue order, cases in start order, then forgets them.
   */
  private printFinishedBlocks(): void {
    const blocks = [...this.finishedBlocks].sort((left, right) => left.taskOrder - right.taskOrder || left.caseOrder - right.caseOrder)
    this.finishedBlocks = []

    for (const block of blocks) {
      this.options.writeOutput(block.text)
    }
  }

  /**
   * Splits the rows left over by task rows and the footer between running cases that have output.
   * Each case shows at most {@link CASE_OUTPUT_VISIBLE_LINES} lines plus one collapsed-count row.
   */
  private resolveOutputLinesPerCase(maxRows: number | undefined, footerRowCount: number): number {
    const casesWithOutput = Array
      .from(this.tasks.values())
      .filter(task => task.state !== 'finished')
      .flatMap(task => Array.from(task.runningCases.values()))
      .filter(activeCase => activeCase.output.lines.length > 0 && this.options.getNow() - activeCase.startedAt >= this.options.slowThresholdMs)
      .length

    if (casesWithOutput === 0) {
      return 0
    }
    if (maxRows == null || maxRows <= 0) {
      return CASE_OUTPUT_VISIBLE_LINES
    }

    // Leading and trailing spacer rows of the active block.
    const baseRowCount = this.createActiveRows(0).length + 2
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
    failed: 0,
    passed: 0,
    skipped: 0,
    timeout: 0,
    total: 0,
  }
}

function estimateTaskDurationMs(task: TaskRuntimeState, now: number): number | undefined {
  if (task.startedAt == null) {
    return undefined
  }

  return estimateTotalDurationMs(
    task.completedCases,
    task.totalCases,
    Math.max(0, now - task.startedAt),
  )
}

function estimateTotalDurationMs(
  completedCount: number,
  totalCount: number,
  elapsedDurationMs: number,
): number | undefined {
  if (completedCount === 0 || totalCount === 0) {
    return undefined
  }

  const averageDurationMs = elapsedDurationMs / completedCount
  return Math.round(averageDurationMs * totalCount)
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
  timing: ProgressTimingState,
): string {
  const plannedCount = Math.max(0, counter.total - counter.completed - runningCount)

  return [
    plannedCount > 0 ? c.bold(c.blue(`${plannedCount} planned`)) : c.dim(`${plannedCount} planned`),
    runningCount > 0 ? c.bold(c.yellow(`${runningCount} running`)) : c.dim(`${runningCount} running`),
    c.bold(c.green(`${counter.passed} passed`)),
    counter.failed > 0 ? c.bold(c.red(`${counter.failed} failed`)) : c.dim(`${counter.failed} failed`),
    counter.timeout > 0 ? c.bold(c.yellow(`${counter.timeout} timeout`)) : c.dim(`${counter.timeout} timeout`),
    counter.skipped > 0 ? c.yellow(`${counter.skipped} skipped`) : c.dim(`${counter.skipped} skipped`),
  ].join(c.dim(' | ')) + c.gray(` (${counter.total})`) + formatTimingSuffix(timing)
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

function formatTaskProgressSuffix(task: TaskRuntimeState, now: number): string {
  const elapsedDurationMs = task.startedAt == null
    ? 0
    : Math.max(0, now - task.startedAt)

  return ` ${task.completedCases}/${task.totalCases}, ${task.runningCases.size} ${pluralize('case', task.runningCases.size)} running${formatTimingSuffix({
    elapsedDurationMs,
    estimatedDurationMs: estimateTaskDurationMs(task, now),
  })}`
}

function formatTimeString(date: Date): string {
  return date.toTimeString().split(' ')[0] ?? ''
}

function formatTimingSuffix(timing: ProgressTimingState): string {
  const parts = [`elapsed ${formatHumanDuration(timing.elapsedDurationMs)}`]

  if (timing.estimatedDurationMs != null) {
    parts.push(`estimated ${formatHumanDuration(timing.estimatedDurationMs)}`)
  }

  return ` (${parts.join(', ')})`
}

function padSummaryTitle(label: string): string {
  return `${c.dim(label.padEnd(8))} `
}

function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`
}

function resetCounterState(counter: SummaryReporterCounterState, total: number): void {
  counter.completed = 0
  counter.failed = 0
  counter.passed = 0
  counter.skipped = 0
  counter.timeout = 0
  counter.total = total
}

function sumTaskCaseTotals(tasks: Iterable<TaskRuntimeState>): number {
  let total = 0

  for (const task of tasks) {
    total += task.totalCases
  }

  return total
}
