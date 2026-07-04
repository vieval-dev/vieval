import type { TelemetryRuntime } from './types'

/**
 * Creates the default no-op telemetry runtime.
 *
 * Use when:
 * - OpenTelemetry is not enabled by config
 * - tests need deterministic pass-through execution
 *
 * Expects:
 * - callers still wrap run/task/case boundaries with `withSpan`
 *
 * Returns:
 * - a runtime that never emits external telemetry and never changes control flow
 */
export function createNoopTelemetryRuntime(): TelemetryRuntime {
  return {
    addEvent() {},
    recordException() {},
    setAttributes() {},
    async withSpan(_name, _attributes, callback) {
      return await callback()
    },
  }
}
