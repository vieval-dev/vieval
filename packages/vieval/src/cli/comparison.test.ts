import type { HeadlineResult, ScoreSummary } from '../core/scoring'
import type { ComparisonOutput } from './comparison'
import type { RunSummaryFile } from './report-artifacts'

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

import { glob } from 'tinyglobby'
import { afterEach, describe, expect, it } from 'vitest'

import { comparisonExitCode, formatComparisonOutput, loadComparison, runComparison } from './comparison'

const packageDirectory = fileURLToPath(new URL('../../', import.meta.url))
const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
const temporaryDirectories: string[] = []
const quietReporter = { isTTY: false, writeError: () => {}, writeOutput: () => {} }

// NOTICE:
// Workspace processes run the `vieval` bin of the workspace. Fixtures live in a temporary directory without
// `node_modules`, and tests run the TypeScript sources, so the processes start the source bin through `tsx`.
// Removal condition: none; this is how tests reach the real process boundary without building the package.
const tsxLoader = createRequire(import.meta.url).resolve('tsx')
function sourceCommand(): string[] {
  return [process.execPath, '--import', tsxLoader, join(packageDirectory, 'src', 'bin', 'vieval.ts')]
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async directory => rm(directory, { force: true, recursive: true })))
})

/**
 * A comparison over `test-objects/*`; each workspace has one project whose `zh` task runs two cases. A case writes
 * the env it sees and fails when its workspace's `FAIL` env is set; `BROKEN_CONFIG` makes a config throw.
 */
async function createComparisonFixture(options: { comparisonEnv?: Record<string, string>, workspaces: Array<{ brokenConfig?: boolean, env?: Record<string, string>, name: string }> }): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'vieval-comparison-'))
  temporaryDirectories.push(directory)
  for (const workspace of options.workspaces) {
    const root = join(directory, 'test-objects', workspace.name)
    await mkdir(join(root, 'tasks'), { recursive: true })
    await writeFile(join(root, 'vieval.config.ts'), `
import { defineConfig } from '${vievalImportPath}'
${workspace.brokenConfig === true ? 'throw new Error(\'broken workspace config\')' : ''}
export default defineConfig({
  env: { FROM_WORKSPACE: '${workspace.name}', SHARED: 'workspace' },
  models: [{ aliases: [], id: 'openai:gpt-4.1-mini', model: 'gpt-4.1-mini', inferenceExecutor: 'openai', inferenceExecutorId: 'openai:gpt-4.1-mini' }],
  projects: [{ name: 'speech-${workspace.name}', root: '.', include: ['tasks/*.eval.ts'] }],
})
`, 'utf-8')
    await writeFile(join(root, 'tasks', 'speech.eval.ts'), `
import { writeFileSync } from 'node:fs'
import process from 'node:process'
import { describeTask } from '${vievalImportPath}'

describeTask('zh', ({ casesFromInputs }) => {
  casesFromInputs('case', [1, 2], async (context) => {
    writeFileSync(${JSON.stringify(join(root, 'seen-env.json'))}, JSON.stringify({ FROM_COMPARISON: process.env.FROM_COMPARISON, FROM_WORKSPACE: process.env.FROM_WORKSPACE, SHARED: process.env.SHARED }))
    await context.cache.namespace('speech').file({ key: ['case', String(context.matrix.inputs)], ext: 'json' }).writeJson({ by: process.env.FROM_WORKSPACE })
    if (process.env.FAIL === '1') {
      throw new Error('expected failure')
    }
  })
})
`, 'utf-8')
  }
  await writeFile(join(directory, 'vieval.config.ts'), `
import { defineConfig } from '${vievalImportPath}'

export default defineConfig({
  id: 'speech-comparison',
  cache: { namespace: 'speech-v1' },
  env: ${JSON.stringify({ SHARED: 'comparison', ...options.comparisonEnv })},
  workspaces: [
    'test-objects/*',
    ${options.workspaces.filter(workspace => workspace.env != null).map(workspace => `{ root: 'test-objects/${workspace.name}', id: '${workspace.name}-env', env: ${JSON.stringify(workspace.env)} },`).join('\n    ')}
  ],
})
`, 'utf-8')
  return directory
}

describe('loadComparison', () => {
  it('resolves glob and explicit workspace entries without loading workspace configs', async () => {
    const directory = await createComparisonFixture({ workspaces: [{ brokenConfig: true, name: 'raw' }, { env: { FAIL: '1' }, name: 'rule' }] })

    const comparison = await loadComparison({ configFilePath: join(directory, 'vieval.config.ts') })

    // `raw` throws when its config loads; the comparison never loads it.
    expect(comparison.id).toBe('speech-comparison')
    expect(comparison.workspaces.map(workspace => workspace.id)).toEqual(['raw', 'rule', 'rule-env'])
    expect(comparison.workspaces[2]!.env).toEqual({ FAIL: '1', SHARED: 'comparison' })
    expect(comparison.cache).toEqual({ namespace: 'speech-v1', root: join(directory, '.vieval', 'cache'), scope: 'speech-comparison' })
  })

  it('rejects two workspaces with one id', async () => {
    const directory = await createComparisonFixture({ workspaces: [{ name: 'raw' }] })
    await writeFile(join(directory, 'vieval.config.ts'), `
import { defineConfig } from '${vievalImportPath}'
export default defineConfig({ workspaces: ['test-objects/raw', { root: 'test-objects/raw' }] })
`, 'utf-8')

    await expect(loadComparison({ configFilePath: join(directory, 'vieval.config.ts') })).rejects.toThrow('Two workspaces have the id "raw"')
  })
})

describe('runComparison', () => {
  it('runs every workspace as its own process into one report root, sharing the invocation, the env, and the cache', async () => {
    const directory = await createComparisonFixture({ comparisonEnv: { FROM_COMPARISON: 'yes' }, workspaces: [{ name: 'raw' }, { name: 'rule' }] })

    const output = await runComparison({ configFilePath: join(directory, 'vieval.config.ts'), reporter: quietReporter, resolveCommand: sourceCommand })

    expect(output.workspaces.map(workspace => [workspace.id, workspace.exitCode, workspace.errorMessage])).toEqual([['raw', 0, undefined], ['rule', 0, undefined]])
    expect(comparisonExitCode(output)).toBe(0)
    for (const workspace of output.workspaces) {
      const [project] = workspace.output!.projects
      expect(project!.caseSummary).toMatchObject({ passed: 2, total: 2 })
      expect(project!.reportDirectory).toContain(join(directory, '.vieval', 'reports', workspace.id, `speech-${workspace.id}`, 'speech-comparison'))
      const summary = JSON.parse(await readFile(join(project!.reportDirectory!, 'run-summary.json'), 'utf-8')) as RunSummaryFile
      expect(summary.invocationId).toBe(output.invocationId)
      expect(summary.comparisonId).toBe('speech-comparison')
      expect(summary.attemptId).toBe(output.attemptId)
    }
    // The comparison's env wins over the workspace config's env, which still adds its own keys.
    expect(JSON.parse(await readFile(join(directory, 'test-objects', 'raw', 'seen-env.json'), 'utf-8'))).toEqual({ FROM_COMPARISON: 'yes', FROM_WORKSPACE: 'raw', SHARED: 'comparison' })
    // One cache for all workspaces, next to the comparison config.
    expect(await glob('**/*.json', { cwd: join(directory, '.vieval', 'cache', 'speech-comparison', 'speech-v1') })).toEqual(['speech/case/1.json', 'speech/case/2.json'])
    expect(existsSync(join(directory, 'test-objects', 'raw', '.vieval'))).toBe(false)
    expect(formatComparisonOutput(output)).toContain('raw/speech-raw')
  }, 60_000)

  it('keeps running and reports the other workspaces when one fails or cannot load its config', async () => {
    const directory = await createComparisonFixture({ workspaces: [{ brokenConfig: true, name: 'broken' }, { name: 'raw' }, { env: { FAIL: '1' }, name: 'rule' }] })

    const output = await runComparison({ configFilePath: join(directory, 'vieval.config.ts'), reporter: quietReporter, resolveCommand: sourceCommand, workspace: ['broken', 'raw', 'rule-env'] })

    const [broken, raw, failing] = output.workspaces
    expect(broken!.output).toBeUndefined()
    expect(broken!.exitCode).toBe(1)
    expect(broken!.stderrTail.join('\n')).toContain('broken workspace config')
    expect(raw!.output!.projects[0]!.caseSummary).toMatchObject({ passed: 2 })
    // The failing fixture throws plain errors, so its cases produced no result; that still fails the comparison.
    expect(failing!.output!.projects[0]!.caseSummary).toMatchObject({ errored: 2, failed: 0 })
    expect(comparisonExitCode(output)).toBe(1)
  }, 60_000)

  /**
   * @example
   * a comparison where one workspace errored, then `--resume`: every workspace continues the same
   * attempt, and only the cases without a result run again.
   */
  it('resumes the cases without a result of every workspace, continuing one attempt', async () => {
    const directory = await createComparisonFixture({ workspaces: [{ name: 'raw' }, { env: { FAIL: '1' }, name: 'rule' }] })
    const configFilePath = join(directory, 'vieval.config.ts')
    const first = await runComparison({ attempt: 'attempt-first', configFilePath, reporter: quietReporter, resolveCommand: sourceCommand, workspace: ['raw', 'rule-env'] })
    expect(first.workspaces.map(workspace => workspace.output?.projects[0]?.caseSummary?.errored)).toEqual([0, 2])

    // The provider of `rule-env` recovered. A new config file, because this process already imported the first one
    // (jiti caches it); its directory, comparison id, and so report root and experiment stay the same.
    const recoveredConfigFilePath = join(directory, 'vieval.recovered.config.ts')
    await writeFile(recoveredConfigFilePath, (await readFile(configFilePath, 'utf-8')).replace('"FAIL":"1"', '"FAIL":"0"'), 'utf-8')
    const resumed = await runComparison({ attempt: 'attempt-resumed', configFilePath: recoveredConfigFilePath, reporter: quietReporter, resolveCommand: sourceCommand, resume: 'latest', workspace: ['raw', 'rule-env'] })

    const [raw, rule] = resumed.workspaces
    // `raw` had a result for every case, so its only task was skipped.
    expect(raw!.output!.projects[0]!.taskCount).toBe(0)
    expect(rule!.output!.projects[0]!.caseSummary).toMatchObject({ errored: 0, passed: 2, total: 2 })
    for (const workspace of resumed.workspaces) {
      expect(workspace.output!.resumedFrom).toBe('attempt-first')
    }
    expect(comparisonExitCode(resumed)).toBe(0)
  }, 60_000)

  it('fails when a task selector matches nothing in any workspace', async () => {
    const directory = await createComparisonFixture({ workspaces: [{ name: 'raw' }, { name: 'rule' }] })

    await expect(runComparison({ configFilePath: join(directory, 'vieval.config.ts'), reporter: quietReporter, resolveCommand: sourceCommand, task: ['fr'] })).rejects.toThrow('No workspace has a project, task, or case matching "fr".')
  }, 60_000)

  it('fails before starting anything when a workspace selector matches nothing', async () => {
    const directory = await createComparisonFixture({ workspaces: [{ name: 'raw' }] })

    await expect(runComparison({ configFilePath: join(directory, 'vieval.config.ts'), reporter: quietReporter, resolveCommand: sourceCommand, workspace: ['llm'] })).rejects.toThrow('No workspace matches "llm". Workspaces: raw.')
  })
})

/**
 * Creates a finished comparison whose workspaces each have one project with `headline` and a passed share of
 * `passed` over 4 cases.
 */
function comparisonOutputOf(workspaces: Array<{ headline: HeadlineResult, id: string, passed: number }>): ComparisonOutput {
  return {
    attemptId: 'attempt-1',
    comparisonId: 'comparison-1',
    configFilePath: '/tmp/vieval.config.ts',
    experimentId: 'experiment-1',
    invocationId: 'invocation-1',
    reportRoot: null,
    workspaces: workspaces.map(workspace => ({
      exitCode: 0,
      id: workspace.id,
      output: {
        configFilePath: '/tmp/vieval.config.ts',
        projects: [{
          caseSummary: { errored: 0, failed: 4 - workspace.passed, passed: workspace.passed, skipped: 0, timeout: 0, total: 4 },
          discoveredEvalFileCount: 1,
          entryCount: 1,
          errorMessage: null,
          executed: true,
          matrixSummary: null,
          name: 'speech',
          result: {
            inferenceExecutors: [],
            overall: { completion: workspace.headline.completion, headline: workspace.headline, runCount: 1, scores: [] },
            runs: [{
              completion: workspace.headline.completion,
              entryId: 'speech',
              id: 'speech',
              inferenceExecutorId: 'default',
              matrix: { eval: {}, meta: { evalRowId: 'default', runRowId: 'default' }, run: {} },
              passed: summaryOf('passed', workspace.passed, 4),
              scores: [],
            }],
          },
          scoreDefinitions: [{ label: 'Pass', name: 'tts.pass', primary: true }],
          taskCount: 1,
        }],
      },
      signal: null,
      stderrTail: [],
    })),
  }
}

/** Creates one score summary over `n` counted cases of `total`. */
function summaryOf(name: string, sum: number, n: number, total = n, unscored: Record<string, number> = {}): ScoreSummary {
  return { mean: n === 0 ? null : sum / n, n, name, sum, total, unscored }
}

/**
 * @example
 * describe('formatComparisonOutput', () => {})
 */
describe('formatComparisonOutput', () => {
  /**
   * @example
   * it('ranks by the shared primary score with the completion rate in its own column', () => {})
   */
  it('ranks by the shared primary score with the completion rate in its own column', () => {
    const completion = summaryOf('completion', 3, 4, 4, { errored: 1 })
    const table = stripVTControlCharacters(formatComparisonOutput(comparisonOutputOf([
      { headline: { completion, headline: { kind: 'score', score: summaryOf('tts.pass', 1, 4) } }, id: 'raw', passed: 4 },
      { headline: { completion, headline: { kind: 'score', score: summaryOf('tts.pass', 3, 4) } }, id: 'rule', passed: 1 },
    ])))

    /**
     * @example
     * expect(table).toContain(' 1. rule/speech  Pass 75%  completed 75% (1 errored)')
     */
    expect(table).toContain(' 1. rule/speech  Pass 75%  completed 75% (1 errored)')
    expect(table).toContain(' 2. raw/speech  Pass 25%  completed 75% (1 errored)')
    expect(table).not.toContain('Primary scores differ')
  })

  /**
   * @example
   * it('says when primary scores differ and ranks by passed cases', () => {})
   */
  it('says when primary scores differ and ranks by passed cases', () => {
    const completion = summaryOf('completion', 4, 4)
    const table = stripVTControlCharacters(formatComparisonOutput(comparisonOutputOf([
      { headline: { completion, headline: { kind: 'score', score: summaryOf('tts.pass', 4, 4) } }, id: 'raw', passed: 1 },
      { headline: { completion, headline: { kind: 'score', score: summaryOf('tts.correct', 1, 4) } }, id: 'rule', passed: 3 },
    ])))

    /**
     * @example
     * expect(table).toContain('Primary scores differ (tts.pass, tts.correct), so the rows rank by passed cases.')
     */
    expect(table).toContain('Primary scores differ (tts.pass, tts.correct), so the rows rank by passed cases.')
    expect(table).toContain(' 1. rule/speech  passed 75% (tts.correct 25%)  completed 100%')
    expect(table).toContain(' 2. raw/speech  passed 25% (Pass 100%)  completed 100%')
  })
})
