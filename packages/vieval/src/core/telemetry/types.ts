/** Attribute map shared by local report projection and OpenTelemetry span calls. */
export type TelemetryAttributes = Record<string, TelemetryAttributeValue | undefined>

/** JSON-compatible scalar values accepted as telemetry attributes. */
export type TelemetryAttributeValue = boolean | null | number | readonly TelemetryAttributeValue[] | string

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
  addEvent: (name: string, attributes?: TelemetryAttributes) => void
  recordException: (error: unknown) => void
  setAttributes: (attributes: TelemetryAttributes) => void
  withSpan: <T>(
    name: string,
    attributes: TelemetryAttributes,
    callback: () => Promise<T>,
  ) => Promise<T>
}
