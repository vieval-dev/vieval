import type { OtelLogsResponse, OtelMetricsResponse, OtelSpan, OtelTracesResponse } from '../shared/contract'
import type { RunHandle } from './store'

import { createHash } from 'node:crypto'

import { buildProjectNodes, buildTaskNodes } from '../shared/reduce'

/**
 * Log records: case output lines, case failures, inference failures, and run interruption.
 */
export function buildOtelLogs(handle: RunHandle): OtelLogsResponse {
  const reducer = handle.reducer()
  const runId = reducer.identity()?.runId ?? handle.runKey
  const records: OtelLogsResponse['records'] = []
  for (const line of reducer.logs) {
    records.push({
      attributes: { 'vieval.case.id': line.caseId, 'vieval.log.stream': line.stream, 'vieval.task.id': line.taskId },
      body: line.text,
      severity: line.stream === 'stderr' ? 'WARN' : 'INFO',
      spanId: line.taskId != null && line.caseId != null ? hash(`case:${runId}:${line.taskId}\u0000${line.caseId}:${line.roundIndex ?? 0}`, 16) : undefined,
      time: line.time,
    })
  }
  for (const envelope of reducer.events) {
    const data = envelope.data as Record<string, unknown>
    if (envelope.event === 'case.ended' && data?.state !== 'passed' && typeof data?.errorMessage === 'string') {
      records.push({ attributes: { 'vieval.case.id': envelope.caseId, 'vieval.case.state': data.state, 'vieval.task.id': envelope.taskId }, body: data.errorMessage, severity: 'ERROR', time: envelope.time })
    }
    else if (envelope.event === 'inference.failed') {
      records.push({ attributes: { 'vieval.case.id': envelope.caseId, 'vieval.task.id': envelope.taskId }, body: String(data?.error ?? 'inference failed'), severity: 'ERROR', time: envelope.time })
    }
    else if (envelope.event === 'run.interrupted') {
      records.push({ attributes: { 'vieval.run.id': runId }, body: `Run interrupted by ${String(data?.signal)}`, severity: 'WARN', time: envelope.time })
    }
  }
  records.sort((left, right) => left.time.localeCompare(right.time))
  return { records, source: 'events' }
}

/**
 * Gauges: every numeric metric, case scores, and case durations.
 */
export function buildOtelMetrics(handle: RunHandle): OtelMetricsResponse {
  const reducer = handle.reducer()
  const series = new Map<string, OtelMetricsResponse['metrics'][number]['dataPoints']>()
  const push = (name: string, point: OtelMetricsResponse['metrics'][number]['dataPoints'][number]) => {
    const points = series.get(name)
    if (points == null) {
      series.set(name, [point])
    }
    else {
      points.push(point)
    }
  }
  for (const metric of reducer.metrics) {
    if (typeof metric.value === 'number' && Number.isFinite(metric.value)) {
      push(metric.name, { attributes: { 'vieval.case.id': metric.caseId, 'vieval.task.id': metric.taskId }, time: metric.time, value: metric.value })
    }
  }
  for (const reduced of reducer.cases.values()) {
    for (const round of reduced.rounds) {
      const attributes = { 'vieval.case.id': reduced.caseId, 'vieval.case.round_index': round.roundIndex, 'vieval.task.id': reduced.taskId }
      if (round.endedAt != null) {
        push('vieval.case.duration_ms', { attributes, time: round.endedAt, value: Date.parse(round.endedAt) - Date.parse(round.startedAt) })
      }
      for (const kind of ['exact', 'judge'] as const) {
        const value = round.scores[kind]
        if (value != null) {
          push(`vieval.case.score.${kind}`, { attributes, time: round.endedAt ?? round.startedAt, value })
        }
      }
    }
  }
  return {
    metrics: [...series].map(([name, dataPoints]) => ({ dataPoints, name, type: 'gauge' as const })).sort((left, right) => left.name.localeCompare(right.name)),
    source: 'events',
  }
}

/**
 * Simple OTEL-shaped views of one run, rebuilt from its events.
 *
 * Limits (by design): no OTLP receiver, no user-defined spans, no cross-process trace correlation, no sampling or
 * querying. The span tree mirrors the `vieval.run` → `vieval.project` → `vieval.task` → `vieval.case` spans the
 * runtime creates when OpenTelemetry is enabled, plus round and try levels.
 */
export function buildOtelTraces(handle: RunHandle): OtelTracesResponse {
  const reducer = handle.reducer()
  const identity = reducer.identity()
  const run = reducer.run()
  const runId = identity?.runId ?? handle.runKey
  const traceId = hash(`trace:${runId}`, 32)
  const spans: OtelSpan[] = []
  const runSpanId = hash(`run:${runId}`, 16)
  spans.push({
    attributes: {
      'vieval.attempt.id': identity?.attemptId,
      'vieval.experiment.id': identity?.experimentId,
      'vieval.run.id': runId,
      'vieval.workspace.id': identity?.workspaceId,
    },
    endTime: run.endedAt,
    kind: 'run',
    name: 'vieval.run',
    spanId: runSpanId,
    startTime: run.startedAt,
    status: run.terminated ? (run.interruptSignal == null ? 'ok' : 'error') : 'unset',
  })
  const projectSpanIds = new Map<string, string>()
  for (const project of buildProjectNodes(reducer)) {
    const spanId = hash(`project:${runId}:${project.id}`, 16)
    projectSpanIds.set(project.id, spanId)
    spans.push({
      attributes: { 'vieval.project.name': project.id },
      endTime: project.endedAt,
      kind: 'project',
      name: 'vieval.project',
      parentSpanId: runSpanId,
      spanId,
      startTime: project.startedAt,
      status: project.endedAt == null ? 'unset' : project.failed === true ? 'error' : 'ok',
    })
  }
  for (const task of buildTaskNodes(reducer, () => 0)) {
    const taskSpanId = hash(`task:${runId}:${task.id}`, 16)
    spans.push({
      attributes: { 'vieval.task.display_name': task.displayName, 'vieval.task.id': task.id, 'vieval.task.score.exact': task.scores.exact },
      endTime: task.endedAt,
      kind: 'task',
      name: 'vieval.task',
      parentSpanId: projectSpanIds.get(task.projectId) ?? runSpanId,
      spanId: taskSpanId,
      startTime: task.startedAt,
      status: task.state === 'passed' ? 'ok' : task.state === 'failed' ? 'error' : 'unset',
    })
    const multiRound = task.roundCount > 1
    const roundSpanIds = new Set<string>()
    for (const node of task.cases) {
      for (const round of node.rounds) {
        let parentSpanId = taskSpanId
        if (multiRound) {
          parentSpanId = hash(`round:${runId}:${task.id}:${round.roundIndex}`, 16)
          if (!roundSpanIds.has(parentSpanId)) {
            roundSpanIds.add(parentSpanId)
            spans.push({ attributes: { 'vieval.round.index': round.roundIndex, 'vieval.task.id': task.id }, kind: 'round', name: 'vieval.round', parentSpanId: taskSpanId, spanId: parentSpanId, startTime: round.startedAt, status: 'unset' })
          }
        }
        const caseSpanId = hash(`case:${runId}:${node.key}:${round.roundIndex}`, 16)
        spans.push({
          attributes: { 'vieval.case.id': node.caseId, 'vieval.case.name': node.name, 'vieval.case.round_index': round.roundIndex, 'vieval.case.state': round.state, ...(round.scores.exact == null ? {} : { 'vieval.case.score.exact': round.scores.exact }) },
          endTime: round.endedAt,
          kind: 'case',
          name: 'vieval.case',
          parentSpanId,
          spanId: caseSpanId,
          startTime: round.startedAt,
          status: round.state === 'passed' ? 'ok' : round.state === 'running' ? 'unset' : 'error',
        })
        if (round.tries.length > 1) {
          for (const entry of round.tries) {
            spans.push({
              attributes: { 'vieval.case.retry_index': entry.retryIndex, 'vieval.case.state': entry.state },
              endTime: entry.endedAt,
              kind: 'try',
              name: 'vieval.case.try',
              parentSpanId: caseSpanId,
              spanId: hash(`try:${runId}:${node.key}:${round.roundIndex}:${entry.retryIndex}`, 16),
              startTime: entry.startedAt,
              status: entry.state === 'passed' ? 'ok' : entry.state === 'running' ? 'unset' : 'error',
            })
          }
        }
      }
    }
  }
  // Round spans end with their last case.
  const childrenOf = Map.groupBy(spans, span => span.parentSpanId)
  for (const span of spans) {
    if (span.kind === 'round') {
      const children = childrenOf.get(span.spanId) ?? []
      const ends = children.map(child => child.endTime).filter((value): value is string => value != null).sort()
      span.endTime = children.every(child => child.endTime != null) ? ends.at(-1) : undefined
    }
  }
  return { source: 'events', spans, traceId }
}

function hash(value: string, length: number): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length)
}
