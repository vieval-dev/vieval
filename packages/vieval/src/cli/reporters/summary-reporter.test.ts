import type { SummaryReporter } from './summary-reporter'

import { stripVTControlCharacters } from 'node:util'

import { describe, expect, it } from 'vitest'

import { createSummaryReporter } from './summary-reporter'

function stripAnsi(value: string): string {
  return stripVTControlCharacters(value)
}

function findRow(rows: readonly string[], label: string): string {
  const row = rows.find(candidate => stripAnsi(candidate).includes(label))

  if (row == null) {
    throw new Error(`Expected row containing "${label}" in:\n${rows.map(stripAnsi).join('\n')}`)
  }

  return stripAnsi(row)
}

function createTestReporter(getNow: () => number): SummaryReporter {
  return createSummaryReporter({
    getColumns: () => 120,
    getNow,
    getWallClockNow: () => new Date(2026, 3, 15, 9, 30, 0, 0).getTime(),
    isTTY: true,
    slowThresholdMs: 300,
    writeError: () => {},
    writeOutput: () => {},
  })
}

/**
 * @example
 * describe('createSummaryReporter', () => {})
 */
describe('createSummaryReporter', () => {
  /**
   * @example
   * it('shows a running task progress row and task/case counters', () => {})
   */
  it('shows planned and running counters plus elapsed and estimated timing in active task rows', () => {
    let now = 1_000
    const reporter = createSummaryReporter({
      getColumns: () => 120,
      getNow: () => now,
      getWallClockNow: () => new Date(2026, 3, 15, 9, 30, 0, 0).getTime(),
      isTTY: true,
      slowThresholdMs: 300,
      writeError: () => {},
      writeOutput: () => {},
    })

    reporter.onRunStart({ totalTasks: 2 })
    reporter.onTaskQueued({
      displayName: 'task.test.ts',
      projectName: 'vieval',
      taskId: 'task-a',
      totalCases: 4,
    })
    reporter.onTaskStart({ taskId: 'task-a' })
    reporter.onCaseStart({ caseId: 'case-1', caseName: 'case 1', taskId: 'task-a' })

    now = 1_120
    reporter.onCaseEnd({ caseId: 'case-1', state: 'passed', taskId: 'task-a' })
    reporter.onCaseStart({ caseId: 'case-2', caseName: 'case 2', taskId: 'task-a' })

    const rows = reporter.getWindowRows()
    const activeRow = findRow(rows, 'task.test.ts')
    const tasksRow = findRow(rows, 'Tasks')
    const casesRow = findRow(rows, 'Cases')

    /**
     * @example
     * expect(activeRow).toContain('❯')
     */
    expect(activeRow).toContain('❯')
    /**
     * @example
     * expect(activeRow).toContain('1/4')
     */
    expect(activeRow).toContain('1/4')
    expect(activeRow).toContain('elapsed')
    expect(activeRow).toContain('estimated')
    /**
     * @example
     * expect(tasksRow).toContain('(2)')
     */
    expect(tasksRow).toContain('(2)')
    expect(tasksRow).toContain('1 running')
    expect(tasksRow).toContain('1 planned')
    expect(tasksRow).toContain('elapsed')
    /**
     * @example
     * expect(casesRow).toContain('1 passed')
     */
    expect(casesRow).toContain('1 passed')
    expect(casesRow).toContain('2 planned')
    expect(casesRow).toContain('1 running')
    expect(casesRow).toContain('estimated')
    /**
     * @example
     * expect(casesRow).toContain('(4)')
     */
    expect(casesRow).toContain('(4)')
  })

  it('keeps task ETA undefined until at least one case has completed', () => {
    let now = 2_000
    const reporter = createSummaryReporter({
      getColumns: () => 120,
      getNow: () => now,
      getWallClockNow: () => new Date(2026, 3, 15, 9, 30, 0, 0).getTime(),
      isTTY: true,
      slowThresholdMs: 300,
      writeError: () => {},
      writeOutput: () => {},
    })

    reporter.onRunStart({ totalTasks: 1 })
    reporter.onTaskQueued({
      displayName: 'eta-pending.eval.ts',
      projectName: 'vieval',
      taskId: 'task-eta-pending',
      totalCases: 3,
    })
    reporter.onTaskStart({ taskId: 'task-eta-pending' })
    reporter.onCaseStart({ caseId: 'case-1', caseName: 'case 1', taskId: 'task-eta-pending' })

    now = 2_450

    const activeRow = findRow(reporter.getWindowRows(), 'eta-pending.eval.ts')

    expect(activeRow).toContain('elapsed')
    expect(activeRow).not.toContain('estimated')
  })

  /**
   * @example
   * it('keeps active rows stably sorted and removes finished tasks from the active window', () => {})
   */
  it('keeps active rows stably sorted and removes finished tasks from the active window', () => {
    const reporter = createSummaryReporter({
      getColumns: () => 120,
      getNow: () => 2_000,
      getWallClockNow: () => new Date(2026, 3, 15, 9, 30, 0, 0).getTime(),
      isTTY: true,
      slowThresholdMs: 300,
      writeError: () => {},
      writeOutput: () => {},
    })

    reporter.onRunStart({ totalTasks: 3 })
    reporter.onTaskQueued({
      displayName: 'zeta.eval.ts',
      projectName: 'beta',
      taskId: 'task-zeta',
      totalCases: 1,
    })
    reporter.onTaskQueued({
      displayName: 'alpha.eval.ts',
      projectName: 'alpha',
      taskId: 'task-alpha',
      totalCases: 1,
    })
    reporter.onTaskQueued({
      displayName: 'bravo.eval.ts',
      projectName: 'alpha',
      taskId: 'task-bravo',
      totalCases: 2,
    })

    reporter.onTaskStart({ taskId: 'task-bravo' })

    let rows = reporter.getWindowRows()
    let activeRows = rows
      .map(stripAnsi)
      .filter(row => row.includes('❯'))

    /**
     * @example
     * expect(activeRows).toHaveLength(3)
     */
    expect(activeRows).toHaveLength(3)
    /**
     * @example
     * expect(activeRows[0]).toContain('alpha.eval.ts')
     */
    expect(activeRows[0]).toContain('alpha.eval.ts')
    /**
     * @example
     * expect(activeRows[1]).toContain('bravo.eval.ts')
     */
    expect(activeRows[1]).toContain('bravo.eval.ts')
    /**
     * @example
     * expect(activeRows[2]).toContain('zeta.eval.ts')
     */
    expect(activeRows[2]).toContain('zeta.eval.ts')
    /**
     * @example
     * expect(activeRows[0]).toContain('[queued]')
     */
    expect(activeRows[0]).toContain('[queued]')

    reporter.onTaskEnd({ state: 'passed', taskId: 'task-bravo' })

    rows = reporter.getWindowRows()
    activeRows = rows
      .map(stripAnsi)
      .filter(row => row.includes('❯'))

    /**
     * @example
     * expect(activeRows).toHaveLength(2)
     */
    expect(activeRows).toHaveLength(2)
    /**
     * @example
     * expect(activeRows.join('\n')).not.toContain('bravo.eval.ts')
     */
    expect(activeRows.join('\n')).not.toContain('bravo.eval.ts')
    /**
     * @example
     * expect(findRow(rows, 'Tasks')).toContain('1 passed')
     */
    expect(findRow(rows, 'Tasks')).toContain('1 passed')
  })

  /**
   * @example
   * it('shows slow running case rows only after the slow threshold is exceeded', () => {})
   */
  it('shows slow running case rows only after the slow threshold is exceeded', () => {
    let now = 0
    const reporter = createTestReporter(() => now)

    reporter.onRunStart({ totalTasks: 1 })
    reporter.onTaskQueued({
      displayName: 'slow.eval.ts',
      projectName: 'vieval',
      taskId: 'task-slow',
      totalCases: 1,
    })
    reporter.onTaskStart({ taskId: 'task-slow' })
    reporter.onCaseStart({ caseId: 'case-slow', caseName: 'waits a bit', taskId: 'task-slow' })

    /**
     * @example
     * expect(reporter.getWindowRows().map(stripAnsi).join('\n')).not.toContain('waits a bit')
     */
    expect(reporter.getWindowRows().map(stripAnsi).join('\n')).not.toContain('waits a bit')

    now = 350
    const rows = reporter.getWindowRows().map(stripAnsi)

    /**
     * @example
     * expect(rows.join('\n')).toContain('waits a bit')
     */
    expect(rows.join('\n')).toContain('waits a bit')
    /**
     * @example
     * expect(rows.join('\n')).toContain('350ms')
     */
    expect(rows.join('\n')).toContain('350ms')
  })

  /**
   * @example
   * it('always shows passed, failed, and skipped counters even when they are zero', () => {})
   */
  it('always shows passed, failed, and skipped counters even when they are zero', () => {
    const reporter = createTestReporter(() => 0)

    reporter.onRunStart({ totalTasks: 0 })

    const rows = reporter.getWindowRows()
    const tasksRow = findRow(rows, 'Tasks')
    const casesRow = findRow(rows, 'Cases')

    /**
     * @example
     * expect(tasksRow).toContain('0 passed')
     */
    expect(tasksRow).toContain('0 passed')
    /**
     * @example
     * expect(tasksRow).toContain('0 failed')
     */
    expect(tasksRow).toContain('0 failed')
    /**
     * @example
     * expect(tasksRow).toContain('0 skipped')
     */
    expect(tasksRow).toContain('0 skipped')
    /**
     * @example
     * expect(casesRow).toContain('0 passed')
     */
    expect(casesRow).toContain('0 passed')
    /**
     * @example
     * expect(casesRow).toContain('0 failed')
     */
    expect(casesRow).toContain('0 failed')
    /**
     * @example
     * expect(casesRow).toContain('0 skipped')
     */
    expect(casesRow).toContain('0 skipped')
  })

  /**
   * @example
   * it('uses a wall-clock timestamp for Start at and a monotonic clock for Duration', () => {})
   */
  it('uses a wall-clock timestamp for Start at and a monotonic clock for Duration', () => {
    let now = 1_234
    const reporter = createSummaryReporter({
      getColumns: () => 120,
      getNow: () => now,
      getWallClockNow: () => new Date(2026, 3, 15, 1, 2, 3, 0).getTime(),
      isTTY: true,
      slowThresholdMs: 300,
      writeError: () => {},
      writeOutput: () => {},
    })

    reporter.onRunStart({ totalTasks: 1 })

    now = 2_234
    const rows = reporter.getWindowRows()

    /**
     * @example
     * expect(findRow(rows, 'Start at')).toContain('01:02:03')
     */
    expect(findRow(rows, 'Start at')).toContain('01:02:03')
    /**
     * @example
     * expect(findRow(rows, 'Duration')).toContain('1 second')
     */
    expect(findRow(rows, 'Duration')).toContain('1 second')
  })

  it('renders planned, running, terminal counts, elapsed, and estimated duration in footer rows', () => {
    let now = 5_000
    const reporter = createSummaryReporter({
      getColumns: () => 120,
      getNow: () => now,
      getWallClockNow: () => new Date('2026-04-24T23:52:53Z').valueOf(),
      isTTY: true,
      slowThresholdMs: 300,
      writeError: () => {},
      writeOutput: () => {},
    })

    reporter.onRunStart({ totalTasks: 4 })
    reporter.onTaskQueued({ taskId: 'task-1', totalCases: 4 })
    reporter.onTaskQueued({ taskId: 'task-2', totalCases: 2 })
    reporter.onTaskStart({ taskId: 'task-1' })
    reporter.onCaseStart({ caseId: 'case-1', caseName: 'case 1', taskId: 'task-1' })

    now = 6_000
    reporter.onCaseEnd({ caseId: 'case-1', state: 'passed', taskId: 'task-1' })
    reporter.onTaskStart({ taskId: 'task-2' })
    reporter.onTaskEnd({ state: 'passed', taskId: 'task-2' })

    const rows = reporter.getWindowRows().map(stripAnsi).join('\n')

    expect(rows).toContain('planned')
    expect(rows).toContain('running')
    expect(rows).toContain('elapsed')
    expect(rows).toContain('estimated')
  })

  /**
   * @example
   * it('keeps finished tasks terminal when duplicate queue or late lifecycle events arrive', () => {})
   */
  it('keeps finished tasks terminal when duplicate queue or late lifecycle events arrive', () => {
    const reporter = createTestReporter(() => 5_000)

    reporter.onRunStart({ totalTasks: 1 })
    reporter.onTaskQueued({
      displayName: 'terminal.eval.ts',
      projectName: 'vieval',
      taskId: 'task-terminal',
      totalCases: 1,
    })
    reporter.onTaskStart({ taskId: 'task-terminal' })
    reporter.onTaskQueued({
      displayName: 'terminal.eval.ts',
      projectName: 'vieval',
      taskId: 'task-terminal',
      totalCases: 1,
    })

    let rows = reporter.getWindowRows()
    const activeRow = findRow(rows, 'terminal.eval.ts')

    // ROOT CAUSE:
    //
    // If queue or case/task start events arrive after a terminal state,
    // the summary reporter could downgrade or resurrect a finished task.
    // This happened because non-terminal handlers rewrote `task.state`
    // without checking whether the task had already settled.
    //
    // Before the patch, a duplicate queue could bring a running task back
    // to `[queued]`, and a late task/case start could make a finished task
    // visible in the active window again.
    //
    // We fix this by treating finished tasks as terminal in every handler.
    /**
     * @example
     * expect(activeRow).toContain('0/1')
     */
    expect(activeRow).toContain('0/1')
    /**
     * @example
     * expect(activeRow).not.toContain('[queued]')
     */
    expect(activeRow).not.toContain('[queued]')

    reporter.onTaskEnd({ state: 'passed', taskId: 'task-terminal' })
    reporter.onTaskQueued({
      displayName: 'terminal.eval.ts',
      projectName: 'vieval',
      taskId: 'task-terminal',
      totalCases: 1,
    })
    reporter.onTaskStart({ taskId: 'task-terminal' })
    reporter.onCaseStart({ caseId: 'case-late', caseName: 'late case', taskId: 'task-terminal' })
    reporter.onCaseEnd({ caseId: 'case-late', state: 'failed', taskId: 'task-terminal' })

    rows = reporter.getWindowRows()

    /**
     * @example
     * expect(rows.map(stripAnsi).join('\n')).not.toContain('terminal.eval.ts')
     */
    expect(rows.map(stripAnsi).join('\n')).not.toContain('terminal.eval.ts')
    /**
     * @example
     * expect(findRow(rows, 'Tasks')).toContain('1 passed')
     */
    expect(findRow(rows, 'Tasks')).toContain('1 passed')
    /**
     * @example
     * expect(findRow(rows, 'Cases')).toContain('(1)')
     */
    expect(findRow(rows, 'Cases')).toContain('(1)')
  })

  /**
   * @example
   * it('lifts missing or stale case totals from observed activity', () => {})
   */
  it('lifts missing or stale case totals from observed activity', () => {
    const reporter = createTestReporter(() => 8_000)

    reporter.onRunStart({ totalTasks: 1 })
    reporter.onTaskQueued({
      displayName: 'observed.eval.ts',
      projectName: 'vieval',
      taskId: 'task-observed',
    })
    reporter.onTaskStart({ taskId: 'task-observed' })
    reporter.onCaseStart({ caseId: 'case-1', caseName: 'first case', taskId: 'task-observed' })
    reporter.onCaseEnd({ caseId: 'case-1', state: 'passed', taskId: 'task-observed' })
    reporter.onCaseStart({ caseId: 'case-2', caseName: 'second case', taskId: 'task-observed' })

    let rows = reporter.getWindowRows()

    /**
     * @example
     * expect(findRow(rows, 'observed.eval.ts')).toContain('1/2')
     */
    expect(findRow(rows, 'observed.eval.ts')).toContain('1/2')
    /**
     * @example
     * expect(findRow(rows, 'Cases')).toContain('(2)')
     */
    expect(findRow(rows, 'Cases')).toContain('(2)')

    reporter.onTaskQueued({
      displayName: 'observed.eval.ts',
      projectName: 'vieval',
      taskId: 'task-observed',
      totalCases: 1,
    })

    rows = reporter.getWindowRows()

    /**
     * @example
     * expect(findRow(rows, 'observed.eval.ts')).toContain('1/2')
     */
    expect(findRow(rows, 'observed.eval.ts')).toContain('1/2')
    /**
     * @example
     * expect(findRow(rows, 'Cases')).toContain('(2)')
     */
    expect(findRow(rows, 'Cases')).toContain('(2)')
  })

  /**
   * @example
   * it('preserves footer tail rows when getWindowRows is height-constrained', () => {})
   */
  it('preserves footer tail rows when getWindowRows is height-constrained', () => {
    let now = 12_000
    const reporter = createTestReporter(() => now)

    reporter.onRunStart({ totalTasks: 3 })
    reporter.onTaskQueued({
      displayName: 'alpha.eval.ts',
      projectName: 'vieval',
      taskId: 'task-alpha',
      totalCases: 1,
    })
    reporter.onTaskQueued({
      displayName: 'beta.eval.ts',
      projectName: 'vieval',
      taskId: 'task-beta',
      totalCases: 1,
    })
    reporter.onTaskQueued({
      displayName: 'gamma.eval.ts',
      projectName: 'vieval',
      taskId: 'task-gamma',
      totalCases: 1,
    })
    reporter.onTaskStart({ taskId: 'task-alpha' })
    reporter.onTaskStart({ taskId: 'task-beta' })
    reporter.onTaskStart({ taskId: 'task-gamma' })

    now = 13_500
    const compactRows = reporter.getWindowRows({ maxRows: 5 }).map(stripAnsi)
    const tinyRows = reporter.getWindowRows({ maxRows: 2 }).map(stripAnsi)

    /**
     * @example
     * expect(compactRows.join('\n')).not.toContain('alpha.eval.ts')
     */
    expect(compactRows.join('\n')).not.toContain('alpha.eval.ts')
    /**
     * @example
     * expect(compactRows.some(row => row.includes('Tasks'))).toBe(true)
     */
    expect(compactRows.some(row => row.includes('Tasks'))).toBe(true)
    /**
     * @example
     * expect(compactRows.some(row => row.includes('Duration'))).toBe(true)
     */
    expect(compactRows.some(row => row.includes('Duration'))).toBe(true)
    /**
     * @example
     * expect(tinyRows[0]).toContain('Duration')
     */
    expect(tinyRows[0]).toContain('Duration')
    /**
     * @example
     * expect(tinyRows).toHaveLength(2)
     */
    expect(tinyRows).toHaveLength(2)
  })
})
