import type { SummaryReporter } from './summary-reporter'

import { stripVTControlCharacters } from 'node:util'

import { describe, expect, it } from 'vitest'

import { createSummaryReporter } from './summary-reporter'

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

function findRow(rows: readonly string[], label: string): string {
  const row = rows.find(candidate => stripAnsi(candidate).includes(label))

  if (row == null) {
    throw new Error(`Expected row containing "${label}" in:\n${rows.map(stripAnsi).join('\n')}`)
  }

  return stripAnsi(row)
}

function stripAnsi(value: string): string {
  return stripVTControlCharacters(value)
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
  it('shows planned and running counters plus elapsed and time left in active task rows', () => {
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
    const concurrencyRow = findRow(rows, 'Concurrency')

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
    /**
     * @example
     * expect(activeRow).toContain('1 case running')
     */
    expect(activeRow).toContain('1 case running')
    expect(activeRow).toContain('elapsed')
    expect(activeRow).toContain('left')
    /**
     * @example
     * expect(tasksRow).toContain('(2)')
     */
    expect(tasksRow).toContain('(2)')
    expect(tasksRow).toContain('1 running')
    expect(tasksRow).toContain('1 planned')
    /**
     * @example
     * expect(casesRow).toContain('1 passed')
     */
    expect(casesRow).toContain('1 passed')
    expect(casesRow).toContain('2 planned')
    expect(casesRow).toContain('1 running')
    /**
     * @example
     * expect(casesRow).toContain('(4)')
     */
    expect(casesRow).toContain('(4)')
    /**
     * @example
     * expect(concurrencyRow).toContain('1 case running')
     */
    expect(concurrencyRow).toContain('1 case running')
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
    expect(activeRow).not.toContain('left')
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
   * it('updates slow running case rows with the current retry attempt', () => {})
   */
  it('updates slow running case rows with the current retry attempt', () => {
    let now = 0
    const reporter = createTestReporter(() => now)

    reporter.onRunStart({ totalTasks: 1 })
    reporter.onTaskQueued({
      displayName: 'retry.eval.ts',
      projectName: 'vieval',
      taskId: 'task-retry',
      totalCases: 1,
    })
    reporter.onTaskStart({ taskId: 'task-retry' })
    reporter.onCaseStart({
      autoRetry: 5,
      caseId: 'case-retry',
      caseName: 'fetches memory',
      retryIndex: 0,
      taskId: 'task-retry',
    })
    reporter.onCaseStart({
      autoRetry: 5,
      caseId: 'case-retry',
      caseName: 'fetches memory',
      retryIndex: 2,
      taskId: 'task-retry',
    })

    now = 350
    const rows = reporter.getWindowRows().map(stripAnsi)

    /**
     * @example
     * expect(rows.join('\n')).toContain('retry 2/5')
     */
    expect(rows.join('\n')).toContain('retry 2/5')
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
   * it('uses a wall-clock timestamp for the start and a monotonic clock for the elapsed time', () => {})
   */
  it('uses a wall-clock timestamp for the start and a monotonic clock for the elapsed time', () => {
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
     * expect(findRow(rows, 'Time')).toContain('started 01:02:03')
     */
    expect(findRow(rows, 'Time')).toContain('started 01:02:03')
    /**
     * @example
     * expect(findRow(rows, 'Time')).toContain('elapsed 1 second')
     */
    expect(findRow(rows, 'Time')).toContain('elapsed 1 second')
  })

  it('renders planned, running, terminal counts, elapsed, and time left in footer rows', () => {
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
    expect(rows).toContain('left')
  })

  // ROOT CAUSE:
  //
  // In airi `tts-speech-formula`, two `zh` tasks held task slots while the run-wide case pool was full. They showed
  // `0/0, 0 cases running (elapsed 3 minutes 10 seconds)`, and `Cases (402)` left out their 134 cases, so the run
  // estimate said about 25 s were left when about 180 cases still had to run.
  //
  // This happened because a task's case total reached the reporter only with its first `case.started`, and the
  // task's elapsed time started at `task.started`.
  //
  // We fixed this by sending `totalCases` with `task.queued` (`describeTask` knows its cases when the module loads),
  // starting a task's clock at its first case, and showing a task without a running case as waiting.
  it('counts the cases of tasks still waiting for a case slot and shows them as waiting', () => {
    let now = 0
    const reporter = createTestReporter(() => now)

    reporter.onRunStart({ totalTasks: 2 })
    reporter.onTaskQueued({ displayName: 'ja', projectName: 'raw', taskId: 'ja', totalCases: 67 })
    reporter.onTaskQueued({ displayName: 'zh', projectName: 'raw', taskId: 'zh', totalCases: 67 })
    reporter.onTaskStart({ taskId: 'ja' })
    reporter.onTaskStart({ taskId: 'zh' })
    reporter.onCaseStart({ caseId: 'case-1', caseName: 'case #1', taskId: 'ja' })

    now = 190_000
    const rows = reporter.getWindowRows()

    expect(findRow(rows, 'Cases')).toContain('(134)')
    expect(findRow(rows, ' zh')).toContain('0/67, waiting for a case slot')
    expect(findRow(rows, ' zh')).not.toContain('elapsed')
  })

  it('estimates time left and the end time from the recent case throughput', () => {
    let now = 0
    const reporter = createSummaryReporter({
      getColumns: () => 120,
      getNow: () => now,
      getWallClockNow: () => new Date(2026, 9, 19, 7, 49, 58).getTime() + now,
      isTTY: true,
      slowThresholdMs: 300,
      writeError: () => {},
      writeOutput: () => {},
    })

    reporter.onRunStart({ totalTasks: 1 })
    reporter.onTaskQueued({ displayName: 'ja', projectName: 'raw', taskId: 'ja', totalCases: 10 })
    reporter.onTaskStart({ taskId: 'ja' })
    for (let index = 1; index <= 4; index += 1) {
      reporter.onCaseStart({ caseId: `case-${index}`, caseName: `case #${index}`, taskId: 'ja' })
      now = index * 10_000
      reporter.onCaseEnd({ caseId: `case-${index}`, state: 'passed', taskId: 'ja' })
    }

    // 4 cases in 40 s, 6 left: about 60 s.
    const time = findRow(reporter.getWindowRows(), 'Time')

    expect(time).toContain('elapsed 40 seconds')
    expect(time).toContain('~1 minute left')
    expect(time).toContain('ETA 07:51:38')
  })

  it('shows no time left while a queued task has not declared its cases', () => {
    let now = 0
    const reporter = createTestReporter(() => now)

    reporter.onRunStart({ totalTasks: 2 })
    reporter.onTaskQueued({ displayName: 'known', projectName: 'p', taskId: 'known', totalCases: 4 })
    reporter.onTaskQueued({ displayName: 'custom', projectName: 'p', taskId: 'custom' })
    reporter.onTaskStart({ taskId: 'known' })
    for (let index = 1; index <= 3; index += 1) {
      reporter.onCaseStart({ caseId: `case-${index}`, caseName: `case #${index}`, taskId: 'known' })
      now = index * 1_000
      reporter.onCaseEnd({ caseId: `case-${index}`, state: 'passed', taskId: 'known' })
    }
    const rows = reporter.getWindowRows()

    expect(findRow(rows, 'Cases')).toContain('(4+)')
    expect(findRow(rows, 'Time')).toContain('~? left')
  })

  it('shows a projects row when the run has more than one project', () => {
    const reporter = createTestReporter(() => 0)

    reporter.onRunStart({ totalTasks: 3 })
    reporter.onTaskQueued({ displayName: 'a', projectName: 'alpha', taskId: 'a', totalCases: 1 })
    reporter.onTaskQueued({ displayName: 'b', projectName: 'beta', taskId: 'b', totalCases: 1 })
    reporter.onTaskQueued({ displayName: 'c', projectName: 'gamma', taskId: 'c', totalCases: 1 })
    reporter.onTaskStart({ taskId: 'a' })
    reporter.onTaskEnd({ state: 'passed', taskId: 'a' })
    reporter.onTaskStart({ taskId: 'b' })
    reporter.onCaseStart({ caseId: 'case-1', caseName: 'case 1', taskId: 'b' })

    const projects = findRow(reporter.getWindowRows(), 'Projects')

    expect(projects).toContain('1 planned')
    expect(projects).toContain('1 running')
    expect(projects).toContain('1 passed')
    expect(projects).toContain('(3)')
  })

  it('leaves out the projects row for a single project', () => {
    const reporter = createTestReporter(() => 0)

    reporter.onRunStart({ totalTasks: 1 })
    reporter.onTaskQueued({ displayName: 'a', projectName: 'alpha', taskId: 'a', totalCases: 1 })

    expect(reporter.getWindowRows().map(stripAnsi).join('\n')).not.toContain('Projects')
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
     * expect(findRow(rows, 'Cases')).toContain('(2+)')
     */
    // Without a declared total, the cases seen so far are a lower bound.
    expect(findRow(rows, 'Cases')).toContain('(2+)')

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
    const compactRows = reporter.getWindowRows({ maxRows: 6 }).map(stripAnsi)
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
     * expect(compactRows.some(row => row.includes('Time'))).toBe(true)
     */
    expect(compactRows.some(row => row.includes('Time'))).toBe(true)
    /**
     * @example
     * expect(tinyRows[0]).toContain('Time')
     */
    expect(tinyRows[0]).toContain('Time')
    /**
     * @example
     * expect(tinyRows).toHaveLength(2)
     */
    expect(tinyRows).toHaveLength(2)
  })

  /**
   * @example
   * it('shows a hidden running case count when active case rows exceed the live window', () => {})
   */
  it('shows a hidden running case count when active case rows exceed the live window', () => {
    let now = 1_000
    const reporter = createTestReporter(() => now)

    reporter.onRunStart({ totalTasks: 1 })
    reporter.onTaskQueued({
      displayName: 'locomo.eval.ts',
      projectName: 'locomo-lobehub',
      taskId: 'task-locomo',
      totalCases: 20,
    })
    reporter.onTaskStart({ taskId: 'task-locomo' })

    for (let index = 1; index <= 20; index += 1) {
      reporter.onCaseStart({
        caseId: `case-${index}`,
        caseName: `snap-locomo-retrieval-generation-scoring #${index}`,
        taskId: 'task-locomo',
      })
    }

    now = 2_000
    const rows = reporter.getWindowRows({ maxRows: 14 }).map(stripAnsi)
    const concurrencyRow = findRow(rows, 'Concurrency')

    /**
     * @example
     * expect(rows).toHaveLength(14)
     */
    expect(rows).toHaveLength(14)
    /**
     * @example
     * expect(rows.join('\n')).toContain('14 more running rows hidden')
     */
    expect(rows.join('\n')).toContain('14 more running rows hidden')
    /**
     * @example
     * expect(rows.join('\n')).toContain('Tasks')
     */
    expect(rows.join('\n')).toContain('Tasks')
    /**
     * @example
     * expect(rows.join('\n')).toContain('Time')
     */
    expect(rows.join('\n')).toContain('Time')
    /**
     * @example
     * expect(concurrencyRow).toContain('20 cases running')
     */
    expect(concurrencyRow).toContain('20 cases running')
  })

  /**
   * @example
   * it('shows the tail of running case output and prints its collapsed block when the run ends', () => {})
   */
  it('shows the tail of running case output and prints its collapsed block when the run ends', () => {
    let now = 0
    const writes: string[] = []
    const reporter = createSummaryReporter({
      getColumns: () => 120,
      getNow: () => now,
      getWallClockNow: () => new Date(2026, 3, 15, 9, 30, 0, 0).getTime(),
      isTTY: true,
      slowThresholdMs: 300,
      writeError: () => {},
      writeOutput: value => writes.push(stripAnsi(value)),
    })

    reporter.onRunStart({ totalTasks: 1 })
    reporter.onTaskQueued({ displayName: 'episodes', projectName: 'demo', taskId: 'task-a', totalCases: 1 })
    reporter.onTaskStart({ taskId: 'task-a' })
    reporter.onCaseStart({ caseId: 'case-1', caseName: 'chrome/open', taskId: 'task-a' })
    for (let step = 1; step <= 12; step += 1) {
      reporter.onCaseOutput({ caseId: 'case-1', content: `step ${step}\n`, stream: 'stdout', taskId: 'task-a' })
    }
    now = 1_000

    const rows = reporter.getWindowRows().map(stripAnsi)

    /**
     * @example
     * expect(rows).toContain('     [2 lines collapsed]')
     */
    expect(rows).toContain('     [2 lines collapsed]')
    expect(rows).toContain('     │ step 3')
    expect(rows).toContain('     │ step 12')
    /**
     * @example
     * expect(rows).not.toContain('     │ step 2')
     */
    expect(rows).not.toContain('     │ step 2')

    now = 2_000
    reporter.onCaseEnd({ caseId: 'case-1', state: 'passed', taskId: 'task-a' })

    /**
     * @example
     * expect(writes).toEqual([])
     */
    expect(writes).toEqual([])
    /**
     * @example
     * expect(reporter.getWindowRows().map(stripAnsi).join('\n')).not.toContain('step 12')
     */
    expect(reporter.getWindowRows().map(stripAnsi).join('\n')).not.toContain('step 12')

    reporter.onTaskEnd({ state: 'passed', taskId: 'task-a' })
    reporter.onRunEnd({ failedTasks: 0, passedTasks: 1, skippedTasks: 0, totalTasks: 1 })

    /**
     * @example
     * expect(writes).toEqual(['|demo| episodes > chrome/open\n[2 lines collapsed]\n│ step 3\n...'])
     */
    expect(writes).toEqual([
      `|demo| episodes > chrome/open\n[2 lines collapsed]\n${Array.from({ length: 10 }, (_, index) => `│ step ${index + 3}\n`).join('')}└─ Done in 2 seconds\n`,
    ])
  })

  /**
   * @example
   * it('shares the live window height between running cases that have output', () => {})
   */
  it('shares the live window height between running cases that have output', () => {
    let now = 0
    const reporter = createTestReporter(() => now)

    reporter.onRunStart({ totalTasks: 1 })
    reporter.onTaskQueued({ displayName: 'episodes', taskId: 'task-a', totalCases: 2 })
    reporter.onTaskStart({ taskId: 'task-a' })
    for (const caseId of ['case-1', 'case-2']) {
      reporter.onCaseStart({ caseId, caseName: caseId, taskId: 'task-a' })
      for (let step = 1; step <= 10; step += 1) {
        reporter.onCaseOutput({ caseId, content: `${caseId} step ${step}\n`, stream: 'stdout', taskId: 'task-a' })
      }
    }
    now = 1_000

    const rows = reporter.getWindowRows({ maxRows: 20 })

    /**
     * @example
     * expect(rows.length).toBeLessThanOrEqual(20)
     */
    expect(rows.length).toBeLessThanOrEqual(20)
    /**
     * @example
     * expect(rows.map(stripAnsi).join('\n')).not.toContain('more running rows hidden')
     */
    expect(rows.map(stripAnsi).join('\n')).not.toContain('more running rows hidden')
    /**
     * @example
     * expect(rows.map(stripAnsi)).toContain('   │ │ case-1 step 10')
     */
    expect(rows.map(stripAnsi)).toContain('   │ │ case-1 step 10')
    expect(rows.map(stripAnsi)).toContain('     │ case-2 step 10')
  })

  /**
   * @example
   * it('prints held case blocks grouped by task and case order, and on dispose after an interrupted run', () => {})
   */
  it('prints held case blocks grouped by task and case order, and on dispose after an interrupted run', () => {
    const writes: string[] = []
    const reporter = createSummaryReporter({
      getColumns: () => 120,
      getNow: () => 0,
      getWallClockNow: () => 0,
      isTTY: true,
      slowThresholdMs: 300,
      writeError: () => {},
      writeOutput: value => writes.push(stripAnsi(value).split('\n')[0] ?? ''),
    })

    reporter.onRunStart({ totalTasks: 2 })
    reporter.onTaskQueued({ displayName: 'first', taskId: 'task-a' })
    reporter.onTaskQueued({ displayName: 'second', taskId: 'task-b' })
    for (const [taskId, caseId] of [['task-b', 'b1'], ['task-a', 'a1'], ['task-a', 'a2']] as const) {
      reporter.onCaseStart({ caseId, caseName: caseId, taskId })
      reporter.onCaseOutput({ caseId, content: `${caseId}\n`, stream: 'stdout', taskId })
    }
    reporter.onCaseEnd({ caseId: 'a2', state: 'passed', taskId: 'task-a' })
    reporter.onCaseEnd({ caseId: 'b1', state: 'passed', taskId: 'task-b' })
    reporter.onCaseEnd({ caseId: 'a1', state: 'passed', taskId: 'task-a' })
    reporter.dispose()

    /**
     * @example
     * expect(writes).toEqual(['first > a1', 'first > a2', 'second > b1'])
     */
    expect(writes).toEqual(['first > a1', 'first > a2', 'second > b1'])
  })
})
