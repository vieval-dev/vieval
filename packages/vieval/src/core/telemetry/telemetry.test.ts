import type { TelemetryAttributes } from './types'

import { describe, expect, it, vi } from 'vitest'

import { createNoopTelemetryRuntime } from './noop'
import { createOpenTelemetryRuntime } from './otel'

interface TestSpan {
  addEvent: (name: string, attributes?: Record<string, unknown>) => void
  end: () => void
  recordException: (error: unknown) => void
  setAttributes: (attributes: Record<string, unknown>) => void
  setStatus: (status: { code: number, message?: string }) => void
}

function createTestSpan(): TestSpan {
  return {
    addEvent: vi.fn((_name: string, _attributes?: Record<string, unknown>) => {}),
    end: vi.fn(() => {}),
    recordException: vi.fn((_error: unknown) => {}),
    setAttributes: vi.fn((_attributes: Record<string, unknown>) => {}),
    setStatus: vi.fn((_status: { code: number, message?: string }) => {}),
  }
}

/**
 * @example
 * describe('telemetry runtime') verifies no-op execution and OpenTelemetry span behavior.
 */
describe('telemetry runtime', () => {
  /**
   * @example
   * it('runs callbacks through the noop runtime exactly once') ensures disabled telemetry does not fork runtime behavior.
   */
  it('runs callbacks through the noop runtime exactly once', async () => {
    const telemetry = createNoopTelemetryRuntime()
    const callback = vi.fn(async () => 'result')

    const result = await telemetry.withSpan('vieval.case', { 'vieval.case.id': 'case-1' }, callback)

    expect(result).toBe('result')
    expect(callback).toHaveBeenCalledTimes(1)
  })

  /**
   * @example
   * it('adds events and attributes to the active OpenTelemetry span') verifies active-span integration without a real SDK.
   */
  it('adds events and attributes to the active OpenTelemetry span', async () => {
    const span = createTestSpan()
    const tracer = {
      startActiveSpan: vi.fn(async (_name, _options, callback) => await callback(span)),
    }
    const api = {
      SpanStatusCode: { ERROR: 2 },
      trace: {
        getActiveSpan: vi.fn(() => span),
        getTracer: vi.fn(() => tracer),
      },
    }
    const telemetry = createOpenTelemetryRuntime({ importApi: async () => api })

    const result = await telemetry.withSpan('vieval.case', { 'vieval.case.id': 'case-1' }, async () => {
      telemetry.addEvent('vieval.case.metric', { name: 'benchmark.id', value: 'locomo' })
      telemetry.setAttributes({ 'vieval.case.state': 'passed' })
      return 'ok'
    })

    expect(result).toBe('ok')
    expect(api.trace.getTracer).toHaveBeenCalledWith('vieval')
    expect(tracer.startActiveSpan).toHaveBeenCalledTimes(1)
    expect(span.addEvent).toHaveBeenCalledWith('vieval.case.metric', { name: 'benchmark.id', value: 'locomo' })
    expect(span.setAttributes).toHaveBeenCalledWith({ 'vieval.case.state': 'passed' })
    expect(span.end).toHaveBeenCalledTimes(1)
  })

  /**
   * @example
   * it('records exceptions and marks failed spans') ensures thrown case errors are visible to OTel exporters.
   */
  it('records exceptions and marks failed spans', async () => {
    const error = new Error('case failed')
    const span = createTestSpan()
    const tracer = {
      startActiveSpan: vi.fn(async (_name, _options, callback) => await callback(span)),
    }
    const api = {
      SpanStatusCode: { ERROR: 2 },
      trace: {
        getActiveSpan: vi.fn(() => span),
        getTracer: vi.fn(() => tracer),
      },
    }
    const telemetry = createOpenTelemetryRuntime({ importApi: async () => api })

    await expect(telemetry.withSpan('vieval.case', {}, async () => {
      throw error
    })).rejects.toThrow('case failed')

    expect(span.recordException).toHaveBeenCalledWith(error)
    expect(span.setStatus).toHaveBeenCalledWith({ code: api.SpanStatusCode.ERROR, message: 'case failed' })
    expect(span.end).toHaveBeenCalledTimes(1)
  })

  /**
   * @example
   * it('normalizes JSON-compatible attributes before starting OpenTelemetry spans') verifies local report values are adapted to OTel limits.
   */
  it('normalizes JSON-compatible attributes before starting OpenTelemetry spans', async () => {
    const span = createTestSpan()
    const tracer = {
      startActiveSpan: vi.fn(async (_name, _options, callback) => await callback(span)),
    }
    const api = {
      SpanStatusCode: { ERROR: 2 },
      trace: {
        getActiveSpan: vi.fn(() => span),
        getTracer: vi.fn(() => tracer),
      },
    }
    const telemetry = createOpenTelemetryRuntime({ importApi: async () => api })

    await telemetry.withSpan('vieval.case', {
      missing: undefined,
      mixedArray: ['a', 1, true],
      nested: ['a', [1, null]],
      nil: null,
      scalar: 'case-1',
      scalarArray: ['a', 'b'],
    }, async () => undefined)

    expect(tracer.startActiveSpan).toHaveBeenCalledWith('vieval.case', {
      attributes: {
        mixedArray: JSON.stringify(['a', 1, true]),
        nested: JSON.stringify(['a', [1, null]]),
        scalar: 'case-1',
        scalarArray: ['a', 'b'],
      },
    }, expect.any(Function))
  })

  /**
   * @example
   * it('normalizes JSON-compatible attributes before mutating active OpenTelemetry spans') verifies event and span attributes share one OTel policy.
   */
  it('normalizes JSON-compatible attributes before mutating active OpenTelemetry spans', async () => {
    const span = createTestSpan()
    const tracer = {
      startActiveSpan: vi.fn((_name, _options, callback) => callback(span)),
    }
    const api = {
      SpanStatusCode: { ERROR: 2 },
      trace: {
        getActiveSpan: vi.fn(() => span),
        getTracer: vi.fn(() => tracer),
      },
    }
    const telemetry = createOpenTelemetryRuntime({ importApi: async () => api })

    await telemetry.withSpan('vieval.case', {}, async () => {
      telemetry.addEvent('vieval.case.metric', {
        missing: undefined,
        mixedArray: ['a', 1, false],
        nested: ['a', [1, null]],
        nil: null,
        scalar: 1,
        scalarArray: ['a', 'b'],
      })
      telemetry.setAttributes({
        objectLike: { unexpected: true },
        scalarArray: [1, 2, 3],
      } as unknown as TelemetryAttributes)
    })

    expect(span.addEvent).toHaveBeenCalledWith('vieval.case.metric', {
      mixedArray: JSON.stringify(['a', 1, false]),
      nested: JSON.stringify(['a', [1, null]]),
      scalar: 1,
      scalarArray: ['a', 'b'],
    })
    expect(span.setAttributes).toHaveBeenCalledWith({
      objectLike: JSON.stringify({ unexpected: true }),
      scalarArray: [1, 2, 3],
    })
  })

  /**
   * @example
   * it('does not import OpenTelemetry from synchronous event calls before a span exists') prevents fire-and-forget import rejections.
   */
  it('does not import OpenTelemetry from synchronous event calls before a span exists', async () => {
    const importApi = vi.fn(async () => {
      throw new Error('sync telemetry methods must not import')
    })
    const telemetry = createOpenTelemetryRuntime({ importApi })

    telemetry.addEvent('vieval.case.metric', { value: 'locomo' })
    telemetry.setAttributes({ 'vieval.case.state': 'passed' })
    telemetry.recordException(new Error('case failed'))
    await Promise.resolve()

    expect(importApi).not.toHaveBeenCalled()
  })

  /**
   * @example
   * it('mutates the active span synchronously while the callback is running') catches deferred mutations that lose active context.
   */
  it('mutates the active span synchronously while the callback is running', async () => {
    const span = createTestSpan()
    let callbackIsActive = false
    const tracer = {
      startActiveSpan: vi.fn((_name, _options, callback) => {
        callbackIsActive = true
        const result = callback(span)
        callbackIsActive = false
        return result
      }),
    }
    const api = {
      SpanStatusCode: { ERROR: 2 },
      trace: {
        getActiveSpan: vi.fn(() => callbackIsActive ? span : undefined),
        getTracer: vi.fn(() => tracer),
      },
    }
    const telemetry = createOpenTelemetryRuntime({ importApi: async () => api })

    await telemetry.withSpan('vieval.case', {}, async () => {
      telemetry.addEvent('vieval.case.metric', { value: 'locomo' })
      telemetry.setAttributes({ 'vieval.case.state': 'passed' })
      expect(span.addEvent).toHaveBeenCalledWith('vieval.case.metric', { value: 'locomo' })
      expect(span.setAttributes).toHaveBeenCalledWith({ 'vieval.case.state': 'passed' })
    })

    expect(api.trace.getActiveSpan).toHaveBeenCalledTimes(2)
  })
})
