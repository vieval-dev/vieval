import { describe, expect, it } from 'vitest'

import { createCliReporter } from './index'

/**
 * @example
 * describe('createCliReporter', () => {})
 */
describe('createCliReporter', () => {
  /**
   * @example
   * it('selects the case output reporter when TTY output is disabled', () => {})
   */
  it('selects the case output reporter when TTY output is disabled', () => {
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
