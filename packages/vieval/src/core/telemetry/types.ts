/** JSON-compatible scalar values accepted as telemetry attributes. */
export type TelemetryAttributeValue = boolean | number | string | null | readonly TelemetryAttributeValue[]

/** Attribute map shared by local report projection and OpenTelemetry span calls. */
export type TelemetryAttributes = Record<string, TelemetryAttributeValue | undefined>

/**
 * Internal Vieval telemetry runtime.
 *
 * Use when:
 * - runner code needs one execution path for disabled and enabled telemetry
 * - case code should run inside an active OpenTelemetry span when configured
 *
 * Expects:
 * - attributes are JSON-compatible and stable enough for report filtering
 * - callbacks are awaited by the caller
 *
 * Returns:
 * - callback result, preserving thrown errors after telemetry records them
 */
export interface TelemetryRuntime {
  withSpan: <T>(
    name: string,
    attributes: TelemetryAttributes,
    callback: () => Promise<T>,
  ) => Promise<T>
  addEvent: (name: string, attributes?: TelemetryAttributes) => void
  setAttributes: (attributes: TelemetryAttributes) => void
  recordException: (error: unknown) => void
}
