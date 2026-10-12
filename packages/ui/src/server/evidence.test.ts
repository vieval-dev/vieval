import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { cleanupTemporaryDirectories, createEnvelopeFactory, createTemporaryDirectory } from '../../test/helpers'
import { createRunReducer } from '../shared/reduce'
import { createEvidenceService } from './evidence'

afterEach(cleanupTemporaryDirectories)

const TASK = 'evals%2Fdemo::default::run=default::eval=default'

describe('createEvidenceService', () => {
  // ROOT CAUSE:
  //
  // The case page loads external logs from several components at once. Each `indexLogFile` call read the shared
  // index's `scannedBytes` before the other call had advanced it, so both parsed the same bytes and both pushed the
  // same matches, and the second call then advanced `scannedBytes` past the end of the file:
  //
  // const buffer = Buffer.alloc(info.size - index.scannedBytes)   // whole file in both calls
  // matches.push({ ... })                                           // every line twice
  //
  // We fixed this by joining concurrent index builds of one file into one in-flight scan.
  /**
   * @example
   * expect(responses.map(response => response.total)).toEqual([3, 3])
   */
  it('matches every command log line once when external logs are read concurrently', async () => {
    const directory = await createTemporaryDirectory()
    const logDirectory = join(directory, 'logs')
    await mkdir(logDirectory)
    const lines = Array.from({ length: 3 }, (_, index) => JSON.stringify({ caseId: 'chrome/a', message: `line ${index}` }))
    await writeFile(join(logDirectory, 'run.jsonl'), `${lines.join('\n')}\n`)

    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    reducer.apply(envelope('case.started', { index: 0, name: 'chrome/a', total: 1 }, { caseId: '0:chrome%2Fa', projectId: 'demo', taskId: TASK }))
    const reduced = [...reducer.cases.values()][0]
    const evidence = createEvidenceService({ evidenceRoots: [directory], logDirectories: [logDirectory] })

    const responses = await Promise.all([
      evidence.externalLogs(reducer, reduced, { limit: 100, offset: 0 }),
      evidence.externalLogs(reducer, reduced, { limit: 100, offset: 0 }),
    ])
    expect(responses.map(response => response.total)).toEqual([3, 3])
    expect(responses[1].lines.map(line => line.line)).toEqual([1, 2, 3])
  })
})
