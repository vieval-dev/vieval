import { describe, expect, it } from 'vitest'

import { buildLocalOtlpProjection } from './report-otlp'

/**
 * @example
 * describe('local OTLP projection') verifies persisted files stay aligned with OTel signal concepts.
 */
describe('local OTLP projection', () => {
  /**
   * @example
   * it('projects case records into trace, log, and metric containers') checks the local OTLP-shaped artifact contract.
   */
  it('projects case records into trace, log, and metric containers', () => {
    const projection = buildLocalOtlpProjection({
      records: [
        {
          attemptId: 'a',
          caseId: 'case-1',
          caseName: 'Case 1',
          durationMs: 10,
          endedAt: '2026-05-08T00:00:00.010Z',
          experimentId: 'e',
          metrics: {
            'benchmark.id': 'locomo',
            'benchmark.nan': Number.NaN,
            'benchmark.tags': ['qa', 1, true],
            // NOTICE:
            // This fixture intentionally simulates a future or malformed metric value.
            // Root cause: local OTLP projection accepts unknown input defensively, while
            // `CaseRecord.metrics` currently narrows persisted values to scalars/arrays.
            // Source/context: Task 6 requires unsupported complex values to be JSON stringified.
            // Removal condition: remove when `CaseRecord` formally supports object metric values.
            'benchmark.unsupported': { nested: true } as unknown as readonly unknown[],
          },
          projectName: 'p',
          retryCount: 0,
          runId: 'run-1',
          schemaVersion: 1,
          scores: { exact: 0.5 },
          startedAt: '2026-05-08T00:00:00.000Z',
          state: 'passed',
          taskId: 'task-1',
          workspaceId: 'w',
        },
      ],
      runId: 'run-1',
    })

    const spans = projection.traces.resourceSpans[0]?.scopeSpans[0]?.spans
    const logRecords = projection.logs.resourceLogs[0]?.scopeLogs[0]?.logRecords
    const metrics = projection.metrics.resourceMetrics[0]?.scopeMetrics[0]?.metrics

    expect(spans?.[0]?.name).toBe('vieval.run')
    expect(spans?.map(span => span.name)).toEqual([
      'vieval.run',
      'vieval.project',
      'vieval.task',
      'vieval.case',
    ])
    expect(spans?.[1]?.attributes).toContainEqual({
      key: 'vieval.project.name',
      value: { stringValue: 'p' },
    })
    expect(spans?.[2]?.attributes).toContainEqual({
      key: 'vieval.task.id',
      value: { stringValue: 'task-1' },
    })
    expect(spans?.[3]?.startTimeUnixNano).toBe('1778198400000000000')
    expect(spans?.[3]?.endTimeUnixNano).toBe('1778198400010000000')
    expect(spans?.[3]?.attributes).toContainEqual({
      key: 'benchmark.unsupported',
      value: { stringValue: '{"nested":true}' },
    })
    expect(spans?.[3]?.attributes).toContainEqual({
      key: 'benchmark.nan',
      value: { stringValue: 'NaN' },
    })
    expect(spans?.[3]?.attributes).toContainEqual({
      key: 'benchmark.tags',
      value: {
        arrayValue: {
          values: [
            { stringValue: 'qa' },
            { doubleValue: 1 },
            { boolValue: true },
          ],
        },
      },
    })
    expect(logRecords?.[0]?.eventName).toBe('vieval.case')
    expect(logRecords?.[0]?.body).toEqual({
      stringValue: JSON.stringify({ caseId: 'case-1', scores: { exact: 0.5 }, state: 'passed' }),
    })
    expect(logRecords?.[0]?.attributes).toContainEqual({
      key: 'benchmark.id',
      value: { stringValue: 'locomo' },
    })
    expect(metrics?.[0]?.name).toBe('vieval.score.exact')
    expect(metrics?.[0]?.gauge.dataPoints[0]).toEqual({
      asDouble: 0.5,
      attributes: expect.arrayContaining([
        {
          key: 'vieval.case.id',
          value: { stringValue: 'case-1' },
        },
        {
          key: 'vieval.task.id',
          value: { stringValue: 'task-1' },
        },
      ]),
      timeUnixNano: '1778198400010000000',
    })
  })

  /**
   * @example
   * it('preserves fractional ISO timestamp precision') checks sub-millisecond traces remain inspectable.
   */
  it('preserves fractional ISO timestamp precision', () => {
    const projection = buildLocalOtlpProjection({
      records: [
        {
          attemptId: 'a',
          caseId: 'case-1',
          caseName: 'Case 1',
          durationMs: 1,
          endedAt: '2026-05-08T00:00:00.123456789Z',
          experimentId: 'e',
          metrics: {},
          projectName: 'p',
          retryCount: 0,
          runId: 'run-1',
          schemaVersion: 1,
          scores: { exact: 1 },
          startedAt: '2026-05-08T00:00:00.123456Z',
          state: 'passed',
          taskId: 'task-1',
          workspaceId: 'w',
        },
      ],
      runId: 'run-1',
    })

    const caseSpan = projection.traces.resourceSpans[0]?.scopeSpans[0]?.spans.find(span => span.name === 'vieval.case')

    expect(caseSpan?.startTimeUnixNano).toBe('1778198400123456000')
    expect(caseSpan?.endTimeUnixNano).toBe('1778198400123456789')
  })

  /**
   * @example
   * it('stringifies non-finite numeric attributes') keeps OTLP JSON valid for defensive inputs.
   */
  it('stringifies non-finite numeric attributes', () => {
    const projection = buildLocalOtlpProjection({
      records: [
        {
          attemptId: 'a',
          caseId: 'case-1',
          caseName: 'Case 1',
          durationMs: 1,
          endedAt: '2026-05-08T00:00:00.000Z',
          experimentId: 'e',
          metrics: {
            'benchmark.array': [Number.NaN, 1],
            'benchmark.infinity': Number.POSITIVE_INFINITY,
            'benchmark.negativeInfinity': Number.NEGATIVE_INFINITY,
          },
          projectName: 'p',
          retryCount: 0,
          runId: 'run-1',
          schemaVersion: 1,
          scores: { exact: 1 },
          startedAt: '2026-05-08T00:00:00.000Z',
          state: 'passed',
          taskId: 'task-1',
          workspaceId: 'w',
        },
      ],
      runId: 'run-1',
    })

    const attributes = projection.traces.resourceSpans[0]?.scopeSpans[0]?.spans.find(span => span.name === 'vieval.case')?.attributes

    expect(attributes).toContainEqual({
      key: 'benchmark.infinity',
      value: { stringValue: 'Infinity' },
    })
    expect(attributes).toContainEqual({
      key: 'benchmark.negativeInfinity',
      value: { stringValue: '-Infinity' },
    })
    expect(attributes).toContainEqual({
      key: 'benchmark.array',
      value: {
        arrayValue: {
          values: [
            { stringValue: 'NaN' },
            { doubleValue: 1 },
          ],
        },
      },
    })
  })
})
