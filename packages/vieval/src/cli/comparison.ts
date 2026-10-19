import type { ChildProcess } from 'node:child_process'
import type { Writable } from 'node:stream'

import type { RunEventEnvelope } from '../events'
import type { CliComparisonConfig } from './config'
import type { InterruptSignal } from './interrupt'
import type { CliRunOutput, RunVievalCliReporterOptions } from './run'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

import c from 'tinyrainbow'

import { errorMessageFrom } from '@moeru/std'
import { glob } from 'tinyglobby'

import packageJSON from '../../package.json'

import { runEnded, runStarted } from '../events'
import { detectCliConfigMode, loadRawVievalConfig, supportedConfigFileNames } from './config'
import { exitCodeFromSignal, listenForInterrupt } from './interrupt'
import { resolveRunReportDirectory } from './report-artifacts'
import { createRunReporter, forwardRunEventToReporter, hasRunFailures } from './run'

/**
 * File descriptor a workspace process sends its events and final output on.
 *
 * NOTICE:
 * Not stdout: eval code and plugins write to stdout freely, and one stray line would corrupt the stream. The
 * parent opens fd 3 as an extra pipe (`stdio: [..., 'pipe']`), which nothing else in the child writes to.
 */
const CHANNEL_FD = 3

/** Env variable that carries env overrides to a workspace process; argv would show secrets in `ps`. */
const ENV_OVERRIDES_VARIABLE = 'VIEVAL_ENV_OVERRIDES'

/** Lines of a workspace's stderr kept in memory to print when it fails. */
const STDERR_TAIL_LINES = 40

/**
 * One message a workspace process sends to its comparison.
 */
export type ComparisonChannelMessage
  = | { envelope: RunEventEnvelope, type: 'event' }
    | { output: CliRunOutput, type: 'output' }

/**
 * What a comparison produced.
 */
export interface ComparisonOutput {
  attemptId: string
  comparisonId: string
  configFilePath: string
  experimentId: string
  interruptSignal?: InterruptSignal
  invocationId: string
  reportRoot: null | string
  workspaces: ComparisonWorkspaceResult[]
}

/**
 * One workspace of a comparison.
 */
export interface ComparisonWorkspace {
  /** The workspace's config file. */
  configFilePath: string
  /** Env overrides for the workspace: the comparison's env, then the entry's own. */
  env: NodeJS.ProcessEnv
  id: string
  root: string
}

/**
 * Result of one workspace process.
 */
export interface ComparisonWorkspaceResult {
  /** Why the workspace has no output: it did not start, crashed, or exited without sending one. */
  errorMessage?: string
  exitCode: null | number
  id: string
  /** Output of the workspace's `vieval run`, when it finished. */
  output?: CliRunOutput
  signal: null | string
  /** Last lines of the workspace's stderr, kept for failures. */
  stderrTail: string[]
}

/**
 * A comparison config with its workspaces resolved to directories.
 */
export interface LoadedComparison {
  /** Shared cache, when the comparison declares one. */
  cache?: { namespace: string, root: string, scope: string }
  configFilePath: string
  /** Comparison id stamped on every run. */
  id: string
  /** Most workspaces running at once; `undefined` runs all at once. */
  workspaceConcurrency: number | undefined
  workspaces: ComparisonWorkspace[]
}

/**
 * Options of {@link runComparison}.
 */
export interface RunComparisonOptions {
  /** Attempt id shared by every workspace. @default `attempt-<ISO time>` */
  attempt?: string
  case?: string[]
  caseConcurrency?: number
  configFilePath?: string
  cwd?: string
  /** Experiment id shared by every workspace. @default the comparison id */
  experiment?: string
  /** Called once the report root is known, before any workspace starts (the viewer starts here). */
  onStart?: (context: { reportRoot: null | string }) => Promise<void> | void
  project?: string[]
  projectConcurrency?: number
  /** @default true */
  report?: boolean
  reporter?: RunVievalCliReporterOptions
  /** @default `.vieval/reports` next to the comparison config */
  reportOut?: string
  /**
   * Command that starts `vieval` for a workspace, as `[executable, ...args]`.
   *
   * @default node with the bin of the `vieval` the workspace resolves (see {@link resolveWorkspaceVieval})
   */
  resolveCommand?: (workspace: ComparisonWorkspace) => string[]
  task?: string[]
  taskConcurrency?: number
  workspace?: string[]
  workspaceConcurrency?: number
}

/**
 * Exit code of a comparison: the interrupt's, else 1 when any workspace failed or had failing cases, else 0.
 */
export function comparisonExitCode(output: ComparisonOutput): number {
  if (output.interruptSignal != null) {
    return exitCodeFromSignal(output.interruptSignal)
  }
  return output.workspaces.some(workspace => workspace.output == null || hasRunFailures(workspace.output)) ? 1 : 0
}

/**
 * Formats the leaderboard of a comparison: one row per project of every workspace, best hybrid score first, then
 * every workspace that failed with its reason.
 */
export function formatComparisonOutput(output: ComparisonOutput): string {
  const rows = output.workspaces.flatMap(workspace => (workspace.output?.projects ?? []).map(project => ({ project, workspace })))
  rows.sort((left, right) => (right.project.result?.overall.hybridAverage ?? -1) - (left.project.result?.overall.hybridAverage ?? -1))
  const score = (value: null | number | undefined) => value == null ? '-' : value.toFixed(3)
  const lines = [
    ` ${c.dim('COMPARE')}  ${c.yellow(output.comparisonId)}  ${c.dim(`${output.workspaces.length} workspaces, invocation ${output.invocationId}`)}`,
    '',
    ...rows.map(({ project, workspace }, index) => {
      const cases = project.caseSummary
      const failed = project.errorMessage != null || (cases != null && (cases.failed > 0 || cases.timeout > 0))
      return ` ${failed ? c.red('✗') : c.green('✓')} ${String(index + 1).padStart(2)}. ${workspace.id}/${project.name}  hybrid ${score(project.result?.overall.hybridAverage)}  exact ${score(project.result?.overall.exactAverage)}  cases ${cases?.passed ?? 0}/${cases?.total ?? 0}${cases != null && cases.failed > 0 ? c.red(` (${cases.failed} failed)`) : ''}${project.errorMessage == null ? '' : c.red(`  ${project.errorMessage}`)}${workspace.output?.interruptSignal == null ? '' : c.yellow(`  interrupted by ${workspace.output.interruptSignal}`)}`
    }),
    ...output.workspaces.filter(workspace => workspace.output == null).flatMap(workspace => [
      ` ${c.red('✗')} ${workspace.id}  ${c.red(workspace.errorMessage ?? 'failed')}`,
      ...workspace.stderrTail.map(line => `     ${c.dim(line)}`),
    ]),
  ]
  if (output.reportRoot != null) {
    lines.push('', ` ${c.dim('Reports')}  ${output.reportRoot}`)
  }
  return lines.join('\n')
}

/**
 * Loads a comparison config and resolves its workspace entries to directories, without loading any workspace
 * config (each workspace loads its own, once, in its own process).
 *
 * Use when:
 * - `vieval run` was given a config that lists `workspaces`
 *
 * Expects:
 * - glob entries are relative to the comparison config; directories without a `vieval.config.*` are skipped,
 *   a plain path without one is an error; entries starting with `!` exclude directories
 *
 * Returns:
 * - workspaces in entry order (glob matches sorted), with unique ids
 */
export async function loadComparison(options: { configFilePath?: string, cwd?: string }): Promise<LoadedComparison> {
  const loaded = await loadRawVievalConfig({ configFilePath: options.configFilePath, cwd: options.cwd })
  if (loaded.config == null || loaded.configFilePath == null || detectCliConfigMode(loaded.config) !== 'comparison') {
    throw new Error('Expected a comparison config, which lists `workspaces`.')
  }

  const config = loaded.config as CliComparisonConfig
  const directory = dirname(loaded.configFilePath)
  const id = sanitizeSegment(config.id ?? basename(directory))
  const excludes = config.workspaces.filter((entry): entry is string => typeof entry === 'string' && entry.startsWith('!')).map(entry => entry.slice(1))
  const workspaces: ComparisonWorkspace[] = []

  for (const entry of config.workspaces) {
    if (typeof entry === 'string' && entry.startsWith('!')) {
      continue
    }
    const explicit = typeof entry === 'string' ? undefined : entry
    const pattern = typeof entry === 'string' ? entry : entry.root
    const isGlob = /[*?[\]{}]/.test(pattern)
    const roots = isGlob
      ? (await glob(pattern, { absolute: true, cwd: directory, ignore: excludes, onlyDirectories: true })).map(path => resolve(path)).sort()
      : [isAbsolute(pattern) ? pattern : resolve(directory, pattern)]

    for (const root of roots) {
      const configFilePath = supportedConfigFileNames.map(name => join(root, name)).find(path => existsSync(path))
      if (configFilePath == null) {
        if (isGlob) {
          continue
        }
        throw new Error(`Workspace "${pattern}" has no vieval.config.* in ${root}.`)
      }
      workspaces.push({
        configFilePath,
        env: { ...config.env, ...explicit?.env },
        id: sanitizeSegment(explicit?.id ?? basename(root)),
        root,
      })
    }
  }

  const seen = new Map<string, string>()
  for (const workspace of workspaces) {
    const other = seen.get(workspace.id)
    if (other != null) {
      throw new Error(`Two workspaces have the id "${workspace.id}": ${other} and ${workspace.root}. Give one an explicit id ({ id, root }).`)
    }
    seen.set(workspace.id, workspace.root)
  }
  if (workspaces.length === 0) {
    throw new Error(`Comparison "${id}" found no workspace. Entries: ${config.workspaces.join(', ')}.`)
  }

  return {
    ...(config.cache == null ? {} : { cache: { namespace: config.cache.namespace, root: join(directory, '.vieval', 'cache'), scope: id } }),
    configFilePath: loaded.configFilePath,
    id,
    workspaceConcurrency: config.concurrency?.workspace,
    workspaces,
  }
}

/**
 * Opens the channel a workspace process sends its events and output on, when a comparison started it.
 *
 * Use when:
 * - `vieval run --comparison-child` runs one workspace for its comparison
 *
 * Returns:
 * - a sender of {@link ComparisonChannelMessage}s, and `close()` that resolves once everything was written
 */
export function openComparisonChannel(): { close: () => Promise<void>, send: (message: ComparisonChannelMessage) => void } {
  const stream: Writable = createWriteStream('', { fd: CHANNEL_FD })
  return {
    close: () => new Promise<void>(resolveClose => stream.end(resolveClose)),
    send(message) {
      stream.write(`${JSON.stringify(message)}\n`)
    },
  }
}

/**
 * Env overrides a comparison passed to this workspace process.
 */
export function readComparisonEnvOverrides(): NodeJS.ProcessEnv | undefined {
  const raw = process.env[ENV_OVERRIDES_VARIABLE]
  return raw == null ? undefined : JSON.parse(raw) as NodeJS.ProcessEnv
}

/**
 * Resolves the `vieval` executable a workspace itself depends on.
 *
 * NOTICE:
 * A workspace from another repository can pin its own vieval, and its eval files import that copy. Running it
 * with the comparison's vieval would load its modules with a different version, so the comparison refuses a
 * workspace whose vieval is missing (dependencies not installed) or has another version, instead of falling back.
 * `createRequire(...).resolve` walks `node_modules` up from the workspace, as Node does for the workspace's own
 * imports.
 */
export function resolveWorkspaceVieval(workspace: ComparisonWorkspace): string {
  let entry: string
  try {
    entry = createRequire(join(workspace.root, 'noop.js')).resolve('vieval')
  }
  catch {
    throw new Error(`Workspace "${workspace.id}" does not resolve the "vieval" package from ${workspace.root}. Install its dependencies first.`)
  }

  let packageDirectory = dirname(entry)
  while (!existsSync(join(packageDirectory, 'package.json')) && dirname(packageDirectory) !== packageDirectory) {
    packageDirectory = dirname(packageDirectory)
  }
  const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf-8')) as { bin?: Record<string, string> | string, version?: string }
  if (manifest.version !== packageJSON.version) {
    throw new Error(`Workspace "${workspace.id}" uses vieval ${manifest.version ?? '(unknown)'}, this comparison runs ${packageJSON.version}. Use one vieval version for every workspace.`)
  }
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.vieval
  if (bin == null) {
    throw new Error(`The vieval package at ${packageDirectory} declares no "vieval" bin.`)
  }
  return join(packageDirectory, bin)
}

/**
 * Runs a comparison: one `vieval run` process per workspace, all writing into one report root and sharing one
 * invocation, with one live window over all of them and a leaderboard at the end.
 *
 * Call stack:
 *
 * `vieval run` (../eval-run)
 *   -> {@link loadComparison}
 *   -> {@link runComparison}
 *     -> `spawn(vieval run --comparison-child ...)` per workspace, at most `workspaceConcurrency` at once
 *       -> {@link forwardRunEventToReporter} for each event on the workspace's channel (fd 3)
 *     -> {@link formatComparisonOutput}
 *
 * Use when:
 * - comparing several workspaces (often other repositories, expanded as submodules) on one benchmark
 *
 * Expects:
 * - each workspace resolves a `vieval` of the same version as this one
 *
 * Returns:
 * - every workspace's result; a failing workspace never stops the others
 */
export async function runComparison(options: RunComparisonOptions = {}): Promise<ComparisonOutput> {
  const comparison = await loadComparison({ configFilePath: options.configFilePath, cwd: options.cwd })
  const workspaces = selectWorkspaces(comparison.workspaces, options.workspace ?? [])
  const resolveCommand = options.resolveCommand ?? (workspace => [process.execPath, resolveWorkspaceVieval(workspace)])
  // Resolve every command first, so a workspace without vieval fails the comparison before anything runs.
  const commands = new Map(workspaces.map(workspace => [workspace.id, resolveCommand(workspace)]))
  const invocationId = `invocation-${Date.now()}-${randomUUID().slice(0, 8)}`
  const experimentId = sanitizeSegment(options.experiment ?? comparison.id)
  const attemptId = sanitizeSegment(options.attempt ?? `attempt-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  const reportRoot = options.report === false ? null : resolve(options.reportOut ?? join(dirname(comparison.configFilePath), '.vieval', 'reports'))
  await options.onStart?.({ reportRoot })

  const reporter = createRunReporter(options.reporter)
  const results = new Map<string, ComparisonWorkspaceResult>()
  const children = new Set<ChildProcess>()
  let interruptSignal: InterruptSignal | undefined
  // Workspace processes run in their own process groups, so nothing ends them with this process; end them here.
  const killChildren = () => {
    for (const child of children) {
      child.kill('SIGKILL')
    }
  }
  process.once('exit', killChildren)
  const stopListening = listenForInterrupt({
    onForceExit(signal) {
      // Each workspace gives up waiting for its cleanup on its second signal, like a single run.
      for (const child of children) {
        child.kill(signal)
      }
      reporter.dispose()
      process.exit(exitCodeFromSignal(signal))
    },
    onInterrupt(signal) {
      interruptSignal = signal
      for (const child of children) {
        child.kill(signal)
      }
      process.stderr.write(`\n${signal} received: stopping every workspace after its running cases clean up. Press Ctrl+C again to exit immediately.\n`)
    },
  })

  const sharedArgs = [
    '--comparison-child',
    '--invocation',
    invocationId,
    '--comparison-id',
    comparison.id,
    '--experiment',
    experimentId,
    '--attempt',
    attemptId,
    ...(reportRoot == null ? ['--no-report'] : ['--report-out', reportRoot]),
    ...(comparison.cache == null ? [] : ['--cache-root', comparison.cache.root, '--cache-scope', comparison.cache.scope, '--cache-namespace', comparison.cache.namespace]),
    ...(options.project ?? []).flatMap(name => ['--project', name]),
    ...(options.task ?? []).flatMap(name => ['--task', name]),
    ...(options.case ?? []).flatMap(name => ['--case', name]),
    ...(options.projectConcurrency == null ? [] : ['--project-concurrency', String(options.projectConcurrency)]),
    ...(options.taskConcurrency == null ? [] : ['--task-concurrency', String(options.taskConcurrency)]),
    ...(options.caseConcurrency == null ? [] : ['--case-concurrency', String(options.caseConcurrency)]),
  ]
  // One run start for the whole window; each workspace's tasks join it as they are queued.
  reporter.onRunStart({ totalTasks: 0 })

  try {
    await runWithLimit(workspaces, smallestDefined(comparison.workspaceConcurrency, options.workspaceConcurrency), async (workspace) => {
      if (interruptSignal != null) {
        results.set(workspace.id, { errorMessage: `Not started: interrupted by ${interruptSignal}.`, exitCode: null, id: workspace.id, signal: null, stderrTail: [] })
        return
      }
      const [executable, ...prefix] = commands.get(workspace.id)!
      const result = await runWorkspaceProcess({
        args: [...prefix, 'run', '--config', workspace.configFilePath, '--workspace-id', workspace.id, ...sharedArgs],
        children,
        env: workspace.env,
        executable: executable!,
        onEnvelope(envelope) {
          forwardRunEventToReporter(envelope, reporter, { workspaceName: workspace.id })
        },
        reportRoot,
        workspace,
      })
      results.set(workspace.id, result)
    })
  }
  finally {
    stopListening()
    process.off('exit', killChildren)
    reporter.dispose()
  }

  // Workspaces accept selectors that match nothing in them (each workspace names its projects differently); the
  // comparison fails when they match nothing anywhere, as a single run would.
  const selectors = [...options.project ?? [], ...options.task ?? [], ...options.case ?? []]
  const finished = [...results.values()].filter(result => result.output != null)
  if (selectors.length > 0 && finished.length > 0 && finished.every(result => result.output!.projects.every(project => project.taskCount === 0))) {
    throw new Error(`No workspace has a project, task, or case matching ${selectors.map(selector => `"${selector}"`).join(', ')}.`)
  }

  return {
    attemptId,
    comparisonId: comparison.id,
    configFilePath: comparison.configFilePath,
    experimentId,
    ...(interruptSignal == null ? {} : { interruptSignal }),
    invocationId,
    reportRoot,
    workspaces: workspaces.map(workspace => results.get(workspace.id)!),
  }
}

/**
 * Runs `work` for every item, at most `limit` at once, starting the next item as soon as one settles.
 */
async function runWithLimit<T>(items: readonly T[], limit: number | undefined, work: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: Math.max(1, Math.min(limit ?? items.length, items.length)) }, async () => {
    for (let item = queue.shift(); item != null; item = queue.shift()) {
      await work(item)
    }
  })
  await Promise.all(workers)
}

async function runWorkspaceProcess(options: {
  args: string[]
  children: Set<ChildProcess>
  env: NodeJS.ProcessEnv
  executable: string
  onEnvelope: (envelope: RunEventEnvelope) => void
  reportRoot: null | string
  workspace: ComparisonWorkspace
}): Promise<ComparisonWorkspaceResult> {
  const child = spawn(options.executable, options.args, {
    cwd: options.workspace.root,
    // NOTICE:
    // Ctrl+C in a terminal signals the whole foreground process group. A workspace process in that group would get
    // the terminal's SIGINT and the comparison's forwarded one, take the second as "exit immediately", and skip
    // writing its summaries. Its own group leaves forwarding to the comparison, once per signal.
    // Source: https://nodejs.org/api/child_process.html#optionsdetached
    detached: true,
    env: { ...process.env, [ENV_OVERRIDES_VARIABLE]: JSON.stringify(options.env) },
    stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
  })
  options.children.add(child)

  let output: CliRunOutput | undefined
  // Runs that started but never ended, keyed by run id, to record how they ended if the process dies.
  const openRuns = new Map<string, RunEventEnvelope>()
  const stderrTail: string[] = []
  const channel = createInterface({ input: child.stdio[3] as NodeJS.ReadableStream })
  channel.on('line', (line) => {
    let message: ComparisonChannelMessage
    try {
      message = JSON.parse(line) as ComparisonChannelMessage
    }
    catch {
      return
    }
    if (message.type === 'output') {
      output = message.output
      return
    }
    if (message.envelope.event === runStarted.id) {
      openRuns.set(message.envelope.runId, message.envelope)
    }
    if (message.envelope.event === runEnded.id) {
      openRuns.delete(message.envelope.runId)
    }
    options.onEnvelope(message.envelope)
  })
  createInterface({ input: child.stderr! }).on('line', (line) => {
    stderrTail.push(line)
    if (stderrTail.length > STDERR_TAIL_LINES) {
      stderrTail.shift()
    }
  })

  const exit = await new Promise<{ code: null | number, error?: Error, signal: null | string }>((resolveExit) => {
    child.once('error', error => resolveExit({ code: null, error, signal: null }))
    child.once('close', (code, signal) => resolveExit({ code, signal }))
  })
  options.children.delete(child)

  // A run whose process died has no `run.ended`; the viewer would show it running until it turns stale. The
  // comparison records how the process ended next to the run, in a file only it writes (the run's log has one writer).
  if (options.reportRoot != null) {
    for (const started of openRuns.values()) {
      if (started.projectId == null) {
        continue
      }
      const directory = resolveRunReportDirectory(options.reportRoot, started, started.projectId)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'process-exit.json'), `${JSON.stringify({ code: exit.code, endedAt: new Date().toISOString(), signal: exit.signal, stderrTail }, null, 2)}\n`, 'utf-8')
    }
  }

  const errorMessage = exit.error != null
    ? `Could not start: ${errorMessageFrom(exit.error) ?? 'unknown error'}`
    : output == null
      ? `Exited with ${exit.signal == null ? `code ${String(exit.code)}` : `signal ${exit.signal}`} before sending its output.`
      : undefined
  return {
    ...(errorMessage == null ? {} : { errorMessage }),
    exitCode: exit.code,
    id: options.workspace.id,
    ...(output == null ? {} : { output }),
    signal: exit.signal,
    stderrTail,
  }
}

/**
 * Normalizes an id into one safe path segment.
 *
 * Before:
 * - `eval/test-objects/raw:formula-speech-raw`
 *
 * After:
 * - `eval-test-objects-raw-formula-speech-raw`
 */
function sanitizeSegment(value: string): string {
  const normalized = value.trim().replace(/[^\w.-]+/g, '-')
  return normalized.length === 0 ? 'default' : normalized
}

function selectWorkspaces(workspaces: readonly ComparisonWorkspace[], selectors: readonly string[]): ComparisonWorkspace[] {
  if (selectors.length === 0) {
    return [...workspaces]
  }
  const unknown = selectors.filter(selector => !workspaces.some(workspace => workspace.id === selector))
  if (unknown.length > 0) {
    throw new Error(`No workspace matches ${unknown.map(selector => `"${selector}"`).join(', ')}. Workspaces: ${workspaces.map(workspace => workspace.id).join(', ')}.`)
  }
  return workspaces.filter(workspace => selectors.includes(workspace.id))
}

function smallestDefined(left: number | undefined, right: number | undefined): number | undefined {
  return left == null || right == null ? left ?? right : Math.min(left, right)
}
