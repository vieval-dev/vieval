import { Buffer } from 'node:buffer'
import { appendFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { cleanupTemporaryDirectories, createEnvelopeFactory, createTemporaryDirectory } from '../../test/helpers'
import { createEventTail, parseEventLine } from './event-tail'

afterEach(cleanupTemporaryDirectories)

describe('createEventTail', () => {
  it('returns only complete lines and keeps a half-written line for the next read', async () => {
    const directory = await createTemporaryDirectory()
    const filePath = join(directory, 'events.jsonl')
    const envelope = createEnvelopeFactory()
    const first = JSON.stringify(envelope('run.started', { totalTasks: 1 }))
    const second = JSON.stringify(envelope('task.queued', { displayName: 'task' }))
    await writeFile(filePath, `${first}\n${second.slice(0, 20)}`)
    const tail = createEventTail(filePath)

    const read1 = await tail.read()
    expect(read1.envelopes.map(item => item.seq)).toEqual([1])
    expect(read1.partialBytes).toBe(20)
    expect(read1.parseErrors).toBe(0)

    await appendFile(filePath, `${second.slice(20)}\n`)
    const read2 = await tail.read()
    expect(read2.envelopes.map(item => item.seq)).toEqual([2])
    expect(read2.partialBytes).toBe(0)

    const read3 = await tail.read()
    expect(read3.envelopes).toEqual([])
  })

  it('keeps a multi-byte character split across two writes intact', async () => {
    const directory = await createTemporaryDirectory()
    const filePath = join(directory, 'events.jsonl')
    const line = JSON.stringify(createEnvelopeFactory()('case.output', { content: '评测完成 ✅', stream: 'stdout' }))
    const bytes = Buffer.from(`${line}\n`)
    const splitAt = bytes.indexOf(Buffer.from('测')) + 1
    await writeFile(filePath, bytes.subarray(0, splitAt))
    const tail = createEventTail(filePath)
    expect((await tail.read()).envelopes).toEqual([])
    await appendFile(filePath, bytes.subarray(splitAt))
    const [envelope] = (await tail.read()).envelopes
    expect((envelope.data as { content: string }).content).toBe('评测完成 ✅')
  })

  it('restarts from the first byte when the file is truncated or replaced', async () => {
    const directory = await createTemporaryDirectory()
    const filePath = join(directory, 'events.jsonl')
    const envelope = createEnvelopeFactory()
    const lines = [envelope('run.started', { totalTasks: 1 }), envelope('task.queued', { displayName: 'a' })].map(item => `${JSON.stringify(item)}\n`)
    await writeFile(filePath, lines.join(''))
    const tail = createEventTail(filePath)
    expect((await tail.read()).envelopes).toHaveLength(2)

    await writeFile(filePath, lines[0])
    const afterTruncate = await tail.read()
    expect(afterTruncate.reset).toBe(true)
    expect(afterTruncate.envelopes.map(item => item.seq)).toEqual([1])

    await rm(filePath)
    await writeFile(filePath, lines.join(''))
    const afterReplace = await tail.read()
    expect(afterReplace.reset).toBe(true)
    expect(afterReplace.envelopes.map(item => item.seq)).toEqual([1, 2])
  })

  /**
   * @example
   * expect(read.unsupportedVersion).toBe(1)
   */
  it('counts invalid lines, reports the schema version of an older vieval, and tolerates a missing file', async () => {
    const directory = await createTemporaryDirectory()
    const filePath = join(directory, 'events.jsonl')
    const tail = createEventTail(filePath)
    expect(await tail.read()).toEqual({ envelopes: [], parseErrors: 0, partialBytes: 0, reset: false })

    await writeFile(filePath, [
      '{not json',
      JSON.stringify({ event: 'x', schemaVersion: 3 }),
      JSON.stringify({ event: 'x', schemaVersion: 4 }),
      JSON.stringify({ attemptId: 'a', data: {}, event: 'RunStarted', experimentId: 'e', runId: 'r', schemaVersion: 1, timestamp: 't', workspaceId: 'w' }),
      JSON.stringify({ event: 'run.started', schemaVersion: 2 }),
      '',
    ].join('\n'))
    const read = await tail.read()
    // The first older line names the version; a newer or malformed line is only a parse error.
    expect(read.unsupportedVersion).toBe(1)
    expect(read.parseErrors).toBe(3)
    expect(read.envelopes).toEqual([])
  })
})

describe('parseEventLine', () => {
  /**
   * @example
   * expect(parseEventLine(JSON.stringify(envelope))).toEqual(envelope)
   */
  it('parses valid version 3 envelopes', () => {
    const envelope = createEnvelopeFactory()('run.started', { totalTasks: 2 })
    expect(parseEventLine(JSON.stringify(envelope))).toEqual(envelope)
  })

  /**
   * @example
   * expect(parseEventLine('{"schemaVersion":2,...}')).toBe(2)
   */
  it('returns the schema version of an envelope written by an older vieval', () => {
    const envelope = { ...createEnvelopeFactory()('score.recorded', { kind: 'exact', score: 1 }), schemaVersion: 2 }
    expect(parseEventLine(JSON.stringify(envelope))).toBe(2)
  })
})
