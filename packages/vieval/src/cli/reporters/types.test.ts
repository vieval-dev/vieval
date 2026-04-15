import type { CliReporter } from './types'

import { describe, expect, it } from 'vitest'

import { createCliReporter, createNoopReporter } from './index'

/**
 * @example
 * describe('createNoopReporter', () => {})
 */
describe('createNoopReporter', () => {
  /**
   * @example
   * it('exposes the reporter lifecycle without throwing', () => {})
   */
  it('exposes the reporter lifecycle without throwing', () => {
    const reporter: CliReporter = createNoopReporter()

    /**
     * @example
     * expect(() => reporter.dispose()).not.toThrow()
     */
    expect(() => {
      reporter.onRunStart({ totalTasks: 2 })
      reporter.onTaskQueued({ taskId: 'task-1' })
      reporter.onTaskStart({ taskId: 'task-1' })
      reporter.onCaseStart({ taskId: 'task-1', caseId: 'case-1' })
      reporter.onCaseEnd({ taskId: 'task-1', caseId: 'case-1', state: 'passed' })
      reporter.onTaskEnd({ taskId: 'task-1', state: 'passed' })
      reporter.onRunEnd({ totalTasks: 2, passedTasks: 1, failedTasks: 0, skippedTasks: 0 })
      reporter.dispose()
    }).not.toThrow()
  })

  /**
   * @example
   * it('allows dispose() to be called multiple times safely', () => {})
   */
  it('allows dispose() to be called multiple times safely', () => {
    const reporter: CliReporter = createNoopReporter()

    /**
     * @example
     * expect(() => {
     *   reporter.dispose()
     *   reporter.dispose()
     * }).not.toThrow()
     */
    expect(() => {
      reporter.dispose()
      reporter.dispose()
    }).not.toThrow()
  })
})

/**
 * @example
 * describe('createCliReporter', () => {})
 */
describe('createCliReporter', () => {
  /**
   * @example
   * it('selects the noop reporter when TTY output is disabled', () => {})
   */
  it('selects the noop reporter when TTY output is disabled', () => {
    const reporter = createCliReporter({
      getColumns: () => 120,
      getNow: () => 0,
      getWallClockNow: () => new Date(2026, 3, 15, 9, 30, 0, 0).getTime(),
      isTTY: false,
      slowThresholdMs: 300,
      writeError: () => {},
      writeOutput: () => {},
    })

    /**
     * @example
     * expect('getWindowRows' in reporter).toBe(false)
     */
    expect('getWindowRows' in reporter).toBe(false)
  })

  /**
   * @example
   * it('selects the summary reporter when TTY output is enabled', () => {})
   */
  it('selects the summary reporter when TTY output is enabled', () => {
    const reporter = createCliReporter({
      getColumns: () => 120,
      getNow: () => 0,
      getWallClockNow: () => new Date(2026, 3, 15, 9, 30, 0, 0).getTime(),
      isTTY: true,
      slowThresholdMs: 300,
      writeError: () => {},
      writeOutput: () => {},
    })

    /**
     * @example
     * expect('getWindowRows' in reporter).toBe(true)
     */
    expect('getWindowRows' in reporter).toBe(true)
  })
})
