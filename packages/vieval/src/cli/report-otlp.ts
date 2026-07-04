import type { CaseRecord } from './report-records'

import { stableStringify } from './report-selectors'

/** Local deterministic JSON shape for trace, log, and metric report artifacts. */
export interface LocalOtlpProjection {
  /** OTLP-like log container written to `otlp/logs.json`. */
  logs: {
    resourceLogs: Array<{
      scopeLogs: Array<{
        logRecords: LocalOtlpLogRecord[]
        scope: { name: string }
      }>
    }>
  }
  /** OTLP-like metric container written to `otlp/metrics.json`. */
  metrics: {
    resourceMetrics: Array<{
      scopeMetrics: Array<{
        metrics: LocalOtlpMetric[]
        scope: { name: string }
      }>
    }>
  }
  /** OTLP-like trace container written to `otlp/traces.json`. */
  traces: {
    resourceSpans: Array<{
      scopeSpans: Array<{
        scope: { name: string }
        spans: LocalOtlpSpan[]
      }>
    }>
  }
}

interface LocalOtlpAnyValue {
  arrayValue?: {
    values: LocalOtlpAnyValue[]
  }
  boolValue?: boolean
  doubleValue?: number
  stringValue?: string
}

interface LocalOtlpAttribute {
  key: string
  value: LocalOtlpAnyValue
}

type LocalOtlpAttributeScalar = boolean | null | number | string

interface LocalOtlpLogRecord {
  attributes: LocalOtlpAttribute[]
  body: LocalOtlpAnyValue
  eventName: string
  timeUnixNano: string
}

interface LocalOtlpMetric {
  gauge: {
    dataPoints: Array<{
      asDouble: number
      attributes: LocalOtlpAttribute[]
      timeUnixNano: string
    }>
  }
  name: string
}

interface LocalOtlpSpan {
  attributes: LocalOtlpAttribute[]
  endTimeUnixNano?: string
  name: string
  startTimeUnixNano?: string
}

/**
 * Builds local OTLP-shaped JSON projections from normalized case records.
 *
 * Use when:
 * - writing deterministic report artifacts without requiring an OpenTelemetry Collector
 * - future tools need trace/log/metric-shaped JSON files
 *
 * Expects:
 * - records belong to one Vieval run
 *
 * Returns:
 * - trace, log, and metric containers shaped after OTLP JSON concepts
 */
export function buildLocalOtlpProjection(args: { records: readonly CaseRecord[], runId: string }): LocalOtlpProjection {
  const projectSpans = collectProjectNames(args.records).map(projectName => ({
    attributes: toAttributes({
      'vieval.project.name': projectName,
      'vieval.run.id': args.runId,
    }),
    name: 'vieval.project',
  }))
  const taskSpans = collectTasks(args.records).map(task => ({
    attributes: toAttributes({
      'vieval.project.name': task.projectName,
      'vieval.run.id': args.runId,
      'vieval.task.id': task.taskId,
    }),
    name: 'vieval.task',
  }))
  const caseSpans = args.records.map(record => ({
    attributes: toAttributes({
      ...record.metrics,
      'vieval.case.duration_ms': record.durationMs,
      'vieval.case.id': record.caseId,
      'vieval.case.name': record.caseName,
      'vieval.case.retry_count': record.retryCount,
      'vieval.case.state': record.state,
      'vieval.project.name': record.projectName,
      'vieval.task.id': record.taskId,
    }),
    endTimeUnixNano: isoToUnixNano(record.endedAt),
    name: 'vieval.case',
    startTimeUnixNano: isoToUnixNano(record.startedAt),
  }))

  return {
    logs: {
      resourceLogs: [{
        scopeLogs: [{
          logRecords: args.records.map(record => ({
            attributes: toAttributes(record.metrics),
            body: {
              stringValue: JSON.stringify({
                caseId: record.caseId,
                scores: record.scores,
                state: record.state,
              }),
            },
            eventName: 'vieval.case',
            timeUnixNano: isoToUnixNano(record.endedAt),
          })),
          scope: { name: 'vieval' },
        }],
      }],
    },
    metrics: {
      resourceMetrics: [{
        scopeMetrics: [{
          metrics: collectScoreKinds(args.records).map(kind => ({
            gauge: {
              dataPoints: args.records
                .filter(record => typeof record.scores[kind] === 'number')
                .map(record => ({
                  asDouble: record.scores[kind]!,
                  attributes: toAttributes({
                    ...record.metrics,
                    'vieval.case.id': record.caseId,
                    'vieval.task.id': record.taskId,
                  }),
                  timeUnixNano: isoToUnixNano(record.endedAt),
                })),
            },
            name: `vieval.score.${kind}`,
          })),
          scope: { name: 'vieval' },
        }],
      }],
    },
    traces: {
      resourceSpans: [{
        scopeSpans: [{
          scope: { name: 'vieval' },
          spans: [
            {
              attributes: toAttributes({ 'vieval.run.id': args.runId }),
              name: 'vieval.run',
            },
            ...projectSpans,
            ...taskSpans,
            ...caseSpans,
          ],
        }],
      }],
    },
  }
}

function collectProjectNames(records: readonly CaseRecord[]): string[] {
  return [...new Set(records.map(record => record.projectName))]
    .sort((left, right) => left.localeCompare(right))
}

function collectScoreKinds(records: readonly CaseRecord[]): string[] {
  return [...new Set(records.flatMap(record => Object.keys(record.scores)))]
    .sort((left, right) => left.localeCompare(right))
}

function collectTasks(records: readonly CaseRecord[]): Array<{ projectName: string, taskId: string }> {
  const tasks = new Map<string, { projectName: string, taskId: string }>()
  for (const record of records) {
    tasks.set(`${record.projectName}\0${record.taskId}`, {
      projectName: record.projectName,
      taskId: record.taskId,
    })
  }

  return [...tasks.values()].sort((left, right) => {
    const projectOrder = left.projectName.localeCompare(right.projectName)
    return projectOrder === 0
      ? left.taskId.localeCompare(right.taskId)
      : projectOrder
  })
}

function isAttributeScalar(value: unknown): value is LocalOtlpAttributeScalar {
  return value == null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string'
}

function isoToUnixNano(value: string): string {
  const preciseMatch = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (preciseMatch != null) {
    const [, secondsPart, fraction = '', zone] = preciseMatch
    const unixMilliseconds = Date.parse(`${secondsPart}.000${zone}`)
    if (!Number.isFinite(unixMilliseconds)) {
      return '0'
    }

    // NOTICE: OTLP JSON represents unix nanos as int64. We parse the fractional
    // seconds directly so traces can preserve microsecond/nanosecond precision
    // when upstream event timestamps contain more precision than Date can store.
    return String((BigInt(unixMilliseconds) * 1_000_000n) + BigInt(fraction.padEnd(9, '0').slice(0, 9)))
  }

  const unixMilliseconds = Date.parse(value)
  if (!Number.isFinite(unixMilliseconds)) {
    return '0'
  }

  // NOTICE: OTLP JSON represents unix nanos as int64. We keep strings to avoid
  // JavaScript precision loss above Number.MAX_SAFE_INTEGER.
  return String(BigInt(unixMilliseconds) * 1_000_000n)
}

function toAnyValue(value: unknown): LocalOtlpAnyValue {
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(item => toAnyValue(item)),
      },
    }
  }

  if (isAttributeScalar(value)) {
    if (typeof value === 'boolean') {
      return { boolValue: value }
    }

    if (typeof value === 'number') {
      return Number.isFinite(value)
        ? { doubleValue: value }
        : { stringValue: String(value) }
    }

    if (value == null) {
      return { stringValue: 'null' }
    }

    return { stringValue: value }
  }

  return { stringValue: stableStringify(value) }
}

function toAttributes(attributes: Record<string, unknown>): LocalOtlpAttribute[] {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => ({
      key,
      value: toAnyValue(value),
    }))
}
