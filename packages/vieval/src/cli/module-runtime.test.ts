import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { loadEvalModulesWithVitestRuntime } from './module-runtime'

const packageDirectory = fileURLToPath(new URL('../../', import.meta.url))
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async directory => rm(directory, { force: true, recursive: true })))
})

/** Writes an eval file whose task registers only after `delayMs`, so its import is still pending while others start. */
async function writeDelayedEvalFile(taskName: string, delayMs: number): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'vieval-module-runtime-'))
  temporaryDirectories.push(directory)
  const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
  const filePath = join(directory, `${taskName}.eval.ts`)
  await writeFile(filePath, `
import { caseOf, describeTask } from '${vievalImportPath}'

await new Promise(resolve => setTimeout(resolve, ${delayMs}))

describeTask('${taskName}', () => {
  caseOf('${taskName} case', () => {})
})
`, 'utf-8')
  return filePath
}

describe('loadEvalModulesWithVitestRuntime', () => {
  // ROOT CAUSE:
  //
  // `vieval run` prepares every project at once. Each project imports its eval files, and the DSL registry knew
  // only one "active module" for the whole process (`beginModuleRegistration`). When a second project's import
  // began while the first project's module was still evaluating (top-level await, slow imports), the first
  // project's `describeTask` registered under the second project's file. The first project then had no task and
  // the second ran the first project's cases.
  //
  // We fixed this by importing eval modules one at a time across the process, so a module's registrations are
  // always consumed before the next module becomes active.
  it('keeps the tasks of eval files loaded by concurrently prepared projects apart', async () => {
    const alphaPath = await writeDelayedEvalFile('alpha', 60)
    const betaPath = await writeDelayedEvalFile('beta', 0)

    const [alpha, beta] = await Promise.all([
      loadEvalModulesWithVitestRuntime([alphaPath], join(alphaPath, '..')),
      loadEvalModulesWithVitestRuntime([betaPath], join(betaPath, '..')),
    ])

    expect(Object.values(alpha).map(module => module.default.name)).toEqual(['alpha'])
    expect(Object.values(beta).map(module => module.default.name)).toEqual(['beta'])
  })
})
