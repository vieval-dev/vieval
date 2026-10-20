import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { cleanupTemporaryDirectories, createEnvelopeFactory, createTemporaryDirectory } from '../../test/helpers'
import { createRunStore, findRunDirectories, readRunSummary, toRunListItem } from './store'

afterEach(cleanupTemporaryDirectories)

describe('findRunDirectories', () => {
  /**
   * @example
   * expect(await findRunDirectories(root)).toEqual([join(root, 'w', 'p', 'e', 'a', 'run-1'), ...])
   */
  it('finds run directories five levels below the root, without dot directories or symlinked directories', async () => {
    const base = await createTemporaryDirectory()
    const root = join(base, 'reports')
    const run = (...segments: string[]) => join(root, ...segments)
    await mkdir(run('w', 'p', 'e', 'a', 'run-1'), { recursive: true })
    await writeFile(run('w', 'p', 'e', 'a', 'run-1', 'events.jsonl'), '')
    await mkdir(run('w', 'p', 'e', 'a', 'run-2'), { recursive: true })
    await writeFile(run('w', 'p', 'e', 'a', 'run-2', 'run-summary.json'), '{}')
    await writeFile(run('w', 'p', 'e', 'a', 'run-2', 'events.jsonl'), '')
    // Too shallow, without report files, or hidden: not runs.
    await mkdir(run('w', 'p', 'e', 'shallow'), { recursive: true })
    await writeFile(run('w', 'p', 'e', 'shallow', 'events.jsonl'), '')
    await mkdir(run('w', 'p', 'e', 'a', 'empty'), { recursive: true })
    await mkdir(run('w', 'p', 'e', '.hidden', 'run-3'), { recursive: true })
    await writeFile(run('w', 'p', 'e', '.hidden', 'run-3', 'events.jsonl'), '')
    // A symlinked experiment directory would list run-1 twice.
    await symlink(run('w', 'p', 'e'), run('w', 'p', 'linked'))

    expect(await findRunDirectories(root)).toEqual([run('w', 'p', 'e', 'a', 'run-1'), run('w', 'p', 'e', 'a', 'run-2')])
  })

  /**
   * @example
   * expect(await findRunDirectories(join(base, 'missing'))).toEqual([])
   */
  it('returns no runs for a missing root', async () => {
    const base = await createTemporaryDirectory()
    expect(await findRunDirectories(join(base, 'missing'))).toEqual([])
  })
})

const HEADLINE = {
  completion: { mean: 1, n: 2, name: 'completion', sum: 2, total: 2, unscored: {} },
  headline: { kind: 'score', score: { mean: 0.5, n: 2, name: 'demo.pass', sum: 1, total: 2, unscored: {} } },
}

/** Writes one run directory under `<root>/w/p/e/a/<runKey>` with the given event lines and summary. */
async function writeRun(root: string, runKey: string, lines: readonly unknown[], summary?: unknown): Promise<string> {
  const directory = join(root, 'w', 'p', 'e', 'a', runKey)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'events.jsonl'), lines.map(line => `${JSON.stringify(line)}\n`).join(''))
  if (summary != null) {
    await writeFile(join(directory, 'run-summary.json'), JSON.stringify(summary))
  }
  return directory
}

describe('readRunSummary', () => {
  /**
   * @example
   * expect(summary?.headline).toEqual(HEADLINE)
   */
  it('reads the headline and the score definitions of run-summary.json schema version 2', async () => {
    const root = await createTemporaryDirectory()
    const directory = await writeRun(root, 'run-1', [], {
      headline: HEADLINE,
      projects: [{ caseSummary: { failed: 1, passed: 1, total: 2 } }],
      schemaVersion: 2,
      scoreDefinitions: [{ label: 'Pass', name: 'demo.pass', primary: true }],
    })

    const summary = await readRunSummary(join(directory, 'run-summary.json'))
    expect(summary?.headline).toEqual(HEADLINE)
    expect(summary?.scoreDefinitions).toEqual([{ label: 'Pass', name: 'demo.pass', primary: true }])
    expect(summary?.caseSummary).toEqual({ errored: 0, failed: 1, passed: 1, requeued: 0, running: 0, skipped: 0, timeout: 0, total: 2 })
  })

  /**
   * @example
   * expect(summary?.headline).toBeUndefined()
   */
  it('reads a summary without a headline, so the run is scored from its events', async () => {
    const root = await createTemporaryDirectory()
    const directory = await writeRun(root, 'run-1', [], { interruptSignal: 'SIGINT', projects: [] })

    const summary = await readRunSummary(join(directory, 'run-summary.json'))
    expect(summary).toEqual({ caseSummary: undefined, headline: undefined, interruptSignal: 'SIGINT', scoreDefinitions: undefined })
  })
})

describe('createRunStore', () => {
  /**
   * @example
   * expect(handle?.unsupportedVersion()).toBe(2)
   */
  it('lists a run of event schema version 2 as unsupported without reading its events', async () => {
    const root = await createTemporaryDirectory()
    const envelope = createEnvelopeFactory('run-old')
    const old = { ...envelope('score.recorded', { kind: 'exact', score: 1 }, { caseId: '0:a', projectId: 'p', taskId: 't' }), schemaVersion: 2 }
    await writeRun(root, 'run-old', [old])
    const store = createRunStore({ reportRoots: [root] })

    const handle = await store.get('run-old')
    expect(handle?.unsupportedVersion()).toBe(2)
    expect(handle?.source()).toBe('unsupported')
    expect(handle?.state(Date.now())).toBe('unsupported')
    expect(handle?.reducer().events).toEqual([])
    const item = toRunListItem(handle!, Date.now())
    expect(item).toMatchObject({ attemptId: 'a', experimentId: 'e', headline: null, runKey: 'run-old', workspaceId: 'w' })
    store.close()
  })

  /**
   * @example
   * expect(item.headlineDefinitions).toEqual([{ label: 'Pass', name: 'demo.pass', primary: true }])
   */
  it('lists a finished run with the headline of its summary and the definition of the headline score', async () => {
    const root = await createTemporaryDirectory()
    const envelope = createEnvelopeFactory('run-1')
    const scope = { caseId: '0:a', projectId: 'p', taskId: 't' }
    await writeRun(root, 'run-1', [
      envelope('run.started', { totalTasks: 1 }),
      envelope('score.defined', { name: 'demo.other' }, { projectId: 'p', taskId: 't' }),
      envelope('score.defined', { label: 'Pass', name: 'demo.pass', primary: true }, { projectId: 'p', taskId: 't' }),
      envelope('case.started', { index: 0, name: 'a', total: 1 }, scope),
      envelope('score.recorded', { name: 'demo.pass', value: 1 }, scope),
      envelope('case.ended', { index: 0, name: 'a', state: 'passed', total: 1 }, scope),
      envelope('run.ended', { failedTasks: 0, passedTasks: 1, skippedTasks: 0, totalTasks: 1 }),
    ], { headline: HEADLINE, projects: [], schemaVersion: 2 })
    const store = createRunStore({ reportRoots: [root] })

    const item = toRunListItem((await store.get('run-1'))!, Date.now())
    // The summary's headline wins over the one the events give (mean 1 of one case).
    expect(item.headline).toEqual(HEADLINE)
    expect(item.headlineDefinitions).toEqual([{ label: 'Pass', name: 'demo.pass', primary: true }])
    store.close()
  })
})
