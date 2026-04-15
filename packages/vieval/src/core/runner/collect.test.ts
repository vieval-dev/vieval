import type { EvalDefinition, EvalModule } from '../../config'
import type { RunnerRuntimeContext } from './runtime-context'

import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import { asProjectRelativePath, collectEvalEntries } from './collect'
import { createRunnerRuntimeContext } from './runtime-context'

const packageDirectory = fileURLToPath(new URL('../../../', import.meta.url))
let runtimeContext: RunnerRuntimeContext

function createModule(definition: EvalDefinition): EvalModule {
  return { default: definition }
}

function fixtureEvalPath(fileName: string): string {
  return join(packageDirectory, 'tests/projects/example-pattern-byoa-bring-your-own-agent/evals', fileName)
}

function taskAgentFixtureEvalPath(fileName: string): string {
  return join(packageDirectory, 'tests/projects/example-api-defining-new-task/evals', fileName)
}

describe('collectEvalEntries', () => {
  beforeAll(async () => {
    runtimeContext = await createRunnerRuntimeContext({
      cwd: import.meta.dirname,
      fallbackProjectRootDirectory: packageDirectory,
    })
  })

  it('keeps cross-drive absolute path when relative conversion is not possible', () => {
    expect(asProjectRelativePath('D:/other-drive/outside.eval.ts', runtimeContext)).toBe('D:/other-drive/outside.eval.ts')
  })

  it('collects local fixture eval modules with stable ids and directory metadata', () => {
    const commentaryEvalPath = fixtureEvalPath('commentary.eval.ts')
    const commentaryEvalHref = pathToFileURL(commentaryEvalPath).href

    const entries = collectEvalEntries(
      {
        [commentaryEvalHref]: createModule({
          description: 'Fixture eval for commentary behavior.',
          name: 'commentary',
        }),
      },
      runtimeContext,
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({
      description: 'Fixture eval for commentary behavior.',
      directory: expect.stringContaining('tests/projects/example-pattern-byoa-bring-your-own-agent/evals'),
      filePath: commentaryEvalPath,
      id: expect.stringContaining('tests/projects/example-pattern-byoa-bring-your-own-agent/evals/commentary'),
      name: 'commentary',
    })
  })

  it('ignores non-file module keys without throwing', () => {
    const modules = {
      'virtual:agent/commentary.eval.ts': createModule({
        description: 'Should be ignored.',
        name: 'virtual-entry',
      }),
    }

    expect(() => collectEvalEntries(modules, runtimeContext)).not.toThrow()
    expect(collectEvalEntries(modules, runtimeContext)).toEqual([])
  })

  it('sorts entries by id and normalizes directory separators', () => {
    const commentaryHref = pathToFileURL(fixtureEvalPath('commentary.eval.ts')).href
    const tacticsHref = pathToFileURL(fixtureEvalPath('tactics.eval.ts')).href

    const entries = collectEvalEntries(
      {
        [tacticsHref]: createModule({
          description: 'Fixture eval for tactical behavior.',
          name: 'tactics',
        }),
        [commentaryHref]: createModule({
          description: 'Fixture eval for commentary behavior.',
          name: 'commentary',
        }),
      },
      runtimeContext,
    )

    expect(entries.map(entry => entry.id)).toEqual([
      expect.stringContaining('tests/projects/example-pattern-byoa-bring-your-own-agent/evals/commentary'),
      expect.stringContaining('tests/projects/example-pattern-byoa-bring-your-own-agent/evals/tactics'),
    ])
    expect(entries.map(entry => entry.directory)).toEqual([
      expect.stringContaining('tests/projects/example-pattern-byoa-bring-your-own-agent/evals'),
      expect.stringContaining('tests/projects/example-pattern-byoa-bring-your-own-agent/evals'),
    ])
  })

  it('collects eval-local runMatrix and evalMatrix layer definitions from eval modules', async () => {
    const taskDefaultEvalPath = taskAgentFixtureEvalPath('task-default.eval.ts')
    const taskDefaultEvalHref = pathToFileURL(taskDefaultEvalPath).href
    const taskDefaultModule = await import(taskDefaultEvalHref) as EvalModule

    const entries = collectEvalEntries(
      {
        [taskDefaultEvalHref]: taskDefaultModule,
      },
      runtimeContext,
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      directory: expect.stringContaining('tests/projects/example-api-defining-new-task/evals'),
      filePath: taskDefaultEvalPath,
      id: expect.stringContaining('tests/projects/example-api-defining-new-task/evals/task-default'),
      matrix: {
        evalMatrix: {
          override: {
            rubric: ['strict'],
          },
        },
        runMatrix: {
          extend: {
            promptStyle: ['concise'],
          },
          override: {
            scenario: ['eval-scenario'],
          },
        },
      },
      task: {
        matrix: {
          evalMatrix: {
            extend: {
              evaluator: ['default-judge'],
            },
          },
          runMatrix: {
            override: {
              model: ['gpt-4.1-mini'],
            },
          },
        },
      },
    })
  })

  it('filters invalid file entries without throwing', () => {
    const nonEvalHref = pathToFileURL(join(runtimeContext.projectRootDirectory, 'README.md')).href
    const modules = {
      [nonEvalHref]: createModule({
        description: 'Wrong extension.',
        name: 'readme',
      }),
    }

    expect(() => collectEvalEntries(modules, runtimeContext)).not.toThrow()
    expect(collectEvalEntries(modules, runtimeContext)).toEqual([])
  })
})
