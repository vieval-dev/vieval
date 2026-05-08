import type { TelemetryAttributes, TelemetryRuntime } from './types'

import { errorMessageFrom } from '@moeru/std'

type OpenTelemetryAttributeScalar = boolean | number | string
type OpenTelemetryAttributeValue = OpenTelemetryAttributeScalar | readonly boolean[] | readonly number[] | readonly string[]
type OpenTelemetryAttributes = Record<string, OpenTelemetryAttributeValue>

interface OpenTelemetrySpan {
  addEvent: (name: string, attributes?: OpenTelemetryAttributes) => void
  end: () => void
  recordException: (error: unknown) => void
  setAttributes: (attributes: OpenTelemetryAttributes) => void
  setStatus: (status: { code: number, message?: string }) => void
}

interface OpenTelemetryTracer {
  startActiveSpan: <T>(
    name: string,
    options: { attributes: OpenTelemetryAttributes },
    callback: (span: OpenTelemetrySpan) => Promise<T>,
  ) => Promise<T>
}

interface OpenTelemetryApiModule {
  SpanStatusCode: { ERROR: number }
  trace: {
    getActiveSpan: () => OpenTelemetrySpan | undefined
    getTracer: (name: string) => OpenTelemetryTracer
  }
}

/**
 * Options used to construct the OpenTelemetry-backed telemetry runtime.
 */
export interface CreateOpenTelemetryRuntimeOptions {
  /**
   * Optional import adapter used by tests to avoid requiring a real OpenTelemetry SDK.
   *
   * @default dynamic import of `@opentelemetry/api`
   */
  importApi?: () => Promise<OpenTelemetryApiModule>
}

async function importOpenTelemetryApi(): Promise<OpenTelemetryApiModule> {
  const moduleName = '@opentelemetry/api'
  return await import(moduleName) as unknown as OpenTelemetryApiModule
}

function isOpenTelemetryAttributeScalar(value: unknown): value is OpenTelemetryAttributeScalar {
  return typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string'
}

function isHomogeneousOpenTelemetryAttributeArray(value: readonly unknown[]): value is readonly boolean[] | readonly number[] | readonly string[] {
  if (value.length === 0) {
    return true
  }

  const firstType = typeof value[0]
  if (firstType !== 'boolean' && firstType !== 'number' && firstType !== 'string') {
    return false
  }

  return value.every(item => typeof item === firstType)
}

function stringifyAttributeValue(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  }
  catch {
    return String(value)
  }
}

/**
 * Normalizes JSON-compatible telemetry attributes into OpenTelemetry-safe attributes.
 *
 * Before:
 * - `{ nil: null, nested: ['a', [1, null]], scalarArray: ['a', 1, true] }`
 *
 * After:
 * - `{ nested: '["a",[1,null]]', scalarArray: ['a', 1, true] }`
 */
function normalizeOpenTelemetryAttributes(attributes: TelemetryAttributes | undefined): OpenTelemetryAttributes | undefined {
  if (attributes == null) {
    return undefined
  }

  const normalized: OpenTelemetryAttributes = {}

  for (const [key, value] of Object.entries(attributes)) {
    if (value == null) {
      continue
    }

    if (isOpenTelemetryAttributeScalar(value)) {
      normalized[key] = value
      continue
    }

    if (Array.isArray(value)) {
      normalized[key] = isHomogeneousOpenTelemetryAttributeArray(value)
        ? value
        : stringifyAttributeValue(value) ?? ''
      continue
    }

    const stringified = stringifyAttributeValue(value)

    if (stringified != null) {
      normalized[key] = stringified
    }
  }

  return normalized
}

/**
 * Creates an OpenTelemetry-backed runtime using active spans.
 *
 * Use when:
 * - `reporting.openTelemetry.enabled` is true
 * - the user's config has initialized an OpenTelemetry SDK or intentionally relies on the API no-op provider
 *
 * Expects:
 * - `@opentelemetry/api` is resolvable when enabled
 * - SDK lifecycle is managed by user config and `reporting.openTelemetry.onRunEnd`
 *
 * Returns:
 * - a runtime that starts active spans and forwards events to the current active span
 */
export function createOpenTelemetryRuntime(options: CreateOpenTelemetryRuntimeOptions = {}): TelemetryRuntime {
  const importApi = options.importApi ?? importOpenTelemetryApi
  let apiPromise: Promise<OpenTelemetryApiModule> | undefined
  let loadedApi: OpenTelemetryApiModule | undefined

  async function getApi(): Promise<OpenTelemetryApiModule> {
    apiPromise ??= importApi().then((api) => {
      loadedApi = api
      return api
    })
    return await apiPromise
  }

  return {
    async withSpan(name, attributes, callback) {
      const api = await getApi()
      const tracer = api.trace.getTracer('vieval')

      return await tracer.startActiveSpan(name, { attributes: normalizeOpenTelemetryAttributes(attributes) ?? {} }, async (span) => {
        try {
          return await callback()
        }
        catch (error) {
          span.recordException(error)
          span.setStatus({ code: api.SpanStatusCode.ERROR, message: errorMessageFrom(error) ?? 'Unknown error' })
          throw error
        }
        finally {
          span.end()
        }
      })
    },
    addEvent(name, attributes) {
      loadedApi?.trace.getActiveSpan()?.addEvent(name, normalizeOpenTelemetryAttributes(attributes))
    },
    setAttributes(attributes) {
      loadedApi?.trace.getActiveSpan()?.setAttributes(normalizeOpenTelemetryAttributes(attributes) ?? {})
    },
    recordException(error) {
      loadedApi?.trace.getActiveSpan()?.recordException(error)
    },
  }
}
