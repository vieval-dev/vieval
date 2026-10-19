import type { ResumeHintInput } from './resume'
import type { CliProjectSummary } from './run'
import type { RunReadyHook, ViewerHost, ViewerModule } from './viewer-host'

import process from 'node:process'

import { dirname, resolve } from 'node:path'

import meow from 'meow'

import { errorMessageFrom } from '@moeru/std'

import packageJSON from '../../package.json'

import { comparisonExitCode, formatComparisonOutput, openComparisonChannel, readComparisonEnvOverrides, runComparison } from './comparison'
import { resolveVievalConfigMode } from './config'
import { exitCodeFromSignal } from './interrupt'
import { formatResumeHint, LATEST_ATTEMPT } from './resume'
import { formatVievalCliRunOutput, hasRunFailures, runVievalCli } from './run'
import { DEFAULT_VIEWER_HOST, DEFAULT_VIEWER_PORT, importViewer } from './viewer-host'

/**
 * Process-bound dependencies of {@link runEvalRunCli}, replaceable by tests.
 */
export interface EvalRunCliRuntime {
  /**
   * Loads the optional viewer package.
   *
   * @default {@link importViewer}
   */
  importViewer?: (baseDirectory: string) => Promise<ViewerModule>
}

interface ParsedCliArguments {
  attempt?: string
  case: string[]
  caseConcurrency?: number
  /** Set when a comparison started this process for one of its workspaces; see {@link ParsedComparisonChild}. */
  comparisonChild?: ParsedComparisonChild
  configFilePath?: string
  experiment?: string
  json: boolean
  project: string[]
  projectConcurrency?: number
  report: boolean
  reportOut?: string
  resume?: string
  task: string[]
  taskConcurrency?: number
  viewer?: ParsedViewerArguments
  workspace: string[]
  workspaceConcurrency?: number
}

/** What a comparison tells the process it starts for one workspace (internal flags, not in `--help`). */
interface ParsedComparisonChild {
  cache?: { namespace: string, root: string, scope: string }
  comparisonId?: string
  invocationId?: string
  workspaceId?: string
}

interface ParsedViewerArguments {
  host: string
  open: boolean
  port: number
}

const evalRunHelpText = `
  Run a workspace (a config that lists projects) or a comparison (a config that lists workspaces).

  Usage
    $ vieval run [--config <path>] [selectors] [--report-out <path> | --no-report] [--with-viewer [--open]]

  Selectors (each may be repeated; a value with * is a glob)
    --workspace <id>   Workspaces of a comparison to run
    --project <name>   Projects to run
    --task <name>      Tasks to run, by describeTask name or entry id
    --case <name>      Cases to run, by case name
                       A selector that matches nothing is an error.

  Options
    --config     Config file path (default: nearest vieval.config.*)
    --experiment Experiment id used in report artifacts
    --attempt    Attempt id used in report artifacts
    --resume [id]  Continue an attempt (default: the latest): run, as a new attempt, its cases without a result
    --workspace-concurrency Most workspaces of a comparison running at once (default: all)
    --project-concurrency   Most projects running at once (default: 1 without a task or case pool, else unbounded)
    --task-concurrency      Most tasks running at once in the whole run
    --case-concurrency      Most cases running at once in the whole run
                            Concurrency flags apply to the whole run and never raise a value set in config
    --report-out Report output root directory (default: .vieval/reports next to the config file)
    --no-report  Do not write reports or case artifacts
    --json       Print machine-readable JSON output
    --with-viewer  Serve the web viewer (package @vieval/ui) for this run; keeps serving after
                   the run ends until Ctrl+C
    --port <port>  Viewer port (default: ${DEFAULT_VIEWER_PORT}; 0 picks a free port)
    --host <host>  Viewer host (default: ${DEFAULT_VIEWER_HOST})
    --open         Open the viewer in a browser
`

interface LoadedViewer {
  getHost: () => undefined | ViewerHost
  onRunReady: RunReadyHook
  startStatic: (reportRoot: null | string) => Promise<void>
}

/**
 * Parses `vieval run` CLI arguments into one normalized execution payload.
 *
 * Use when:
 * - the top-level CLI forwards `run` subcommand arguments
 * - tests need stable flag normalization without executing the runner
 *
 * Expects:
 * - argv in either direct `run` form or forwarded `-- ...` form
 *
 * Returns:
 * - normalized run options ready for {@link runVievalCli} or {@link runComparison}
 */
export function parseCliArguments(argv: readonly string[]): ParsedCliArguments {
  const cli = meow(evalRunHelpText, {
    argv: normalizeCliArgv(argv),
    flags: {
      attempt: { type: 'string' },
      cacheNamespace: { type: 'string' },
      cacheRoot: { type: 'string' },
      cacheScope: { type: 'string' },
      case: { isMultiple: true, type: 'string' },
      caseConcurrency: { type: 'number' },
      comparisonChild: { default: false, type: 'boolean' },
      comparisonId: { type: 'string' },
      config: { type: 'string' },
      experiment: { type: 'string' },
      host: { type: 'string' },
      invocation: { type: 'string' },
      json: { default: false, type: 'boolean' },
      open: { default: false, type: 'boolean' },
      port: { type: 'number' },
      project: { isMultiple: true, type: 'string' },
      projectConcurrency: { type: 'number' },
      // meow turns `--no-report` into `report: false`.
      report: { default: true, type: 'boolean' },
      reportOut: { type: 'string' },
      resume: { type: 'string' },
      task: { isMultiple: true, type: 'string' },
      taskConcurrency: { type: 'number' },
      withViewer: { default: false, type: 'boolean' },
      workspace: { isMultiple: true, type: 'string' },
      workspaceConcurrency: { type: 'number' },
      workspaceId: { type: 'string' },
    },
    importMeta: import.meta,
  })
  const flags = cli.flags

  return {
    attempt: flags.attempt,
    case: flags.case ?? [],
    caseConcurrency: flags.caseConcurrency,
    ...(flags.comparisonChild
      ? {
          comparisonChild: {
            ...(flags.cacheRoot == null || flags.cacheScope == null || flags.cacheNamespace == null ? {} : { cache: { namespace: flags.cacheNamespace, root: flags.cacheRoot, scope: flags.cacheScope } }),
            comparisonId: flags.comparisonId,
            invocationId: flags.invocation,
            workspaceId: flags.workspaceId,
          },
        }
      : {}),
    configFilePath: flags.config,
    experiment: flags.experiment,
    json: flags.json,
    project: flags.project ?? [],
    projectConcurrency: flags.projectConcurrency,
    report: flags.report,
    reportOut: flags.reportOut,
    // `--resume` alone continues the latest attempt.
    resume: flags.resume === '' ? LATEST_ATTEMPT : flags.resume,
    task: flags.task ?? [],
    taskConcurrency: flags.taskConcurrency,
    ...(flags.withViewer
      ? {
          viewer: {
            host: flags.host ?? DEFAULT_VIEWER_HOST,
            open: flags.open,
            port: normalizeViewerPort(flags.port ?? DEFAULT_VIEWER_PORT),
          },
        }
      : {}),
    workspace: flags.workspace ?? [],
    workspaceConcurrency: flags.workspaceConcurrency,
  }
}

/**
 * Executes the `vieval run` subcommand.
 *
 * Call stack:
 *
 * top-level `vieval` CLI
 *   -> {@link runTopLevelCli} (`./index`)
 *     -> {@link runEvalRunCli}
 *       -> {@link parseCliArguments}
 *       -> {@link resolveVievalConfigMode}
 *       -> {@link importViewer} (only with `--with-viewer`)
 *       -> comparison config: {@link runComparison}
 *            -> one `vieval run --comparison-child` process per workspace (this function again, in {@link runComparisonChild})
 *       -> workspace config: {@link runVievalCli} (with `onRunReady` attaching the viewer, only with `--with-viewer`)
 *       -> `process.stdout.write(...)` / `process.stderr.write(...)`
 *       -> `process.exitCode`
 *       -> {@link ViewerHost.waitUntilClosed} (only with `--with-viewer`)
 *
 * Use when:
 * - the published `vieval` binary needs to execute the `run` subcommand
 * - callers want one reusable implementation without a second bundled entrypoint
 *
 * Expects:
 * - argv that belongs to the `run` subcommand only
 *
 * Returns:
 * - resolves after writing CLI output and updating `process.exitCode`; with `--with-viewer`, after the viewer
 *   was closed (Ctrl+C), keeping the exit code of the run
 *
 * NOTICE:
 * - `src/cli/index.ts` is the only direct-execution entrypoint for the bundled
 *   CLI artifact. Keeping `eval-run.ts` reusable avoids duplicate top-level
 *   await guards once tsdown inlines both modules into `dist/cli/index.mjs`.
 */
export async function runEvalRunCli(argv: readonly string[], runtime: EvalRunCliRuntime = {}): Promise<void> {
  let parsed: ParsedCliArguments
  try {
    parsed = parseCliArguments(argv)
    if (parsed.comparisonChild != null) {
      await runComparisonChild(parsed, parsed.comparisonChild)
      return
    }
  }
  catch (error) {
    writeCliError(error)
    return
  }

  const viewer = parsed.viewer == null
    ? undefined
    : await loadViewer(parsed, runtime)
  if (viewer === null) {
    return
  }

  try {
    const mode = await resolveVievalConfigMode({ configFilePath: parsed.configFilePath })
    if (mode === 'comparison') {
      const output = await runComparison({
        attempt: parsed.attempt,
        case: parsed.case,
        caseConcurrency: parsed.caseConcurrency,
        configFilePath: parsed.configFilePath,
        experiment: parsed.experiment,
        ...(viewer == null ? {} : { onStart: async ({ reportRoot }) => viewer.startStatic(reportRoot) }),
        project: parsed.project,
        projectConcurrency: parsed.projectConcurrency,
        report: parsed.report,
        reportOut: parsed.reportOut,
        resume: parsed.resume,
        task: parsed.task,
        taskConcurrency: parsed.taskConcurrency,
        workspace: parsed.workspace,
        workspaceConcurrency: parsed.workspaceConcurrency,
      })
      process.stdout.write(`${parsed.json ? JSON.stringify(output, null, 2) : formatComparisonOutput(output)}\n`)
      const workspaceOutputs = output.workspaces.flatMap(workspace => workspace.output == null ? [] : [workspace.output])
      writeResumeHint(parsed, {
        attemptId: output.attemptId,
        interruptSignal: output.interruptSignal,
        noResult: countNoResult(workspaceOutputs.flatMap(workspaceOutput => workspaceOutput.projects)),
        unfinishedWorkspaces: output.workspaces.length - workspaceOutputs.length,
      })
      process.exitCode = comparisonExitCode(output)
    }
    else {
      if (parsed.workspace.length > 0 || parsed.workspaceConcurrency != null) {
        throw new Error('--workspace and --workspace-concurrency select workspaces of a comparison; this config is a workspace (it lists projects).')
      }
      const output = await runVievalCli({
        attempt: parsed.attempt,
        case: parsed.case,
        caseConcurrency: parsed.caseConcurrency,
        configFilePath: parsed.configFilePath,
        experiment: parsed.experiment,
        project: parsed.project,
        projectConcurrency: parsed.projectConcurrency,
        report: parsed.report,
        reportOut: parsed.reportOut,
        resume: parsed.resume,
        task: parsed.task,
        taskConcurrency: parsed.taskConcurrency,
        ...(viewer == null ? {} : { onRunReady: viewer.onRunReady }),
      })

      process.stdout.write(`${parsed.json ? JSON.stringify(output, null, 2) : formatVievalCliRunOutput(output)}\n`)
      if (output.attemptId != null) {
        writeResumeHint(parsed, {
          attemptId: output.attemptId,
          interruptSignal: output.interruptSignal,
          noResult: countNoResult(output.projects),
        })
      }
      // An interrupted run exits like a process ended by that signal, so shells and CI see the interrupt.
      if (output.interruptSignal != null) {
        process.exitCode = exitCodeFromSignal(output.interruptSignal)
      }
      else if (hasRunFailures(output)) {
        process.exitCode = 1
      }
    }
  }
  catch (error) {
    writeCliError(error)
  }

  const host = viewer?.getHost()
  if (host != null) {
    await serveUntilClosed(host)
  }
}

/** Counts the cases of finished projects that ended without a result. */
function countNoResult(projects: readonly CliProjectSummary[]): { errored: number, timeout: number } {
  return {
    errored: projects.reduce((sum, project) => sum + (project.caseSummary?.errored ?? 0), 0),
    timeout: projects.reduce((sum, project) => sum + (project.caseSummary?.timeout ?? 0), 0),
  }
}

/**
 * Loads the viewer before the run starts, so a missing package fails fast instead of after a long run.
 *
 * Returns:
 * - the hook that starts the viewer on the first ready run and attaches every run to it, and a starter for a
 *   comparison, whose runs are written by other processes and read from the report root
 * - `null` after reporting a load failure (exit code 1)
 */
async function loadViewer(parsed: ParsedCliArguments, runtime: EvalRunCliRuntime): Promise<LoadedViewer | null> {
  const options = parsed.viewer!
  const baseDirectory = parsed.configFilePath == null ? process.cwd() : dirname(resolve(parsed.configFilePath))
  let viewerModule: ViewerModule
  try {
    viewerModule = await (runtime.importViewer ?? importViewer)(baseDirectory)
  }
  catch (error) {
    writeCliError(error)
    return null
  }

  let host: undefined | ViewerHost
  async function start(reportRoot: null | string): Promise<ViewerHost> {
    if (host == null) {
      // Started once the report root is known, so the viewer can also list earlier runs.
      host = await viewerModule.startViewer({
        host: options.host,
        mode: 'live',
        open: options.open,
        port: options.port,
        reportRoots: reportRoot == null ? [] : [reportRoot],
      })
      process.stderr.write(`Viewer: ${host.url}\n`)
    }
    return host
  }
  return {
    getHost: () => host,
    async onRunReady(context) {
      return await (await start(context.reportRoot)).attachRun(context)
    },
    async startStatic(reportRoot) {
      await start(reportRoot)
    },
  }
}

function normalizeCliArgv(argv: readonly string[]): string[] {
  const normalizedArgv = argv[0] === '--'
    ? argv.slice(1)
    : [...argv]

  return normalizedArgv[0] === 'run'
    ? normalizedArgv.slice(1)
    : normalizedArgv
}

function normalizeViewerPort(port: number): number {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid --port "${String(port)}". Expected an integer from 0 to 65535.`)
  }

  return port
}

/**
 * Runs one workspace for the comparison that started this process: no terminal output (the comparison draws one
 * window for all workspaces), every event and the final output sent on the comparison channel.
 */
async function runComparisonChild(parsed: ParsedCliArguments, child: ParsedComparisonChild): Promise<void> {
  const channel = openComparisonChannel()
  try {
    const output = await runVievalCli({
      attempt: parsed.attempt,
      case: parsed.case,
      caseConcurrency: parsed.caseConcurrency,
      ...(child.comparisonId == null ? {} : { comparisonId: child.comparisonId }),
      configFilePath: parsed.configFilePath,
      envOverrides: readComparisonEnvOverrides(),
      experiment: parsed.experiment,
      ...(child.invocationId == null ? {} : { invocationId: child.invocationId }),
      onRunReady({ bus }) {
        bus.onAny(envelope => channel.send({ envelope, type: 'event' }))
      },
      project: parsed.project,
      projectConcurrency: parsed.projectConcurrency,
      report: parsed.report,
      reporter: { isTTY: false, writeOutput: () => {} },
      reportOut: parsed.reportOut,
      resume: parsed.resume,
      // The comparison checks that its selectors match in at least one workspace.
      selectorsMayMatchNothing: true,
      ...(child.cache == null ? {} : { sharedCache: child.cache }),
      task: parsed.task,
      taskConcurrency: parsed.taskConcurrency,
      workspace: child.workspaceId,
    })
    channel.send({ output, type: 'output' })
    process.exitCode = output.interruptSignal != null ? exitCodeFromSignal(output.interruptSignal) : (hasRunFailures(output) ? 1 : 0)
  }
  finally {
    await channel.close()
  }
}

/**
 * Keeps the viewer serving after the run until Ctrl+C (or the viewer closes itself).
 *
 * The run's `process.exitCode` is left untouched, so CI and shells still see the run result.
 */
async function serveUntilClosed(host: ViewerHost): Promise<void> {
  process.stderr.write(`Viewer: ${host.url} (press Ctrl+C to exit)\n`)
  const close = () => {
    void host.close()
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
  try {
    await host.waitUntilClosed()
  }
  finally {
    process.off('SIGINT', close)
    process.off('SIGTERM', close)
  }
}

function writeCliError(error: unknown): void {
  const errorMessage = errorMessageFrom(error) ?? 'Unknown CLI failure.'
  process.stderr.write(`[${packageJSON.name}] ${errorMessage}\n`)
  process.exitCode = 1
}

/**
 * Prints the command that resumes the cases without a result, so a user who pressed Ctrl+C or hit provider errors
 * can copy it instead of looking up the attempt id. JSON output stays machine-readable, so it gets no hint.
 */
function writeResumeHint(
  parsed: ParsedCliArguments,
  ended: Pick<ResumeHintInput, 'attemptId' | 'interruptSignal' | 'noResult' | 'unfinishedWorkspaces'>,
): void {
  if (parsed.json) {
    return
  }
  const hint = formatResumeHint({
    ...ended,
    cwd: process.cwd(),
    reportEnabled: parsed.report,
    selection: {
      case: parsed.case,
      configFilePath: parsed.configFilePath,
      experiment: parsed.experiment,
      project: parsed.project,
      task: parsed.task,
      workspace: parsed.workspace,
    },
  })
  if (hint != null) {
    process.stdout.write(`\n${hint}\n`)
  }
}
