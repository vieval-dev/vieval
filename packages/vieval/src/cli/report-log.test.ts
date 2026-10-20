import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createRunEventBus } from '../core/runner/event-bus'
import { metricRecorded, runStarted } from '../events'
import { createReportEventLog, readReportEvents } from './report-log'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async directory => rm(directory, { force: true, recursive: true })))
})

function createBus() {
  return createRunEventBus({ attemptId: 'attempt-1', experimentId: 'experiment-1', runId: 'run-1', workspaceId: 'workspace-1' })
}

async function createLogPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'vieval-report-log-'))
  temporaryDirectories.push(directory)
  return join(directory, 'nested', 'events.jsonl')
}

/**
 * @example
 * describe('createReportEventLog', () => {})
 */
describe('createReportEventLog', () => {
  /**
   * @example
   * it('appends bus envelopes as they are emitted and reads them back in order', async () => {})
   */
  it('appends bus envelopes as they are emitted and reads them back in order', async () => {
    const filePath = await createLogPath()
    const log = createReportEventLog(filePath)
    const bus = createBus()
    bus.onAny(envelope => log.append(envelope))

    await bus.emit(runStarted, { totalTasks: 1 })
    await bus.scope({ caseId: 'case-1', taskId: 'task-1' }).emit(metricRecorded, { name: 'steps', value: 3 })
    await log.close()

    /**
     * @example
     * expect((await readFile(filePath, 'utf-8')).split('\n')).toHaveLength(3)
     */
    expect((await readFile(filePath, 'utf-8')).split('\n')).toHaveLength(3)
    /**
     * @example
     * expect(readReportEvents(filePath).map(event => [event.event, event.caseId])).toEqual([['run.started', undefined], ['metric.recorded', 'case-1']])
     */
    expect(readReportEvents(filePath).map(event => [event.event, event.caseId])).toEqual([['run.started', undefined], ['metric.recorded', 'case-1']])
    /**
     * @example
     * expect(readReportEvents(filePath).map(event => event.seq)).toEqual([1, 2])
     */
    expect(readReportEvents(filePath).map(event => event.seq)).toEqual([1, 2])
  })

  /**
   * @example
   * it('ignores events appended after close and tolerates repeated close calls', async () => {})
   */
  it('ignores events appended after close and tolerates repeated close calls', async () => {
    const filePath = await createLogPath()
    const log = createReportEventLog(filePath)
    const bus = createBus()
    bus.onAny(envelope => log.append(envelope))

    await bus.emit(runStarted, { totalTasks: 1 })
    await log.close()
    await bus.emit(runStarted, { totalTasks: 2 })
    await log.close()

    /**
     * @example
     * expect(readReportEvents(filePath).map(event => event.data)).toEqual([{ totalTasks: 1 }])
     */
    expect(readReportEvents(filePath).map(event => event.data)).toEqual([{ totalTasks: 1 }])
  })
})

/**
 * @example
 * describe('readReportEvents', () => {})
 */
describe('readReportEvents', () => {
  /**
   * @example
   * it('reads a missing log as an empty event list', async () => {})
   */
  it('reads a missing log as an empty event list', async () => {
    /**
     * @example
     * expect(readReportEvents(await createLogPath())).toEqual([])
     */
    expect(readReportEvents(await createLogPath())).toEqual([])
  })

  /**
   * @example
   * it('rejects a log of event schema version 2 as written by an older vieval, with its line number', async () => {})
   */
  it('rejects a log of event schema version 2 as written by an older vieval, with its line number', async () => {
    const filePath = join(await mkdtemp(join(tmpdir(), 'vieval-report-log-')), 'events.jsonl')
    temporaryDirectories.push(join(filePath, '..'))
    const olderEnvelope = { attemptId: 'a', caseId: 'c', data: { kind: 'exact', score: 1 }, event: 'score.recorded', experimentId: 'e', runId: 'r', schemaVersion: 2, seq: 1, taskId: 't', time: '2026-10-20T00:00:00.000Z', workspaceId: 'w' }
    await writeFile(filePath, `${JSON.stringify(olderEnvelope)}\n`, 'utf-8')

    /**
     * @example
     * expect(() => readReportEvents(filePath)).toThrow('This report was written by an older vieval. Run it again.')
     */
    expect(() => readReportEvents(filePath)).toThrow('This report was written by an older vieval. Run it again.')
    expect(() => readReportEvents(filePath)).toThrow(`${filePath}:1`)
  })

  /**
   * @example
   * it('rejects a line that is not an event envelope with its line number', async () => {})
   */
  it('rejects a line that is not an event envelope with its line number', async () => {
    const filePath = join(await mkdtemp(join(tmpdir(), 'vieval-report-log-')), 'events.jsonl')
    temporaryDirectories.push(join(filePath, '..'))
    await writeFile(filePath, `${JSON.stringify({ event: 'run.started' })}\n`, 'utf-8')

    /**
     * @example
     * expect(() => readReportEvents(filePath)).toThrow(`Unsupported event record at ${filePath}:1`)
     */
    expect(() => readReportEvents(filePath)).toThrow(`Unsupported event record at ${filePath}:1`)
  })
})
