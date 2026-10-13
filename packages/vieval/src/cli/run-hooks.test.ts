import type { RunEventEnvelope } from '../events'
import type { CaseRecord } from './report-records'
import type { RunReadyContext } from './viewer-host'

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { runVievalCli } from './run'

const packageDirectory = fileURLToPath(new URL('../../', import.meta.url))
const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
const temporaryDirectories: string[] = []

/**
 * Creates a project shaped like the OSWorld benchmark: a `{ model, repeat }` run matrix, cases generated from
 * task inputs, an `*.evidence` metric that points at an external directory, and `autoAttempt` on flaky tasks.
 */
async function createOsworldStyleProject(): Promise<string> {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'vieval-osworld-style-'))
  temporaryDirectories.push(projectDirectory)
  await mkdir(join(projectDirectory, 'evals'), { recursive: true })
  await writeFile(join(projectDirectory, 'vieval.config.ts'), `
import { defineConfig } from '${vievalImportPath}'

export default defineConfig({
  models: [{ aliases: [], id: 'mock:model-a', inferenceExecutor: 'mock', inferenceExecutorId: 'mock:model-a', model: 'model-a' }],
  projects: [{
    scheduler: { concurrency: { case: 2, task: 1 } },
    include: ['evals/*.eval.ts'],
    name: 'osworld-style',
    root: '.',
    runMatrix: { extend: { model: ['model-a'], repeat: [1] } },
  }],
})
`, 'utf-8')
  await writeFile(join(projectDirectory, 'evals', 'osworld.eval.ts'), `
import { describeTask } from '${vievalImportPath}'

const runsByTask = new Map<string, number>()

describeTask('osworld', (task) => {
  task.casesFromInputs('chrome', [{ id: 'stable-task' }, { id: 'flaky-task' }], async (context) => {
    const input = context.matrix.inputs
    const runs = (runsByTask.get(input.id) ?? 0) + 1
    runsByTask.set(input.id, runs)
    context.recordMetric('osworld.evidence', '/episodes/' + input.id + '/r' + runs)
    if (input.id === 'flaky-task' && runs === 1) {
      throw new Error('vm did not boot')
    }
  }, { autoAttempt: 1 })
})
`, 'utf-8')

  return projectDirectory
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  return (await readFile(filePath, 'utf-8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as T)
}

describe('runVievalCli onRunReady', () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.map(async directory => await rm(directory, { force: true, recursive: true })))
    temporaryDirectories.length = 0
  })

  it('hands the bus and run identity to the host before the first event and disposes it after the reports are written', async () => {
    const projectDirectory = await createOsworldStyleProject()
    const received: RunEventEnvelope[] = []
    const contexts: RunReadyContext[] = []
    let filesAtDispose: undefined | { cases: boolean, events: boolean, summary: boolean }

    const output = await runVievalCli({
      attempt: 'attempt-hook',
      configFilePath: join(projectDirectory, 'vieval.config.ts'),
      cwd: projectDirectory,
      experiment: 'exp-hook',
      onRunReady(context) {
        contexts.push(context)
        context.bus.onAny(envelope => received.push(envelope))
        return () => {
          filesAtDispose = {
            cases: existsSync(join(context.reportDirectory!, 'cases.jsonl')),
            events: existsSync(join(context.reportDirectory!, 'events.jsonl')),
            summary: existsSync(join(context.reportDirectory!, 'run-summary.json')),
          }
        }
      },
      workspace: 'ws-hook',
    })

    const reportRoot = join(projectDirectory, '.vieval', 'reports')
    expect(contexts).toHaveLength(1)
    expect(contexts[0]).toMatchObject({
      artifactsRoot: join(output.reportDirectory!, 'artifacts'),
      configFilePath: join(projectDirectory, 'vieval.config.ts'),
      identity: { attemptId: 'attempt-hook', experimentId: 'exp-hook', runId: output.runId, workspaceId: 'ws-hook' },
      projectNames: ['osworld-style'],
      reportDirectory: output.reportDirectory,
      reportRoot,
    })
    // The host sees the whole run, from `run.started` (seq 1) to `run.ended`, exactly as written to `events.jsonl`.
    const logged = await readJsonl<RunEventEnvelope>(join(output.reportDirectory!, 'events.jsonl'))
    expect(received[0]?.event).toBe('run.started')
    expect(received[0]?.seq).toBe(1)
    expect(received.at(-1)?.event).toBe('run.ended')
    expect(received).toEqual(logged)
    expect(filesAtDispose).toEqual({ cases: true, events: true, summary: true })
  })

  it('keeps the run result when the host fails to attach', async () => {
    const projectDirectory = await createOsworldStyleProject()
    const baseline = await runVievalCli({
      configFilePath: join(projectDirectory, 'vieval.config.ts'),
      cwd: projectDirectory,
      report: false,
    })

    const output = await runVievalCli({
      configFilePath: join(projectDirectory, 'vieval.config.ts'),
      cwd: projectDirectory,
      onRunReady() {
        throw new Error('port in use')
      },
      report: false,
    })

    expect(output.projects[0]?.caseSummary).toEqual(baseline.projects[0]?.caseSummary)
    expect(output.projects[0]?.result?.overall).toEqual(baseline.projects[0]?.result?.overall)
  })

  it('passes null report locations with reports disabled', async () => {
    const projectDirectory = await createOsworldStyleProject()
    let context: RunReadyContext | undefined

    await runVievalCli({
      configFilePath: join(projectDirectory, 'vieval.config.ts'),
      cwd: projectDirectory,
      onRunReady(readyContext) {
        context = readyContext
      },
      report: false,
    })

    expect(context?.reportDirectory).toBeNull()
    expect(context?.reportRoot).toBeNull()
    expect(context?.artifactsRoot).toContain('vieval-artifacts-')
  })
})

describe('runVievalCli auto attempt reports', () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.map(async directory => await rm(directory, { force: true, recursive: true })))
    temporaryDirectories.length = 0
  })

  it('writes attemptIndex to events.jsonl and projects every auto attempt into cases.jsonl with consistent run identity', async () => {
    const projectDirectory = await createOsworldStyleProject()

    const output = await runVievalCli({
      attempt: 'attempt-label',
      configFilePath: join(projectDirectory, 'vieval.config.ts'),
      cwd: projectDirectory,
      experiment: 'exp-osworld',
    })

    const reportDirectory = output.reportDirectory!
    const events = await readJsonl<RunEventEnvelope<Record<string, unknown>>>(join(reportDirectory, 'events.jsonl'))
    const caseEvents = events.filter(event => event.event === 'case.started' || event.event === 'case.ended')
    const cases = await readJsonl<CaseRecord>(join(reportDirectory, 'cases.jsonl'))
    const summary = JSON.parse(await readFile(join(reportDirectory, 'run-summary.json'), 'utf-8')) as Record<string, unknown>
    const traces = JSON.parse(await readFile(join(reportDirectory, 'otlp', 'traces.json'), 'utf-8')) as {
      resourceSpans: Array<{ resource: { attributes: Array<{ key: string, value: { stringValue?: string } }> } }>
    }

    expect(caseEvents.map(event => [event.event, event.caseId, event.data.attemptIndex, event.data.autoAttempt])).toEqual([
      ['case.started', '0:chrome%20%231', 0, 1],
      ['case.started', '1:chrome%20%232', 0, 1],
      ['case.ended', '0:chrome%20%231', 0, 1],
      ['case.ended', '1:chrome%20%232', 0, 1],
      ['case.started', '0:chrome%20%231', 1, 1],
      ['case.started', '1:chrome%20%232', 1, 1],
      ['case.ended', '0:chrome%20%231', 1, 1],
      ['case.ended', '1:chrome%20%232', 1, 1],
    ])
    expect(events.every(event => event.schemaVersion === 2)).toBe(true)

    const flaky = cases.find(record => record.caseName === 'chrome #2')
    expect(flaky).toMatchObject({ attemptIndex: 1, autoAttempt: 1, retryCount: 0, state: 'passed' })
    expect(flaky?.metrics['osworld.evidence']).toBe('/episodes/flaky-task/r2')
    expect(flaky?.attempts?.map(attempt => [attempt.attemptIndex, attempt.state, attempt.errorMessage])).toEqual([
      [0, 'failed', 'vm did not boot'],
      [1, 'passed', undefined],
    ])

    // The same four ids identify the run in every artifact.
    const identity = { attemptId: 'attempt-label', experimentId: 'exp-osworld', runId: output.runId, workspaceId: 'default-workspace' }
    expect(summary).toMatchObject(identity)
    for (const event of events) {
      expect(event).toMatchObject(identity)
    }
    for (const record of cases) {
      expect(record).toMatchObject(identity)
    }
    expect(traces.resourceSpans[0]?.resource.attributes).toEqual([
      { key: 'vieval.attempt.id', value: { stringValue: identity.attemptId } },
      { key: 'vieval.experiment.id', value: { stringValue: identity.experimentId } },
      { key: 'vieval.run.id', value: { stringValue: identity.runId } },
      { key: 'vieval.workspace.id', value: { stringValue: identity.workspaceId } },
    ])
    expect(reportDirectory.endsWith(join('default-workspace', 'osworld-style', 'exp-osworld', 'attempt-label', output.runId!))).toBe(true)
  })
})
