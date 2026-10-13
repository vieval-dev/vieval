import type { RunReadyHook, ViewerHost, ViewerModule } from './viewer-host'

import process from 'node:process'

import { dirname, resolve } from 'node:path'

import meow from 'meow'

import { errorMessageFrom } from '@moeru/std'

import packageJSON from '../../package.json'

import { exitCodeFromSignal } from './interrupt'
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
  caseConcurrency?: number
  configFilePath?: string
  experiment?: string
  json: boolean
  project: string[]
  projectConcurrency?: number
  report: boolean
  reportOut?: string
  taskConcurrency?: number
  viewer?: ParsedViewerArguments
  workspace?: string
}

interface ParsedViewerArguments {
  host: string
  open: boolean
  port: number
}

const evalRunHelpText = `
  Execute vieval projects from discovered or explicit config.

  Usage
    $ vieval run [--config <path>] [--project <name>] [--json] [--report-out <path> | --no-report]

  Options
    --config     Config file path
    --project    Project name to execute; may be repeated
    --workspace  Workspace id used in report artifacts
    --experiment Experiment id used in report artifacts
    --attempt    Attempt id used in report artifacts
    --project-concurrency Most projects running at once (default: 1)
    --task-concurrency    Most tasks running at once in the whole run
    --case-concurrency    Most cases running at once in the whole run
                          Concurrency flags apply to the whole run and never raise a value set in config
    --report-out Report output root directory (default: .vieval/reports next to the config file)
    --no-report  Do not write reports or case artifacts
    --json       Print machine-readable JSON output
    --with-viewer        Serve the web viewer (package @vieval/ui) for this run; keeps serving after
                         the run ends until Ctrl+C
    --viewer-port <port> Viewer port (default: ${DEFAULT_VIEWER_PORT})
    --viewer-host <host> Viewer host (default: ${DEFAULT_VIEWER_HOST})
    --viewer-open        Open the viewer in a browser
`

interface LoadedViewer {
  getHost: () => undefined | ViewerHost
  onRunReady: RunReadyHook
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
 * - normalized run options ready for {@link runVievalCli}
 */
export function parseCliArguments(argv: readonly string[]): ParsedCliArguments {
  const cli = meow(evalRunHelpText, {
    argv: normalizeCliArgv(argv),
    flags: {
      attempt: {
        type: 'string',
      },
      caseConcurrency: {
        type: 'number',
      },
      config: {
        type: 'string',
      },
      experiment: {
        type: 'string',
      },
      json: {
        default: false,
        type: 'boolean',
      },
      project: {
        isMultiple: true,
        type: 'string',
      },
      projectConcurrency: {
        type: 'number',
      },
      // meow turns `--no-report` into `report: false`.
      report: {
        default: true,
        type: 'boolean',
      },
      reportOut: {
        type: 'string',
      },
      taskConcurrency: {
        type: 'number',
      },
      viewerHost: {
        type: 'string',
      },
      viewerOpen: {
        default: false,
        type: 'boolean',
      },
      viewerPort: {
        type: 'number',
      },
      withViewer: {
        default: false,
        type: 'boolean',
      },
      workspace: {
        type: 'string',
      },
    },
    importMeta: import.meta,
  })

  return {
    attempt: cli.flags.attempt,
    caseConcurrency: cli.flags.caseConcurrency,
    configFilePath: cli.flags.config,
    experiment: cli.flags.experiment,
    json: cli.flags.json === true,
    project: normalizeProjectNames(cli.flags.project),
    projectConcurrency: cli.flags.projectConcurrency,
    report: cli.flags.report,
    reportOut: cli.flags.reportOut,
    taskConcurrency: cli.flags.taskConcurrency,
    ...(cli.flags.withViewer
      ? {
          viewer: {
            host: cli.flags.viewerHost ?? DEFAULT_VIEWER_HOST,
            open: cli.flags.viewerOpen,
            port: normalizeViewerPort(cli.flags.viewerPort ?? DEFAULT_VIEWER_PORT),
          },
        }
      : {}),
    workspace: cli.flags.workspace,
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
 *       -> {@link importViewer} (only with `--with-viewer`)
 *       -> {@link runVievalCli} (with `onRunReady` attaching the viewer, only with `--with-viewer`)
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
  const parsed = parseCliArguments(argv)

  const viewer = parsed.viewer == null
    ? undefined
    : await loadViewer(parsed, runtime)
  if (viewer === null) {
    return
  }

  try {
    const output = await runVievalCli({
      attempt: parsed.attempt,
      caseConcurrency: parsed.caseConcurrency,
      configFilePath: parsed.configFilePath,
      experiment: parsed.experiment,
      project: parsed.project,
      projectConcurrency: parsed.projectConcurrency,
      report: parsed.report,
      reportOut: parsed.reportOut,
      taskConcurrency: parsed.taskConcurrency,
      ...(viewer == null ? {} : { onRunReady: viewer.onRunReady }),
      workspace: parsed.workspace,
    })

    process.stdout.write(`${parsed.json ? JSON.stringify(output, null, 2) : formatVievalCliRunOutput(output)}\n`)
    // An interrupted run exits like a process ended by that signal, so shells and CI see the interrupt.
    if (output.interruptSignal != null) {
      process.exitCode = exitCodeFromSignal(output.interruptSignal)
    }
    else if (hasRunFailures(output)) {
      process.exitCode = 1
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

/**
 * Loads the viewer before the run starts, so a missing package fails fast instead of after a long run.
 *
 * Returns:
 * - the hook that starts the viewer on the first ready run and attaches every run to it
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
  return {
    getHost: () => host,
    async onRunReady(context) {
      if (host == null) {
        // Started once the report root is known, so the viewer can also list earlier runs.
        host = await viewerModule.startViewer({
          host: options.host,
          mode: 'live',
          open: options.open,
          port: options.port,
          reportRoots: context.reportRoot == null ? [] : [context.reportRoot],
        })
        process.stderr.write(`Viewer: ${host.url}\n`)
      }

      return await host.attachRun(context)
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

function normalizeProjectNames(projectNames: string | string[] | undefined): string[] {
  if (typeof projectNames === 'string') {
    return [projectNames]
  }

  return projectNames ?? []
}

function normalizeViewerPort(port: number): number {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid --viewer-port "${String(port)}". Expected an integer from 0 to 65535.`)
  }

  return port
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
