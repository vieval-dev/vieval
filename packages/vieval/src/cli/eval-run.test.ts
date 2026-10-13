import type { RunReadyContext, StartViewerOptions } from './viewer-host'

import process from 'node:process'

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { parseCliArguments, runEvalRunCli } from './eval-run'
import { importViewer } from './viewer-host'

const packageDirectory = fileURLToPath(new URL('../../', import.meta.url))
const vievalImportPath = join(packageDirectory, 'src', 'index.ts').replaceAll('\\', '/')
const viewerStubStateKey = '__VIEVAL_VIEWER_STUB_STATE__'
const MISSING_VIEWER_PACKAGE = '@vieval/ui-not-installed'
const temporaryDirectories: string[] = []

interface ViewerStubState {
  attached: RunReadyContext[]
  closed: boolean
  disposed: number
  imported: boolean
  started: StartViewerOptions[]
}

/**
 * Creates a project with one passing and one failing case and, optionally, a stand-in `@vieval/ui`
 * package in its `node_modules` that records what the CLI does with it.
 */
async function createViewerProject(options: { withViewerPackage: boolean }): Promise<string> {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'vieval-with-viewer-'))
  temporaryDirectories.push(projectDirectory)
  await mkdir(join(projectDirectory, 'evals'), { recursive: true })
  await writeFile(join(projectDirectory, 'vieval.config.ts'), `
import { defineConfig } from '${vievalImportPath}'

export default defineConfig({
  models: [{ aliases: [], id: 'mock:model-a', inferenceExecutor: 'mock', inferenceExecutorId: 'mock:model-a', model: 'model-a' }],
  projects: [{ include: ['evals/*.eval.ts'], name: 'viewer-project', root: '.' }],
})
`, 'utf-8')
  await writeFile(join(projectDirectory, 'evals', 'viewer.eval.ts'), `
import { caseOf, describeTask } from '${vievalImportPath}'

describeTask('viewer-task', () => {
  caseOf('passes', () => {})
  caseOf('fails', () => {
    throw new Error('expected failure')
  })
})
`, 'utf-8')

  if (options.withViewerPackage) {
    const viewerPackageDirectory = join(projectDirectory, 'node_modules', '@vieval', 'ui')
    await mkdir(viewerPackageDirectory, { recursive: true })
    await writeFile(join(viewerPackageDirectory, 'package.json'), JSON.stringify({
      exports: { '.': { default: './index.mjs' } },
      name: '@vieval/ui',
      type: 'module',
      version: '0.0.0',
    }), 'utf-8')
    await writeFile(join(viewerPackageDirectory, 'index.mjs'), `
const state = globalThis.${viewerStubStateKey}
state.imported = true

export async function startViewer(options) {
  state.started.push(options)
  let resolveClosed
  const closed = new Promise(resolve => { resolveClosed = resolve })
  const host = {
    url: 'http://' + options.host + ':' + options.port + '/',
    attachRun(context) {
      state.attached.push(context)
      return () => { state.disposed += 1 }
    },
    async close() {
      state.closed = true
      resolveClosed()
    },
    waitUntilClosed: () => closed,
  }
  // Stands in for the user pressing Ctrl+C after the run.
  setTimeout(() => void host.close(), 0)
  return host
}
`, 'utf-8')
  }

  return projectDirectory
}

function createViewerStubState(): ViewerStubState {
  const state: ViewerStubState = { attached: [], closed: false, disposed: 0, imported: false, started: [] }
  ;(globalThis as Record<string, unknown>)[viewerStubStateKey] = state
  return state
}

describe('parseCliArguments', () => {
  it('parses config, json, and repeated project flags', () => {
    expect(parseCliArguments(['--config', 'vieval.config.ts', '--json', '--project', 'alpha', '--project', 'beta'])).toEqual({
      attempt: undefined,
      caseConcurrency: undefined,
      configFilePath: 'vieval.config.ts',
      experiment: undefined,
      json: true,
      project: ['alpha', 'beta'],
      projectConcurrency: undefined,
      report: true,
      reportOut: undefined,
      taskConcurrency: undefined,
      workspace: undefined,
    })
  })

  it('supports equals form flags and ignores the run command token', () => {
    expect(parseCliArguments(['run', '--config=vieval.config.ts', '--project=alpha'])).toEqual({
      attempt: undefined,
      caseConcurrency: undefined,
      configFilePath: 'vieval.config.ts',
      experiment: undefined,
      json: false,
      project: ['alpha'],
      projectConcurrency: undefined,
      report: true,
      reportOut: undefined,
      taskConcurrency: undefined,
      workspace: undefined,
    })
  })

  it('normalizes forwarded argv prefixed with --', () => {
    expect(parseCliArguments(['--', '--json', '--project', 'alpha'])).toEqual({
      attempt: undefined,
      caseConcurrency: undefined,
      configFilePath: undefined,
      experiment: undefined,
      json: true,
      project: ['alpha'],
      projectConcurrency: undefined,
      report: true,
      reportOut: undefined,
      taskConcurrency: undefined,
      workspace: undefined,
    })
  })

  it('parses report identity and output flags', () => {
    expect(parseCliArguments([
      '--workspace',
      'packages/vieval',
      '--experiment',
      'baseline-v2',
      '--attempt',
      'attempt-03',
      '--report-out',
      '.vieval/reports',
    ])).toEqual({
      attempt: 'attempt-03',
      caseConcurrency: undefined,
      configFilePath: undefined,
      experiment: 'baseline-v2',
      json: false,
      project: [],
      projectConcurrency: undefined,
      report: true,
      reportOut: '.vieval/reports',
      taskConcurrency: undefined,
      workspace: 'packages/vieval',
    })
  })

  /**
   * @example
   * it('turns --no-report into report: false', () => {})
   */
  it('turns --no-report into report: false', () => {
    /**
     * @example
     * expect(parseCliArguments(['run', '--no-report']).report).toBe(false)
     */
    expect(parseCliArguments(['run', '--no-report']).report).toBe(false)
  })

  it('parses concurrency caps from eval run CLI flags', () => {
    expect(parseCliArguments([
      'run',
      '--project-concurrency',
      '3',
      '--task-concurrency',
      '4',
      '--case-concurrency',
      '6',
    ])).toMatchObject({
      caseConcurrency: 6,
      projectConcurrency: 3,
      taskConcurrency: 4,
    })
  })
})

describe('parseCliArguments viewer flags', () => {
  it('leaves the viewer off unless --with-viewer is passed', () => {
    expect(parseCliArguments(['run', '--viewer-port', '4000']).viewer).toBeUndefined()
  })

  it('parses --with-viewer with defaults', () => {
    expect(parseCliArguments(['run', '--with-viewer']).viewer).toEqual({
      host: '127.0.0.1',
      open: false,
      port: 51204,
    })
  })

  it('parses viewer port, host, and open flags', () => {
    expect(parseCliArguments(['run', '--with-viewer', '--viewer-port', '4000', '--viewer-host', '0.0.0.0', '--viewer-open']).viewer).toEqual({
      host: '0.0.0.0',
      open: true,
      port: 4000,
    })
  })

  it('rejects an invalid viewer port', () => {
    expect(() => parseCliArguments(['run', '--with-viewer', '--viewer-port', '70000'])).toThrow(
      'Invalid --viewer-port "70000". Expected an integer from 0 to 65535.',
    )
  })
})

describe('runEvalRunCli --with-viewer', () => {
  const originalExitCode = process.exitCode

  afterEach(async () => {
    process.exitCode = originalExitCode
    delete (globalThis as Record<string, unknown>)[viewerStubStateKey]
    await Promise.all(temporaryDirectories.map(async directory => await rm(directory, { force: true, recursive: true })))
    temporaryDirectories.length = 0
  })

  it('does not load the viewer package without --with-viewer', async () => {
    const state = createViewerStubState()
    const projectDirectory = await createViewerProject({ withViewerPackage: true })

    await runEvalRunCli(['run', '--config', join(projectDirectory, 'vieval.config.ts'), '--no-report'])

    expect(state.imported).toBe(false)
    expect(process.exitCode).toBe(1)
  })

  it('starts the viewer from the project, attaches the run, serves until closed, and keeps the run exit code', async () => {
    const state = createViewerStubState()
    const projectDirectory = await createViewerProject({ withViewerPackage: true })

    await runEvalRunCli([
      'run',
      '--config',
      join(projectDirectory, 'vieval.config.ts'),
      '--with-viewer',
      '--viewer-port',
      '4321',
      '--attempt',
      'attempt-viewer',
    ])

    expect(state.imported).toBe(true)
    expect(state.started).toEqual([{
      host: '127.0.0.1',
      mode: 'live',
      open: false,
      port: 4321,
      reportRoots: [join(projectDirectory, '.vieval', 'reports')],
    }])
    expect(state.attached).toHaveLength(1)
    expect(state.attached[0]?.identity.attemptId).toBe('attempt-viewer')
    expect(state.disposed).toBe(1)
    expect(state.closed).toBe(true)
    // One case failed, so the run still exits with 1 after the viewer closed.
    expect(process.exitCode).toBe(1)
  })

  it('fails before running when the viewer package is missing', async () => {
    const projectDirectory = await createViewerProject({ withViewerPackage: false })
    const runs: string[] = []

    await runEvalRunCli(['run', '--config', join(projectDirectory, 'vieval.config.ts'), '--with-viewer'], {
      async importViewer(baseDirectory) {
        runs.push(baseDirectory)
        // `@vieval/ui` is a workspace package here, so a missing install is simulated by name.
        return await importViewer(baseDirectory, MISSING_VIEWER_PACKAGE)
      },
    })

    expect(runs).toEqual([projectDirectory])
    expect(process.exitCode).toBe(1)
    expect(existsSync(join(projectDirectory, '.vieval'))).toBe(false)
  })
})

describe('importViewer', () => {
  afterEach(async () => {
    delete (globalThis as Record<string, unknown>)[viewerStubStateKey]
    await Promise.all(temporaryDirectories.map(async directory => await rm(directory, { force: true, recursive: true })))
    temporaryDirectories.length = 0
  })

  it('explains how to install the viewer when it is missing', async () => {
    const projectDirectory = await createViewerProject({ withViewerPackage: false })

    await expect(importViewer(projectDirectory, MISSING_VIEWER_PACKAGE)).rejects.toThrow(`--with-viewer requires the "${MISSING_VIEWER_PACKAGE}" package.`)
  })

  it('resolves the viewer from the project directory', async () => {
    createViewerStubState()
    const projectDirectory = await createViewerProject({ withViewerPackage: true })

    const viewer = await importViewer(projectDirectory)

    expect(typeof viewer.startViewer).toBe('function')
  })
})
