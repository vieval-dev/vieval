import process from 'node:process'

import meow from 'meow'

import { errorMessageFrom } from '@moeru/std'

import packageJSON from '../../package.json'

import { formatVievalCliRunOutput, hasRunFailures, runVievalCli } from './run'

interface ParsedCliArguments {
  attempt?: string
  configFilePath?: string
  experiment?: string
  json: boolean
  project: string[]
  reportOut?: string
  workspace?: string
}

const evalRunHelpText = `
  Execute vieval projects from discovered or explicit config.

  Usage
    $ vieval run [--config <path>] [--project <name>] [--json] [--report-out <path>]

  Options
    --config     Config file path
    --project    Project name to execute; may be repeated
    --workspace  Workspace id used in report artifacts
    --experiment Experiment id used in report artifacts
    --attempt    Attempt id used in report artifacts
    --report-out Report output root directory
    --json       Print machine-readable JSON output
`

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
    importMeta: import.meta,
    flags: {
      config: {
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
      workspace: {
        type: 'string',
      },
      experiment: {
        type: 'string',
      },
      attempt: {
        type: 'string',
      },
      reportOut: {
        type: 'string',
      },
    },
  })

  return {
    attempt: cli.flags.attempt,
    configFilePath: cli.flags.config,
    experiment: cli.flags.experiment,
    json: cli.flags.json === true,
    project: normalizeProjectNames(cli.flags.project),
    reportOut: cli.flags.reportOut,
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
 *       -> {@link runVievalCli}
 *       -> `process.stdout.write(...)` / `process.stderr.write(...)`
 *       -> `process.exitCode`
 *
 * Use when:
 * - the published `vieval` binary needs to execute the `run` subcommand
 * - callers want one reusable implementation without a second bundled entrypoint
 *
 * Expects:
 * - argv that belongs to the `run` subcommand only
 *
 * Returns:
 * - resolves after writing CLI output and updating `process.exitCode`
 *
 * NOTICE:
 * - `src/cli/index.ts` is the only direct-execution entrypoint for the bundled
 *   CLI artifact. Keeping `eval-run.ts` reusable avoids duplicate top-level
 *   await guards once tsdown inlines both modules into `dist/cli/index.mjs`.
 */
export async function runEvalRunCli(argv: readonly string[]): Promise<void> {
  const parsed = parseCliArguments(argv)

  try {
    const output = await runVievalCli({
      attempt: parsed.attempt,
      configFilePath: parsed.configFilePath,
      experiment: parsed.experiment,
      project: parsed.project,
      reportOut: parsed.reportOut,
      workspace: parsed.workspace,
    })

    if (parsed.json) {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
      if (hasRunFailures(output)) {
        process.exitCode = 1
      }
      return
    }

    process.stdout.write(`${formatVievalCliRunOutput(output)}\n`)
    if (hasRunFailures(output)) {
      process.exitCode = 1
    }
  }
  catch (error) {
    const errorMessage = errorMessageFrom(error) ?? 'Unknown CLI failure.'
    process.stderr.write(`[${packageJSON.name}] ${errorMessage}\n`)
    process.exitCode = 1
  }
}
