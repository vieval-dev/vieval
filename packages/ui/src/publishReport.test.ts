import type { PublishedCatalog, PublishedComparison, PublishedRun } from './shared/publishedReport'

import { appendFile, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { cleanupTemporaryDirectories, copyOsworldFixture, createTemporaryDirectory, createTestApp, OSWORLD_RUNS, OSWORLD_TASK_ID, readRunningContinuation } from '../test/helpers'
import { exportReport } from './publishReport'
import { normalizePathSegment } from './server/views'
import { compareRuns } from './shared/compare'
import { CATALOG_PATH, fileKey, runDataPath, telemetryPath } from './shared/publishedReport'

afterEach(cleanupTemporaryDirectories)

/** @example vieval report export .vieval/reports --output report-site */
describe('static report publication', () => {
  // https://github.com/vieval-dev/vieval/issues/44
  /** @example expect(report.tasks[taskId].cases[caseId].detail.scoreRecords).toHaveLength(1) */
  it('issue #44 publishes case evidence and comparable run data independently of the source', async () => {
    const { reportRoot, vievalDirectory } = await copyOsworldFixture()
    const directory = await createTemporaryDirectory()
    const output = join(directory, 'site')
    const archiveKey = basename(OSWORLD_RUNS.archived)
    const candidateKey = basename(OSWORLD_RUNS.running)
    const caseId = '1:chrome%2F06fe7178-4491-4589-810f-2e2bc9502122'
    const artifacts = join(reportRoot, OSWORLD_RUNS.archived, 'artifacts')
    const artifactDir = join(artifacts, normalizePathSegment(OSWORLD_TASK_ID), normalizePathSegment(caseId))
    await mkdir(artifactDir, { recursive: true })
    await writeFile(join(artifactDir, 'preview.html'), '<html><title>Recorded output</title></html>')
    await writeFile(join(artifactDir, 'diagram.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    await writeFile(join(artifactDir, 'recording.opus'), 'recorded audio')
    await writeFile(join(artifactDir, 'trace.unknown'), 'unrecognized format')
    const privateFile = join(directory, 'outside.txt')
    await writeFile(privateFile, 'outside the artifact directory')
    await symlink(privateFile, join(artifactDir, 'outside.txt'))
    const candidateOtlp = join(reportRoot, OSWORLD_RUNS.running, 'otlp')
    await mkdir(candidateOtlp)
    await symlink(privateFile, join(candidateOtlp, 'logs.json'))

    // Finish the second fixture so comparisons exercise two different sets of results.
    const continuation = await readRunningContinuation(vievalDirectory)
    const last = JSON.parse(continuation.at(-1)!) as { seq: number }
    const ended = { ...last, data: { failedTasks: 0, passedTasks: 0, skippedTasks: 0, totalTasks: 1 }, event: 'run.ended', seq: last.seq + 1, time: '2026-10-11T20:00:00.000Z' }
    await appendFile(join(reportRoot, OSWORLD_RUNS.running, 'events.jsonl'), `${continuation.join('\n')}\n${JSON.stringify(ended)}\n`)
    const live = createTestApp({ reportRoots: [reportRoot], vievalDirectory })
    const expected = await live.json<unknown>(`/api/compare/runs?runs=${archiveKey},${candidateKey}`)
    live.store.close()

    const result = await exportReport({ includeEvidence: true, output, reportRoots: [reportRoot] })
    expect(result.runKeys).toEqual([candidateKey, archiveKey])
    await rename(vievalDirectory, join(directory, 'original-reports'))

    const catalog = JSON.parse(await readFile(join(output, CATALOG_PATH), 'utf8')) as PublishedCatalog
    const archiveIndex = catalog.runs.findIndex(run => run.runKey === archiveKey)
    const candidateIndex = catalog.runs.findIndex(run => run.runKey === candidateKey)
    await expect(readFile(join(output, telemetryPath(candidateIndex, 'logs')))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(catalog.runs[archiveIndex].reportRoot).toBeNull()
    expect(await readFile(join(output, 'index.html'), 'utf8')).toContain('name="vieval-report" content="static"')
    const report = JSON.parse(await readFile(join(output, runDataPath(archiveIndex, 'run')), 'utf8')) as PublishedRun
    const { detail, externalLogs } = report.tasks[OSWORLD_TASK_ID].cases[caseId]
    expect(detail.input).toMatchObject({ task: { id: '06fe7178-4491-4589-810f-2e2bc9502122' } })
    expect(detail.scoreRecords[0].record).toEqual({ name: 'osworld.success', value: 0 })
    expect(detail.artifacts.map(artifact => [
      artifact.name,
      artifact.previewKind,
      report.files[fileKey(artifact.path)].split('.').at(-1),
    ]).sort()).toEqual([
      ['diagram.svg', 'binary', 'bin'],
      ['preview.html', 'binary', 'bin'],
      ['recording.opus', 'audio', 'opus'],
      ['trace.unknown', 'binary', 'bin'],
    ])
    expect(externalLogs?.lines).toHaveLength(24)
    const [link] = detail.evidence
    const frame = report.evidenceViews[link.id].timeline?.frames[0]
    expect(frame?.contentType).toBe('image/webp')
    expect((await readFile(join(output, report.files[fileKey(frame!.path, link.id)]))).length).toBeGreaterThan(0)

    const comparisonRuns = await Promise.all([archiveKey, candidateKey].map(async (runKey) => {
      const index = catalog.runs.findIndex(run => run.runKey === runKey)
      const comparison = JSON.parse(await readFile(join(output, runDataPath(index, 'comparison')), 'utf8')) as PublishedComparison
      return { ...comparison, item: catalog.runs[index] }
    }))
    expect(JSON.parse(JSON.stringify(compareRuns(comparisonRuns)))).toEqual(expected)
  })

  /** @example expect(exportReport({ output, reportRoots: [reportRoot] })).rejects.toThrow(/already exists/) */
  it('preserves an existing destination and refuses unfinished runs', async () => {
    const { reportRoot } = await copyOsworldFixture()
    const output = await createTemporaryDirectory()
    const marker = join(output, 'keep.txt')
    await writeFile(marker, 'keep')
    await expect(exportReport({ output, reportRoots: [reportRoot] })).rejects.toThrow(/already exists/)
    expect(await readFile(marker, 'utf8')).toBe('keep')
    await expect(exportReport({ output: join(output, 'site'), reportRoots: [reportRoot], runKeys: [basename(OSWORLD_RUNS.running)] })).rejects.toThrow(/not a supported completed report/)
  })
})
