import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { discoverEvalFiles } from './discovery'

let temporaryDirectory: string | undefined

describe('discoverEvalFiles', () => {
  afterEach(async () => {
    if (temporaryDirectory != null) {
      await rm(temporaryDirectory, { force: true, recursive: true })
      temporaryDirectory = undefined
    }
  })

  it('applies include and exclude globs relative to root', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'vieval-discovery-'))

    await mkdir(join(temporaryDirectory, 'evals'), { recursive: true })
    await mkdir(join(temporaryDirectory, 'evals', 'ignored'), { recursive: true })
    await writeFile(join(temporaryDirectory, 'evals', 'a.eval.ts'), 'export default {}', 'utf-8')
    await writeFile(join(temporaryDirectory, 'evals', 'ignored', 'b.eval.ts'), 'export default {}', 'utf-8')
    await writeFile(join(temporaryDirectory, 'evals', 'c.test.ts'), 'export default {}', 'utf-8')

    const discovered = await discoverEvalFiles({
      exclude: ['evals/ignored/**'],
      include: ['evals/**/*.eval.ts'],
      root: temporaryDirectory,
    })

    expect(discovered).toEqual([join(temporaryDirectory, 'evals', 'a.eval.ts')])
  })
})
