import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { formatAttemptsTable, listAttempts } from './report-attempts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

/** Writes one run of `<root>/<workspace>/project/experiment-a/<attempt>/<run>/`, with a summary unless `summary` is null. */
async function writeRun(root: string, options: {
  attempt: string
  cases?: { errored?: number, failed?: number, passed?: number, timeout?: number }
  modifiedAt: string
  resumedFrom?: string
  run: string
  summary?: null
  workspace: string
}): Promise<void> {
  const attemptDirectory = join(root, options.workspace, 'project', 'experiment-a', options.attempt)
  const runDirectory = join(attemptDirectory, options.run)
  await mkdir(runDirectory, { recursive: true })
  if (options.summary !== null) {
    const cases = { errored: 0, failed: 0, passed: 0, timeout: 0, ...options.cases }
    await writeFile(join(runDirectory, 'run-summary.json'), JSON.stringify({
      projects: [{ caseSummary: { ...cases, skipped: 0, total: cases.errored + cases.failed + cases.passed + cases.timeout } }],
      ...(options.resumedFrom == null ? {} : { resumedFrom: options.resumedFrom }),
    }))
  }
  await utimes(attemptDirectory, new Date(options.modifiedAt), new Date(options.modifiedAt))
}

describe('listAttempts', () => {
  /**
   * @example
   * two workspaces of attempt-1 sum into one row; attempt-2 resumed it and is the latest.
   */
  it('sums each attempt over its workspaces and marks the one --resume picks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vieval-attempts-'))
    temporaryDirectories.push(root)
    await writeRun(root, { attempt: 'attempt-1', cases: { errored: 2, passed: 6 }, modifiedAt: '2026-10-19T06:00:00Z', run: 'run-a', workspace: 'llm' })
    await writeRun(root, { attempt: 'attempt-1', cases: { failed: 1, passed: 3, timeout: 1 }, modifiedAt: '2026-10-19T06:00:00Z', run: 'run-b', workspace: 'rule' })
    await writeRun(root, { attempt: 'attempt-2', cases: { passed: 2 }, modifiedAt: '2026-10-19T08:00:00Z', resumedFrom: 'attempt-1', run: 'run-c', workspace: 'llm' })

    const rows = await listAttempts(root)

    expect(rows.map(row => [row.attemptId, row.latest, row.workspaces])).toEqual([
      ['attempt-2', true, ['llm']],
      ['attempt-1', false, ['llm', 'rule']],
    ])
    expect(rows[1]!.cases).toEqual({ errored: 2, failed: 1, passed: 9, timeout: 1, total: 13 })
    expect(rows[1]!.coverage).toBeCloseTo(10 / 13)
    expect(rows[0]!.resumedFrom).toBe('attempt-1')
    expect(formatAttemptsTable(rows)).toContain('resumed attempt-1')
  })

  /**
   * @example
   * a run killed before it wrote run-summary.json is counted, so the attempt reads as incomplete.
   */
  it('counts runs that never wrote a summary and filters by workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vieval-attempts-'))
    temporaryDirectories.push(root)
    await writeRun(root, { attempt: 'attempt-1', modifiedAt: '2026-10-19T06:00:00Z', run: 'run-a', summary: null, workspace: 'llm' })
    await writeRun(root, { attempt: 'attempt-1', cases: { passed: 1 }, modifiedAt: '2026-10-19T06:00:00Z', run: 'run-b', workspace: 'rule' })

    const [llm] = await listAttempts(root, { workspace: ['llm'] })

    expect(llm!.unfinishedRuns).toBe(1)
    expect(llm!.coverage).toBeNull()
    expect(formatAttemptsTable([llm!])).toContain('1 run without summary')
  })
})
