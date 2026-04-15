import type { SummaryReporterOptions } from './summary-reporter'
import type { CliReporter } from './types'

import { createNoopReporter } from './noop-reporter'
import { createSummaryReporter } from './summary-reporter'

/**
 * Factory options for selecting the default CLI reporter.
 *
 * Use when:
 * - CLI wiring needs one reporter factory for TTY and non-TTY runs
 * - tests want to exercise reporter selection without importing concrete reporters
 *
 * Expects:
 * - the shared timing and output hooks match {@link SummaryReporterOptions}
 * - `isTTY` reflects whether live terminal rendering is allowed
 *
 * Returns:
 * - the minimal configuration consumed by {@link createCliReporter}
 */
export interface CreateCliReporterOptions extends SummaryReporterOptions {}

/**
 * Creates the default CLI reporter for the current output mode.
 *
 * Use when:
 * - interactive terminals should use the live summary reporter
 * - non-interactive environments should stay silent with the noop reporter
 *
 * Expects:
 * - `isTTY` decides whether the live summary reporter can be used
 *
 * Returns:
 * - a summary reporter for TTY runs, otherwise a noop reporter
 */
export function createCliReporter(options: CreateCliReporterOptions): CliReporter {
  if (!options.isTTY) {
    return createNoopReporter()
  }

  return createSummaryReporter(options)
}

export * from './noop-reporter'
export * from './summary-reporter'
export * from './types'
