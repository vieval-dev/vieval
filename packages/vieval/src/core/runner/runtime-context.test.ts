import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createRunnerRuntimeContext } from './runtime-context'

const temporaryDirectories: string[] = []

describe('createRunnerRuntimeContext', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.map(async (temporaryDirectory) => {
        // NOTICE:
        // These directories are test fixtures created with `mkdtemp`.
        // We remove them to avoid leaking temporary filesystem state.
        await rm(temporaryDirectory, { force: true, recursive: true })
      }),
    )

    temporaryDirectories.length = 0
  })

  it('uses fallback root when cwd is outside a pnpm workspace', async () => {
    // NOTICE:
    // We need an isolated temporary directory so workspace discovery does not
    // accidentally resolve to the current repository.
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-runtime-context-'))
    temporaryDirectories.push(temporaryDirectory)
    const fallbackProjectRootDirectory = join(temporaryDirectory, 'fallback-project-root')

    const context = await createRunnerRuntimeContext({
      cwd: temporaryDirectory,
      fallbackProjectRootDirectory,
    })

    expect(context.projectRootDirectory).toBe(fallbackProjectRootDirectory)
  })

  it('resolves a non-empty project root directory for normal usage', async () => {
    const context = await createRunnerRuntimeContext({
      cwd: import.meta.dirname,
    })

    expect(context.projectRootDirectory.length).toBeGreaterThan(0)
  })
})
