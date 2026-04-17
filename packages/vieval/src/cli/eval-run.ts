#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import meow from 'meow'

import { errorMessageFrom } from '@moeru/std'

import packageJSON from '../../package.json'

import { formatVievalCliRunOutput, runVievalCli } from './run'

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

function isDirectExecution(): boolean {
  if (!process.argv[1]) {
    return false
  }

  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

/**
 * CLI entrypoint for `vieval run`.
 *
 * Call stack:
 *
 * {@link main}
 *   -> {@link parseCliArguments}(`process.argv`)
 *   -> {@link runVievalCli}
 *   -> `process.stdout.write(...)` / `process.stderr.write(...)`
 *   -> `process.exitCode`
 *
 * Use when:
 * - developers want project-style eval discovery and execution from one command
 * - manual `import.meta.glob` and runner wiring should stay internal
 */
async function main(): Promise<void> {
  // NOTICE:
  // CLI arguments are read from process argv because this module is the
  // user-facing executable entrypoint.
  const parsed = parseCliArguments(process.argv.slice(2))

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
      return
    }

    process.stdout.write(`${formatVievalCliRunOutput(output)}\n`)
  }
  catch (error) {
    const errorMessage = errorMessageFrom(error) ?? 'Unknown CLI failure.'
    process.stderr.write(`[${packageJSON.name}] ${errorMessage}\n`)
    process.exitCode = 1
  }
}

if (isDirectExecution()) {
  await main()
}
