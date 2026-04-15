import type {
  CliReporter,
  CliReporterCaseEndPayload,
  CliReporterCaseStartPayload,
  CliReporterRunEndPayload,
  CliReporterRunStartPayload,
  CliReporterTaskEndPayload,
  CliReporterTaskQueuedPayload,
  CliReporterTaskStartPayload,
} from './types'

/**
 * Creates a reporter that intentionally does nothing.
 *
 * Use when:
 * - terminal output should stay silent
 * - reporter wiring needs a safe default for tests or non-interactive runs
 *
 * Expects:
 * - callers may invoke any lifecycle method in any order that matches the run
 *
 * Returns:
 * - a stable reporter implementation with no observable side effects
 */
export function createNoopReporter(): CliReporter {
  return {
    onRunStart(_payload: CliReporterRunStartPayload) {},
    onTaskQueued(_payload: CliReporterTaskQueuedPayload) {},
    onTaskStart(_payload: CliReporterTaskStartPayload) {},
    onCaseStart(_payload: CliReporterCaseStartPayload) {},
    onCaseEnd(_payload: CliReporterCaseEndPayload) {},
    onTaskEnd(_payload: CliReporterTaskEndPayload) {},
    onRunEnd(_payload: CliReporterRunEndPayload) {},
    dispose() {},
  }
}
