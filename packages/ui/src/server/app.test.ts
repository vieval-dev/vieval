import type { GenericSchema } from 'valibot'

import { Buffer } from 'node:buffer'
import { appendFile, mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import * as v from 'valibot'

import {
  cleanupTemporaryDirectories,
  copyOsworldFixture,
  createTemporaryDirectory,
  createTestApp,
  OSWORLD_RUNS,
  OSWORLD_TASK_ID,
  readRunningContinuation,
  readSse,
} from '../../test/helpers'
import {
  caseDetailSchema,
  comparisonResponseSchema,
  errorResponseSchema,
  eventsResponseSchema,
  evidenceLinkSchema,
  externalLogsResponseSchema,
  fileTreeResponseSchema,
  jsonlPageSchema,
  logsResponseSchema,
  matrixResponseSchema,
  metricsResponseSchema,
  otelLogsResponseSchema,
  otelMetricsResponseSchema,
  otelTracesResponseSchema,
  progressResponseSchema,
  runListItemSchema,
  runSnapshotSchema,
  scoresResponseSchema,
  screenshotTimelineSchema,
  taskNodeSchema,
  timelineResponseSchema,
  treeResponseSchema,
} from '../shared/contract'

afterEach(cleanupTemporaryDirectories)

const RUNNING = 'run-1791747103580-dd3a8517'
const ARCHIVED = 'run-1791746045991-a77ba0a4'
const LEGACY = 'run-1791656450009-5299b70e'
const FAILED_CASE = '1:chrome%2F06fe7178-4491-4589-810f-2e2bc9502122'
/** Shortly after the last event of the running fixture (19:39:57Z), so the run is `running`, not `stale`. */
const NOW = Date.parse('2026-10-11T19:45:00.000Z')

function expectSchema<T>(schema: GenericSchema<unknown, T>, value: unknown): T {
  const result = v.safeParse(schema, value)
  if (!result.success) {
    throw new Error(`Response does not match the contract: ${JSON.stringify(v.flatten(result.issues))}`)
  }
  return result.output
}

const q = encodeURIComponent

async function setup() {
  const { reportRoot, vievalDirectory } = await copyOsworldFixture()
  return { ...createTestApp({ now: () => NOW, reportRoots: [reportRoot], vievalDirectory }), reportRoot, vievalDirectory }
}

describe('viewer API on the OSWorld report root (real data)', () => {
  it('organizes runs as workspace → project → experiment → attempt → run', async () => {
    const { json } = await setup()
    const tree = expectSchema(treeResponseSchema, await json('/api/tree'))
    expect(tree.workspaces.map(workspace => workspace.id)).toEqual(['default-workspace'])
    const [project] = tree.workspaces[0].projects
    expect(project.id).toBe('osworld-kubernetes')
    expect(project.experiments.map(experiment => experiment.id)).toEqual(['matrix-run-model-gpt-5.5-repeat-1'])
    const attempts = project.experiments[0].attempts
    expect(attempts.map(attempt => [attempt.id, attempt.runs.map(run => [run.runKey, run.source, run.state])])).toEqual([
      ['attempt-2026-10-10T18-20-50-009Z', [[LEGACY, 'legacy', 'legacy']]],
      ['attempt-2026-10-11T19-14-05-991Z', [[ARCHIVED, 'offline', 'interrupted']]],
      ['attempt-2026-10-11T19-31-43-580Z', [[RUNNING, 'live-tail', 'running']]],
    ])
  })

  it('lists runs with counts and scores that match run-summary.json', async () => {
    const { json } = await setup()
    const runs = (await json<unknown[]>('/api/runs')).map(item => expectSchema(runListItemSchema, item))
    const byKey = Object.fromEntries(runs.map(run => [run.runKey, run]))
    // An archived report written before `errored` existed counts every failure as `failed`.
    expect(byKey[ARCHIVED].counts).toEqual({ errored: 0, failed: 7, passed: 11, running: 0, skipped: 0, timeout: 0, total: 18 })
    expect(byKey[ARCHIVED].exactAverage).toBeCloseTo(0.6111111111111112, 12)
    expect(byKey[ARCHIVED].reportPath).toBe(OSWORLD_RUNS.archived)
    expect(byKey[LEGACY].counts).toMatchObject({ failed: 1, passed: 2, total: 3 })
    expect(byKey[LEGACY].exactAverage).toBeCloseTo(2 / 3, 12)
    expect(byKey[RUNNING].counts).toEqual({ errored: 0, failed: 2, passed: 4, running: 8, skipped: 0, timeout: 0, total: 14 })
    expect(byKey[RUNNING].lastSeq).toBe(150)
    expect(byKey[RUNNING].matrix).toEqual({ model: ['gpt-5.5'], repeat: ['1'] })
    expect(byKey[LEGACY].matrix).toEqual({ model: ['gpt-5.5'], repeat: ['1'] })
    expect((await json<unknown[]>('/api/runs?state=running')).length).toBe(1)
    expect((await json<unknown[]>('/api/runs?attempt=attempt-2026-10-11T19-14-05-991Z')).length).toBe(1)
  })

  it('returns the execution tree, current position, and ETA of the running run', async () => {
    const { json } = await setup()
    const snapshot = expectSchema(runSnapshotSchema, await json(`/api/runs/${RUNNING}/snapshot`))
    expect(snapshot.source).toBe('live-tail')
    expect(snapshot.state).toBe('running')
    expect(snapshot.seq).toBe(150)
    expect(snapshot.identity).toEqual({ attemptId: 'attempt-2026-10-11T19-31-43-580Z', experimentId: 'matrix-run-model-gpt-5.5-repeat-1', runId: RUNNING, workspaceId: 'default-workspace' })
    expect(snapshot.projects.map(project => [project.id, project.state, project.taskIds])).toEqual([['osworld-kubernetes', 'running', [OSWORLD_TASK_ID]]])
    const [task] = snapshot.tasks
    expect(task.displayName).toBe('osworld [model=gpt-5.5, repeat=1]')
    expect(task.matrix?.run).toEqual({ model: 'gpt-5.5', repeat: '1' })
    expect(task.caseTotal).toBe(345)
    expect(task.caseCounts).toMatchObject({ failed: 2, passed: 4, running: 8, total: 14 })
    expect(task.cases.filter(node => node.evidenceLinkCount === 1)).toHaveLength(6)
    expect(snapshot.current.running).toHaveLength(8)
    expect(snapshot.current.lastEvent).toEqual({ event: 'metric.recorded', seq: 150, time: '2026-10-11T19:39:57.837Z' })
    expect(snapshot.progress.basis).toBe('cases')
    expect(snapshot.progress.cases).toEqual({ completed: 6, estimatedTotal: 345, knownTotal: 345, running: 8 })
    const elapsed = NOW - Date.parse('2026-10-11T19:31:43.581Z')
    expect(snapshot.progress.elapsedMs).toBe(elapsed)
    expect(snapshot.progress.estimatedTotalMs).toBe(Math.round(elapsed / 6 * 345))
    expect(snapshot.progress.etaMs).toBe(Math.round(elapsed / 6 * 345) - elapsed)

    const progress = expectSchema(progressResponseSchema, await json(`/api/runs/${RUNNING}/progress`))
    expect(progress.progress).toEqual(snapshot.progress)
  })

  /**
   * @example
   * expect(history.at(-1)).toEqual({ completed: 6, elapsedMs: elapsed })
   */
  it('returns the completed-cases history of the running run, from the start to now', async () => {
    const { json } = await setup()
    const { history } = expectSchema(runSnapshotSchema, await json(`/api/runs/${RUNNING}/snapshot`)).progress
    const elapsed = NOW - Date.parse('2026-10-11T19:31:43.581Z')
    expect(history[0]).toEqual({ completed: 0, elapsedMs: 0 })
    expect(history.at(-1)).toEqual({ completed: 6, elapsedMs: elapsed })
    // One point per settled case between the start and now.
    expect(history.map(point => point.completed)).toEqual([0, 1, 2, 3, 4, 5, 6, 6])
    for (let index = 1; index < history.length; index += 1) {
      expect(history[index].elapsedMs).toBeGreaterThanOrEqual(history[index - 1].elapsedMs)
    }

    const legacy = expectSchema(runSnapshotSchema, await json(`/api/runs/${LEGACY}/snapshot`)).progress
    expect(legacy.history.at(-1)).toEqual({ completed: 3, elapsedMs: legacy.elapsedMs })
  })

  /**
   * @example
   * expect(matrix.cells[0].latest.runKey).toBe(RUNNING)
   */
  it('returns the matrix of a project: one cell per matrix row, latest run and history across attempts', async () => {
    const { json } = await setup()
    const matrix = expectSchema(matrixResponseSchema, await json('/api/matrix?workspace=default-workspace&project=osworld-kubernetes'))
    expect(matrix.runCount).toBe(3)
    expect(matrix.axes.filter(axis => axis.kind === 'run')).toEqual([
      { kind: 'run', name: 'model', values: ['gpt-5.5'] },
      { kind: 'run', name: 'repeat', values: ['1'] },
    ])
    expect(matrix.cells).toHaveLength(1)
    const [cell] = matrix.cells
    expect(cell.run).toEqual({ model: 'gpt-5.5', repeat: '1' })
    expect(cell.latest).toMatchObject({ attemptId: 'attempt-2026-10-11T19-31-43-580Z', runKey: RUNNING, state: 'running', taskId: OSWORLD_TASK_ID })
    expect(cell.latest.counts).toMatchObject({ failed: 2, passed: 4, running: 8, total: 14 })
    expect(cell.history.map(point => point.runKey)).toEqual([LEGACY, ARCHIVED, RUNNING])
    expect(cell.history[1].exact).toBeCloseTo(0.6111111111111112, 12)

    // Filters narrow the scope like `/api/runs`; an unknown workspace is an empty matrix, no filter is every run.
    expect(expectSchema(matrixResponseSchema, await json('/api/matrix?workspace=other')).cells).toEqual([])
    expect(expectSchema(matrixResponseSchema, await json('/api/matrix')).runCount).toBe(3)
  })

  it('returns task, case detail with input, metrics, scores, and evidence of a finished run', async () => {
    const { json } = await setup()
    const snapshot = expectSchema(runSnapshotSchema, await json(`/api/runs/${ARCHIVED}/snapshot`))
    expect(snapshot.state).toBe('interrupted')
    expect(snapshot.interruptSignal).toBe('SIGINT')
    expect(snapshot.summary).toMatchObject({ caseSummary: { failed: 7, passed: 11, total: 18 } })
    expect(snapshot.progress.basis).toBe('ended')

    const task = expectSchema(taskNodeSchema, await json(`/api/runs/${ARCHIVED}/task?taskId=${q(OSWORLD_TASK_ID)}`))
    // vieval ends this task as `passed` (it did not throw); the viewer shows it `failed` because 7 cases failed.
    expect(task.state).toBe('failed')
    expect(task.caseCounts).toMatchObject({ failed: 7, passed: 11 })
    expect(task.cases).toHaveLength(18)

    const detail = expectSchema(caseDetailSchema, await json(`/api/runs/${ARCHIVED}/case?taskId=${q(OSWORLD_TASK_ID)}&caseId=${q(FAILED_CASE)}`))
    expect(detail.name).toBe('chrome/06fe7178-4491-4589-810f-2e2bc9502122')
    expect(detail.state).toBe('failed')
    expect(detail.errorMessage).toBe('expected +0 to be 1 // Object.is equality')
    expect(detail.durationMs).toBe(Date.parse('2026-10-11T19:16:32.903Z') - Date.parse('2026-10-11T19:14:05.993Z'))
    expect((detail.input as { task: { id: string } }).task.id).toBe('06fe7178-4491-4589-810f-2e2bc9502122')
    expect(detail.metrics.find(metric => metric.name === 'osworld.pod')?.value).toBe('osworld-06fe7178-624029')
    expect(detail.evidence).toHaveLength(1)
    expect(detail.evidence[0]).toMatchObject({ adapter: 'osworld', allowed: true, exists: true, kind: 'directory', metricName: 'osworld.evidence' })
    expect(detail.evidence[0].summary).toMatchObject({ podName: 'osworld-06fe7178-624029', status: 'evaluated', taskId: '06fe7178-4491-4589-810f-2e2bc9502122' })
  })

  it('serves the evidence directory: tree, screenshot timeline, Range reads, and JSONL pages', async () => {
    const { get, json } = await setup()
    const links = (await json<unknown[]>(`/api/runs/${ARCHIVED}/evidence?caseId=${q(FAILED_CASE)}`)).map(item => expectSchema(evidenceLinkSchema, item))
    const [link] = links
    const tree = expectSchema(fileTreeResponseSchema, await json(`/api/runs/${ARCHIVED}/evidence/${link.id}/tree`))
    expect(tree.entries.filter(entry => entry.kind === 'file').map(entry => [entry.path, entry.previewKind])).toEqual([
      ['auv-runs/artifacts/ef8e83be-bb57-3c0c-d366-3c2add975efe/01a12c64-f338-757a-a79a-76ca615a4ca3.webp', 'image'],
      ['auv-runs/records.jsonl', 'jsonl'],
      ['bridge-evaluate.log', 'text'],
      ['result.json', 'json'],
    ])

    const timeline = expectSchema(screenshotTimelineSchema, await json(`/api/runs/${ARCHIVED}/evidence/${link.id}/timeline`))
    expect(timeline.frames).toHaveLength(1)
    expect(timeline.frames[0]).toMatchObject({ contentType: 'image/webp', purpose: 'auv.driver.display_capture' })

    const image = await get(`/api/runs/${ARCHIVED}/evidence/${link.id}/raw?path=${q(timeline.frames[0].path)}`, { headers: { range: 'bytes=0-11' } })
    expect(image.status).toBe(206)
    expect(image.headers.get('content-type')).toBe('image/webp')
    expect(image.headers.get('content-range')).toMatch(/^bytes 0-11\/\d+$/)
    const bytes = Buffer.from(await image.arrayBuffer())
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF')
    expect(bytes.subarray(8, 12).toString()).toBe('WEBP')

    const page = expectSchema(jsonlPageSchema, await json(`/api/runs/${ARCHIVED}/evidence/${link.id}/jsonl?path=${q('auv-runs/records.jsonl')}&offset=0&limit=1`))
    expect(page.totalLines).toBe(2)
    expect(page.rows).toHaveLength(1)
  })

  it('correlates .vieval/logs/*.jsonl lines by case id, pod, and the case time window', async () => {
    const { json } = await setup()
    const logs = expectSchema(externalLogsResponseSchema, await json(`/api/runs/${ARCHIVED}/case/external-logs?taskId=${q(OSWORLD_TASK_ID)}&caseId=${q(FAILED_CASE)}&limit=500`))
    expect(logs.correlation.keys).toContain('06fe7178-4491-4589-810f-2e2bc9502122')
    expect(logs.correlation.podNames).toEqual(['osworld-06fe7178-624029'])
    // 22 lines of its pod + 2 without a pod; the two `$fixture` decoys (other pod, outside the window) are dropped.
    expect(logs.total).toBe(24)
    expect(logs.lines.some(line => JSON.stringify(line.record).includes('$fixture'))).toBe(false)
    expect(logs.files.map(file => [file.path.split('/').at(-1), file.matched])).toEqual([['run-20261012-mcp-agent-b.jsonl', 24]])

    const page = expectSchema(externalLogsResponseSchema, await json(`/api/runs/${ARCHIVED}/case/external-logs?taskId=${q(OSWORLD_TASK_ID)}&caseId=${q(FAILED_CASE)}&limit=10&offset=20`))
    expect(page.lines).toHaveLength(4)
    expect(page.nextOffset).toBeNull()
  })

  it('returns scores, metrics, timeline, events, and logs', async () => {
    const { json } = await setup()
    const scores = expectSchema(scoresResponseSchema, await json(`/api/runs/${ARCHIVED}/scores`))
    expect(scores.overall.exact).toBeCloseTo(11 / 18, 12)
    expect(scores.summary?.exact).toBeCloseTo(0.6111111111111112, 12)
    expect(scores.byRound).toHaveLength(1)
    expect(scores.cases).toHaveLength(18)

    const metrics = expectSchema(metricsResponseSchema, await json(`/api/runs/${ARCHIVED}/metrics`))
    expect(metrics.numeric.find(metric => metric.name === 'osworld.agent.steps')?.summary.count).toBe(15)
    expect(metrics.nonNumeric.map(metric => metric.name)).toContain('osworld.evidence')

    const timeline = expectSchema(timelineResponseSchema, await json(`/api/runs/${ARCHIVED}/timeline`))
    expect(timeline.entries).toHaveLength(18)
    expect(timeline.rounds[0].rounds).toEqual([{ endedAt: '2026-10-11T19:31:24.492Z', errored: 0, failed: 7, passed: 11, roundIndex: 0, running: 0, startedAt: '2026-10-11T19:14:05.993Z' }])

    const events = expectSchema(eventsResponseSchema, await json(`/api/runs/${ARCHIVED}/events?after=250&limit=3`))
    expect(events.events.map(envelope => envelope.seq)).toEqual([251, 252, 253])
    expect(events.nextAfter).toBe(253)
    expect(events.seq).toBe(257)

    // OSWorld records no console output through vieval.
    expect(expectSchema(logsResponseSchema, await json(`/api/runs/${ARCHIVED}/logs`)).total).toBe(0)
  })

  it('compares attempts of one experiment and experiments of one project', async () => {
    const { json } = await setup()
    const attempts = expectSchema(comparisonResponseSchema, await json('/api/compare/attempts?workspace=default-workspace&project=osworld-kubernetes&experiment=matrix-run-model-gpt-5.5-repeat-1'))
    expect(attempts.columns.map(column => column.id)).toEqual([LEGACY, ARCHIVED, RUNNING])
    const row = attempts.rows.find(candidate => candidate.caseName === 'chrome/06fe7178-4491-4589-810f-2e2bc9502122')
    expect(row?.cells[ARCHIVED]).toEqual({ exact: 0, roundCount: 1, state: 'failed' })
    expect(attempts.summary.rows).toBeGreaterThan(18)

    const experiments = expectSchema(comparisonResponseSchema, await json('/api/compare/experiments?workspace=default-workspace&project=osworld-kubernetes'))
    expect(experiments.columns.map(column => [column.id, column.runs.length])).toEqual([['matrix-run-model-gpt-5.5-repeat-1', 3]])

    const runs = expectSchema(comparisonResponseSchema, await json(`/api/compare/runs?runs=${ARCHIVED},${RUNNING}`))
    expect(runs.columns.map(column => column.id)).toEqual([ARCHIVED, RUNNING])
    expect(runs.summary.changed).toBeGreaterThan(0)
  })

  it('returns OTEL-shaped traces, logs, and metrics, and the raw otlp files', async () => {
    const { get, json } = await setup()
    const traces = expectSchema(otelTracesResponseSchema, await json(`/api/runs/${ARCHIVED}/otel/traces`))
    expect(traces.spans.filter(span => span.kind === 'case')).toHaveLength(18)
    expect(traces.spans.find(span => span.kind === 'run')?.status).toBe('error')
    const logs = expectSchema(otelLogsResponseSchema, await json(`/api/runs/${ARCHIVED}/otel/logs`))
    expect(logs.records.filter(record => record.severity === 'ERROR')).toHaveLength(7)
    const metrics = expectSchema(otelMetricsResponseSchema, await json(`/api/runs/${ARCHIVED}/otel/metrics`))
    expect(metrics.metrics.map(metric => metric.name)).toContain('vieval.case.duration_ms')
    const raw = await get(`/api/runs/${ARCHIVED}/otel/raw/traces`)
    expect(raw.status).toBe(200)
    expect((await raw.json() as { resourceSpans: unknown[] }).resourceSpans).toHaveLength(1)
    expect((await get(`/api/runs/${RUNNING}/otel/raw/traces`)).status).toBe(404)
  })
})

describe('live tail of a run another process is writing', () => {
  it('picks up appended lines (including a line split across writes), drops duplicates, and pushes them over SSE', async () => {
    const { get, json, reportRoot, vievalDirectory } = await setup()
    const eventsPath = join(reportRoot, OSWORLD_RUNS.running, 'events.jsonl')
    const continuation = await readRunningContinuation(vievalDirectory)

    const stream = await get(`/api/runs/${RUNNING}/stream?after=150`)
    expect(stream.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    const reading = readSse(stream, messages => messages.filter(message => message.event === 'run-event').length >= 20)

    // A writer flushes one and a half lines, then the rest.
    const chunk = `${continuation.slice(0, 10).join('\n')}\n${continuation[10].slice(0, 40)}`
    await appendFile(eventsPath, chunk)
    await new Promise(resolve => setTimeout(resolve, 1200))
    await appendFile(eventsPath, `${continuation[10].slice(40)}\n${continuation.slice(11, 20).join('\n')}\n`)

    const messages = await reading
    const seqs = messages.filter(message => message.event === 'run-event').map(message => Number(message.id))
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, index) => 151 + index))
    expect(messages.some(message => message.event === 'progress')).toBe(true)

    const snapshot = expectSchema(runSnapshotSchema, await json(`/api/runs/${RUNNING}/snapshot`))
    expect(snapshot.seq).toBe(170)
    expect(snapshot.parseErrors).toBe(0)
    expect(snapshot.seqGaps).toBe(0)

    // The same lines again (a writer retrying) do not create events twice.
    await appendFile(eventsPath, `${continuation.slice(15, 20).join('\n')}\n`)
    const again = expectSchema(runSnapshotSchema, await json(`/api/runs/${RUNNING}/snapshot`))
    expect(again.seq).toBe(170)
    expect(again.eventCounts['case.started']).toBe(snapshot.eventCounts['case.started'])
  })

  it('resumes a stream from Last-Event-ID and ends it when the run ends', async () => {
    const { get, reportRoot, vievalDirectory } = await setup()
    const eventsPath = join(reportRoot, OSWORLD_RUNS.running, 'events.jsonl')
    const continuation = await readRunningContinuation(vievalDirectory)
    const resumed = await readSse(await get(`/api/runs/${RUNNING}/stream`, { headers: { 'last-event-id': '147' } }), messages => messages.length >= 4, 2000)
    expect(resumed.filter(message => message.event === 'run-event').map(message => message.id)).toEqual(['148', '149', '150'])

    const stream = await get(`/api/runs/${RUNNING}/stream?after=150`)
    const reading = readSse(stream, messages => messages.some(message => message.event === 'end'))
    const last = JSON.parse(continuation.at(-1)!) as { seq: number }
    const ended = { ...last, data: { failedTasks: 0, passedTasks: 0, skippedTasks: 0, totalTasks: 1 }, event: 'run.ended', seq: last.seq + 1, time: '2026-10-11T20:00:00.000Z' }
    await appendFile(eventsPath, `${continuation.join('\n')}\n${JSON.stringify(ended)}\n`)
    const messages = await reading
    const end = messages.find(message => message.event === 'end')
    expect(JSON.parse(end!.data)).toEqual({ seq: 251, state: 'ended' })
    expect(messages.filter(message => message.event === 'run-event')).toHaveLength(101)
  })
})

describe('errors and security boundaries', () => {
  it('answers unknown runs, tasks, cases, routes, and bad parameters with JSON errors, without logging them', async () => {
    const { get } = await setup()
    // Request errors must not print stack traces into the terminal of a `vieval run --with-viewer`.
    const consoleError = vi.spyOn(console, 'error')
    const cases: Array<[string, number]> = [
      ['/api/runs/run-missing/snapshot', 404],
      [`/api/runs/${ARCHIVED}/task?taskId=missing`, 404],
      [`/api/runs/${ARCHIVED}/task`, 400],
      [`/api/runs/${ARCHIVED}/case?taskId=${q(OSWORLD_TASK_ID)}&caseId=missing`, 404],
      [`/api/runs/${ARCHIVED}/artifacts?taskId=missing`, 404],
      [`/api/runs/${ARCHIVED}/artifacts?taskId=${q(OSWORLD_TASK_ID)}&caseId=missing`, 404],
      [`/api/runs/${ARCHIVED}/evidence?caseId=missing`, 404],
      [`/api/runs/${ARCHIVED}/logs?taskId=missing`, 404],
      [`/api/runs/${ARCHIVED}/metrics?caseId=missing`, 404],
      [`/api/runs/${ARCHIVED}/timeline?taskId=missing`, 404],
      [`/api/runs/${ARCHIVED}/events?after=-1`, 400],
      [`/api/runs/${ARCHIVED}/events?limit=abc`, 400],
      [`/api/runs/${ARCHIVED}/events?limit=999999`, 400],
      [`/api/runs/${ARCHIVED}/logs?stream=stdin`, 400],
      [`/api/runs/${ARCHIVED}/otel/raw/spans`, 400],
      [`/api/runs/${ARCHIVED}/evidence/0000000000000000/tree`, 404],
      ['/api/compare/attempts?workspace=default-workspace', 400],
      [`/api/compare/runs?runs=${ARCHIVED}`, 400],
      ['/api/nope', 404],
    ]
    for (const [path, status] of cases) {
      const response = await get(path)
      expect([path, response.status]).toEqual([path, status])
      expectSchema(errorResponseSchema, await response.json())
    }
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('refuses path traversal out of the artifacts root and the evidence directory', async () => {
    const { get, json, reportRoot } = await setup()
    const runDirectory = join(reportRoot, OSWORLD_RUNS.archived)
    await mkdir(join(runDirectory, 'artifacts', 'task', 'case'), { recursive: true })
    await writeFile(join(runDirectory, 'artifacts', 'task', 'case', 'ok.txt'), 'ok')
    await symlink(join(runDirectory, 'run-summary.json'), join(runDirectory, 'artifacts', 'task', 'case', 'link-out.json'))

    expect((await get(`/api/runs/${ARCHIVED}/artifacts/raw?path=${q('task/case/ok.txt')}`)).status).toBe(200)
    for (const path of ['../run-summary.json', 'task/../../events.jsonl', '/etc/passwd', 'task/case/link-out.json', '..%2Frun-summary.json']) {
      const response = await get(`/api/runs/${ARCHIVED}/artifacts/raw?path=${q(path)}`)
      expect([path, response.status]).toEqual([path, path.startsWith('..%2F') ? 404 : 403])
    }
    expect((await get(`/api/runs/${ARCHIVED}/artifacts/jsonl?path=${q('../events.jsonl')}`)).status).toBe(403)

    const [link] = await json<Array<{ id: string }>>(`/api/runs/${ARCHIVED}/evidence?caseId=${q(FAILED_CASE)}`)
    for (const path of ['../../../reports', '../../06fe7178-4491-4589-810f-2e2bc9502122', '/etc/hosts']) {
      expect((await get(`/api/runs/${ARCHIVED}/evidence/${link.id}/raw?path=${q(path)}`)).status).toBe(403)
    }
  })

  it('marks evidence outside the allowed roots as not allowed and never serves it', async () => {
    const { reportRoot } = await copyOsworldFixture()
    const outside = await createTemporaryDirectory('vieval-outside-')
    await writeFile(join(outside, 'result.json'), '{"taskId":"x","podName":"p"}')
    // Same data, but the viewer only allows a directory that does not contain the episodes.
    const { get, json } = createTestApp({ now: () => NOW, reportRoots: [reportRoot], vievalDirectory: outside })
    const [link] = (await json<unknown[]>(`/api/runs/${ARCHIVED}/evidence?caseId=${q(FAILED_CASE)}`)).map(item => expectSchema(evidenceLinkSchema, item))
    expect(link.allowed).toBe(false)
    expect(link.summary).toBeUndefined()
    expect(link.reason).toMatch(/outside the allowed evidence roots/)
    expect((await get(`/api/runs/${ARCHIVED}/evidence/${link.id}/tree`)).status).toBe(403)
    expect((await get(`/api/runs/${ARCHIVED}/evidence/${link.id}/raw?path=result.json`)).status).toBe(403)
  })

  // ROOT CAUSE:
  //
  // The web UI bundle was served through `serveFile`, which gives every HTML file the artifact policy
  // `Content-Security-Policy: sandbox; default-src 'none'`. The browser then refused the UI's own scripts and
  // stylesheet and showed a blank page.
  //
  // We fixed this by serving the UI with `trusted: true` (a same-origin CSP), while artifacts keep `sandbox`.
  it('serves the web UI with a same-origin CSP while HTML artifacts stay sandboxed', async () => {
    const { reportRoot } = await copyOsworldFixture()
    const clientDirectory = await createTemporaryDirectory()
    await mkdir(join(clientDirectory, 'assets'))
    await writeFile(join(clientDirectory, 'index.html'), '<!doctype html><script type="module" src="./assets/app.js"></script>')
    await writeFile(join(clientDirectory, 'assets', 'app.js'), 'document.body.dataset.ok = "1"')
    const runDirectory = join(reportRoot, OSWORLD_RUNS.archived)
    await mkdir(join(runDirectory, 'artifacts', 'task', 'case'), { recursive: true })
    await writeFile(join(runDirectory, 'artifacts', 'task', 'case', 'page.html'), '<script>alert(1)</script>')
    const { get } = createTestApp({ clientDirectory, reportRoots: [reportRoot] })

    for (const path of ['/', '/assets/app.js', '/some/spa/route']) {
      const csp = (await get(path)).headers.get('content-security-policy') ?? ''
      expect([path, csp.includes('sandbox'), csp.includes('script-src \'self\'')]).toEqual([path, false, true])
    }
    const artifact = await get(`/api/runs/${ARCHIVED}/artifacts/raw?path=${q('task/case/page.html')}`)
    expect(artifact.headers.get('content-security-policy')).toMatch(/^sandbox;/)
  })

  it('rejects requests whose Host header is not a loopback name (DNS rebinding)', async () => {
    const { app } = await setup()
    const response = await app.fetch(new Request('http://localhost/api/health', { headers: { host: 'evil.example:51204' } }))
    expect(response.status).toBe(403)
    expect((await app.fetch(new Request('http://127.0.0.1/api/health'))).status).toBe(200)
  })

  it('reports invalid lines of a tailed log without failing the run', async () => {
    const { json, reportRoot } = await setup()
    await appendFile(join(reportRoot, OSWORLD_RUNS.running, 'events.jsonl'), '{"broken":\n')
    const snapshot = expectSchema(runSnapshotSchema, await json(`/api/runs/${RUNNING}/snapshot`))
    expect(snapshot.parseErrors).toBe(1)
    expect(snapshot.seq).toBe(150)
  })
})
