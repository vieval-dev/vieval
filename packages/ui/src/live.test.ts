import type { CaseDetail, LogsResponse, RunListItem, RunSnapshot, TimelineResponse } from './shared/contract'

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runVievalCli } from 'vieval/cli'
import { afterEach, describe, expect, it } from 'vitest'

import * as v from 'valibot'

import { cleanupTemporaryDirectories, createTemporaryDirectory, readSse } from '../test/helpers'
import { startViewer } from './index'
import { caseDetailSchema, runSnapshotSchema } from './shared/contract'

afterEach(cleanupTemporaryDirectories)

// The project imports the built `vieval` entry by absolute path, like a user project resolves `vieval`.
const vievalEntry = fileURLToPath(import.meta.resolve('vieval')).replaceAll('\\', '/')

/**
 * A project shaped like a real benchmark: a `{ model, repeat }` matrix, console output, an artifact of each
 * previewable kind, an external evidence directory, one case retried (`autoRetry`), and one task re-run
 * (`autoAttempt`).
 */
async function createProject(): Promise<{ evidenceDirectory: string, projectDirectory: string }> {
  const projectDirectory = await createTemporaryDirectory('vieval-viewer-live-')
  const evidenceDirectory = join(projectDirectory, '.vieval', 'episodes', 'flaky')
  await mkdir(join(projectDirectory, 'evals'), { recursive: true })
  await mkdir(evidenceDirectory, { recursive: true })
  await writeFile(join(evidenceDirectory, 'result.json'), JSON.stringify({ podName: 'pod-flaky', status: 'evaluated', taskId: 'flaky' }))
  await writeFile(join(projectDirectory, 'vieval.config.ts'), `
import { defineConfig } from '${vievalEntry}'

export default defineConfig({
  models: [{ aliases: [], id: 'mock:model-a', inferenceExecutor: 'mock', inferenceExecutorId: 'mock:model-a', model: 'model-a' }],
  projects: [{
    concurrency: { case: 3, task: 1 },
    include: ['evals/*.eval.ts'],
    name: 'live-demo',
    root: '.',
    runMatrix: { extend: { model: ['model-a'], repeat: [1] } },
  }],
})
`)
  await writeFile(join(projectDirectory, 'evals', 'demo.eval.ts'), `
import process from 'node:process'
import { existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { caseOf, describeTask } from '${vievalEntry}'

// The test creates this file once it has seen the run in progress; the slow case waits for it.
const gate = ${JSON.stringify(join(projectDirectory, 'release-slow-case'))}

const runs = new Map<string, number>()
const count = (name: string) => {
  const value = (runs.get(name) ?? 0) + 1
  runs.set(name, value)
  return value
}

// Vitest replaces \`console\` in its workers, so the streams are written directly; \`console.log\` takes the same
// path in a real \`vieval run\`.
describeTask('demo', () => {
  caseOf('slow/artifacts', async (context) => {
    process.stdout.write('slow case started\\n')
    while (!existsSync(gate)) {
      await delay(20)
    }
    await context.recordArtifact('rows.jsonl', { body: '{"step":1}\\n{"step":2}\\n', contentType: 'application/jsonl' })
    await context.recordArtifact('page.html', { body: '<h1>report</h1><script>alert(1)</script>', contentType: 'text/html' })
    await context.recordArtifact('config.yaml', { body: 'model: a\\n', contentType: 'application/yaml' })
    context.recordMetric('latency_ms', 42)
    context.recordScore(0.75)
    process.stderr.write('slow case done\\n')
  }, { autoAttempt: 1 })

  caseOf('flaky/attempt', async (context) => {
    const run = count('attempt')
    context.recordMetric('demo.evidence', ${JSON.stringify(evidenceDirectory)})
    context.recordMetric('demo.pod', 'pod-flaky')
    if (run === 1) {
      throw new Error('first full attempt fails')
    }
  }, { autoAttempt: 1 })

  caseOf('flaky/retry', async () => {
    const run = count('retry')
    if (run % 2 === 1) {
      throw new Error('first try of each attempt fails')
    }
  }, { autoRetry: 1, autoRetryDelay: 10 })
})
`)
  return { evidenceDirectory, projectDirectory }
}

describe('--with-viewer: in-process run on the event bus', () => {
  it('serves a run attached through onRunReady while it runs and after it ended', async () => {
    const { projectDirectory } = await createProject()
    const reportRoot = join(projectDirectory, '.vieval', 'reports')
    const host = await startViewer({ host: '127.0.0.1', mode: 'live', open: false, port: 0, reportRoots: [reportRoot] })
    const api = async <T>(path: string): Promise<T> => {
      const response = await fetch(new URL(path, host.url))
      if (!response.ok) {
        throw new Error(`${path} -> ${response.status} ${await response.text()}`)
      }
      return await response.json() as T
    }
    try {
      let runKey: string | undefined
      const running = runVievalCli({
        configFilePath: join(projectDirectory, 'vieval.config.ts'),
        cwd: projectDirectory,
        async onRunReady(context) {
          runKey = context.identity.runId
          return host.attachRun(context)
        },
      })

      // While the slow case sleeps, the run is served from the bus. With auto attempts, vieval announces the
      // `case.ended` of a round once the whole round settled, so every case of round 0 is still running.
      // ROOT CAUSE:
      //
      // The slow case used to sleep 1500 ms, and this loop had to observe the run inside that window. Under a
      // loaded machine (the whole workspace suite in parallel) the window passed before the poll, and the run was
      // already `ended`.
      //
      // We fixed this by making the slow case wait for a gate file that the test creates after the observation.
      let during: RunSnapshot | undefined
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline && during?.current.running.length !== 3) {
        await new Promise(resolve => setTimeout(resolve, 50))
        if (runKey != null) {
          during = await api<RunSnapshot>(`/api/runs/${runKey}/snapshot`)
        }
      }
      await writeFile(join(projectDirectory, 'release-slow-case'), '')
      expect(during?.source).toBe('live-bus')
      expect(during?.state).toBe('running')
      expect(during?.current.running.map(entry => entry.name).sort()).toEqual(['flaky/attempt', 'flaky/retry', 'slow/artifacts'])
      expect(during?.current.running.every(entry => entry.roundIndex === 0)).toBe(true)
      const stream = await fetch(new URL(`/api/runs/${runKey}/stream?after=${during!.seq}`, host.url))
      const streaming = readSse(stream, messages => messages.some(message => message.event === 'end'), 20_000)

      await running
      const messages = await streaming
      expect(messages.filter(message => message.event === 'run-event').length).toBeGreaterThan(5)
      expect(messages.at(-1)?.event).toBe('end')

      const snapshot = v.parse(runSnapshotSchema, await api(`/api/runs/${runKey}/snapshot`))
      expect(snapshot.source).toBe('live-bus')
      expect(snapshot.state).toBe('ended')
      expect(snapshot.summary?.caseSummary).toBeDefined()
      const [task] = snapshot.tasks
      expect(task.matrix?.run).toEqual({ model: 'model-a', repeat: '1' })
      expect(task.roundCount).toBe(2)
      const byName = Object.fromEntries(task.cases.map(node => [node.name, node]))
      expect(byName['flaky/attempt'].rounds.map(round => [round.roundIndex, round.state, round.roundIndexInferred])).toEqual([[0, 'errored', false], [1, 'passed', false]])
      expect(byName['flaky/retry'].rounds.map(round => round.tries.map(entry => `${entry.retryIndex}:${entry.state}`))).toEqual([['0:retried', '1:passed'], ['0:retried', '1:passed']])
      expect(byName['slow/artifacts'].scores).toEqual({ exact: 0.75 })

      // The run is listed once, from the bus, even though its report directory exists too.
      const runs = await api<RunListItem[]>('/api/runs')
      expect(runs.filter(item => item.runKey === runKey).map(item => item.source)).toEqual(['live-bus'])

      const timeline = await api<TimelineResponse>(`/api/runs/${runKey}/timeline`)
      // The first attempt of `flaky/attempt` threw a plain error: a case without a result, not a wrong one.
      expect(timeline.rounds[0].rounds.map(round => [round.roundIndex, round.passed, round.failed, round.errored])).toEqual([[0, 2, 0, 1], [1, 3, 0, 0]])

      const logs = await api<LogsResponse>(`/api/runs/${runKey}/logs`)
      expect(logs.lines.map(line => [line.stream, line.text])).toEqual(expect.arrayContaining([['stdout', 'slow case started'], ['stderr', 'slow case done']]))

      const slow = byName['slow/artifacts']
      const detail = v.parse(caseDetailSchema, await api<CaseDetail>(`/api/runs/${runKey}/case?taskId=${encodeURIComponent(task.id)}&caseId=${encodeURIComponent(slow.caseId)}`))
      expect(detail.artifacts.map(artifact => [artifact.name, artifact.previewKind]).sort()).toEqual(
        [['config.yaml', 'yaml'], ['config.yaml', 'yaml'], ['page.html', 'html'], ['page.html', 'html'], ['rows.jsonl', 'jsonl'], ['rows.jsonl', 'jsonl']],
      )
      const jsonl = detail.artifacts.find(artifact => artifact.name === 'rows.jsonl')!
      const page = await api<{ rows: unknown[], totalLines: number }>(`/api/runs/${runKey}/artifacts/jsonl?path=${encodeURIComponent(jsonl.path)}&limit=1`)
      expect(page).toMatchObject({ rows: [{ step: 1 }], totalLines: 2 })
      const html = await fetch(new URL(`/api/runs/${runKey}/artifacts/raw?path=${encodeURIComponent(detail.artifacts.find(artifact => artifact.name === 'page.html')!.path)}`, host.url))
      expect(html.headers.get('content-security-policy')).toMatch(/^sandbox;/)

      const flaky = byName['flaky/attempt']
      const flakyDetail = await api<CaseDetail>(`/api/runs/${runKey}/case?taskId=${encodeURIComponent(task.id)}&caseId=${encodeURIComponent(flaky.caseId)}`)
      expect(flakyDetail.evidence.map(link => [link.metricName, link.allowed, link.kind])).toEqual([['demo.evidence', true, 'directory']])
    }
    finally {
      await host.close()
      await host.waitUntilClosed()
    }
  }, 60_000)
})
