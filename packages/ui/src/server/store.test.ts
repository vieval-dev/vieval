import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { cleanupTemporaryDirectories, createTemporaryDirectory } from '../../test/helpers'
import { findRunDirectories } from './store'

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
