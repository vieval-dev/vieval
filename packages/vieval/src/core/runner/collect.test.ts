import type { EvalDefinition, EvalModule } from '../../config'
import type { RunnerRuntimeContext } from './collect'

import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import { asProjectRelativePath, collectEvalEntries } from './collect'

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
  beforeAll(() => {
    runtimeContext = { projectRootDirectory: packageDirectory }
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
        [commentaryHref]: createModule({
          description: 'Fixture eval for commentary behavior.',
          name: 'commentary',
        }),
        [tacticsHref]: createModule({
          description: 'Fixture eval for tactical behavior.',
          name: 'tactics',
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

  // ROOT CAUSE:
  //
  // `loadEvalModulesWithVitestRuntime` keys the second task of a file as `<href>#registration-2`, but the entry id
  // was built from the file path alone, so both tasks got one id and one set of task ids. Their cases then
  // overwrote each other in the reporter, the event log, and every report (airi `tts-speech-formula` split its four
  // languages into four files to work around it).
  //
  // We fixed this by deriving the entry name from the task name and adding `#<name>` to the id when it differs
  // from the file name.
  it('gives each task of one eval file its own entry id and name', () => {
    const href = pathToFileURL(fixtureEvalPath('speech.eval.ts')).href

    const entries = collectEvalEntries(
      {
        [`${href}#registration-2`]: createModule({ description: 'English.', name: 'en' }),
        [href]: createModule({ description: 'Chinese.', name: 'zh' }),
      },
      runtimeContext,
    )

    expect(entries.map(entry => entry.name)).toEqual(['en', 'zh'])
    expect(entries[0]!.id).toMatch(/evals\/speech#en$/)
    expect(entries[1]!.id).toMatch(/evals\/speech#zh$/)
  })

  it('keeps the file id for a task named like its file', () => {
    const href = pathToFileURL(fixtureEvalPath('commentary.eval.ts')).href

    const entries = collectEvalEntries({ [href]: createModule({ description: 'Commentary.', name: 'commentary' }) }, runtimeContext)

    expect(entries[0]!.id).toMatch(/evals\/commentary$/)
  })

  it('rejects two tasks with one name in one eval file', () => {
    const href = pathToFileURL(fixtureEvalPath('speech.eval.ts')).href

    expect(() => collectEvalEntries(
      {
        [`${href}#registration-2`]: createModule({ description: 'Second.', name: 'zh' }),
        [href]: createModule({ description: 'First.', name: 'zh' }),
      },
      runtimeContext,
    )).toThrow('defines more than one task named "zh"')
  })

  it('collects eval files of every module format that discovery includes', () => {
    const href = pathToFileURL(fixtureEvalPath('speech.eval.mts')).href

    const entries = collectEvalEntries({ [href]: createModule({ description: 'Speech.', name: 'speech' }) }, runtimeContext)

    expect(entries[0]!.id).toMatch(/evals\/speech$/)
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
