import process from 'node:process'

import meow from 'meow'

import { runEvalRunCli } from './eval-run'
import { runReportAnalyzeCli } from './report-analyze'
import { runReportCompareCli } from './report-case-compare'
import { runReportCasesCli } from './report-cases'
import { runReportIndexCli } from './report-index'
import { runViewerCli } from './viewer'

export type { RunEventBus, RunEventIdentity } from '../core/runner/event-bus'
export type { EvalRunCliRuntime } from './eval-run'
export type { CliRunOutput, RunVievalCliOptions } from './run'
export { runVievalCli } from './run'
export type { ParsedViewerCliArguments, ViewerCliRuntime } from './viewer'
export { parseViewerCliArguments, runViewerCli } from './viewer'
export type { RunReadyContext, RunReadyDisposer, RunReadyHook, StartViewerOptions, ViewerHost, ViewerModule } from './viewer-host'
export { importViewer, VIEWER_PACKAGE_NAME } from './viewer-host'

type Command = 'report' | 'run' | 'viewer'

interface ParsedTopLevelCliArguments {
  command: 'help' | Command
  commandArgv: string[]
}

const topLevelHelpText = `
  Execute and report evaluation projects.

  Usage
    $ vieval <command> [options]

  Commands
    run            Run a workspace (lists projects) or a comparison (lists workspaces)
    report         Analyze and index generated report artifacts
    viewer         Browse reports (and runs still being written) in the web viewer

  Examples
    $ vieval run
    $ vieval run --config vieval.config.ts --project chess --json --report-out .vieval/reports
    $ vieval run --config evals/agent-memory/vieval.config.ts --workspace mem9 --with-viewer --open
    $ vieval report analyze .vieval/reports/my-run
    $ vieval report index .vieval/reports --output .vieval/reports/index/runs.jsonl
    $ vieval viewer .vieval/reports
`

/**
 * Parses top-level `vieval` CLI arguments into one command dispatch payload.
 *
 * Use when:
 * - the executable needs to resolve which subcommand should run
 * - tests need stable top-level argv normalization without invoking subcommands
 *
 * Expects:
 * - argv excludes the node executable and script path
 *
 * Returns:
 * - the normalized top-level command plus subcommand argv
 */
export function parseTopLevelCliArguments(argv: readonly string[]): ParsedTopLevelCliArguments {
  const normalizedArgv = normalizeCliArgv(argv)
  const command = normalizedArgv[0]

  meow(topLevelHelpText, {
    argv: normalizedArgv,
    autoHelp: false,
    autoVersion: false,
    importMeta: import.meta,
  })

  if (command == null || command === 'help' || command === '--help' || command === '-h') {
    return {
      command: 'help',
      commandArgv: [],
    }
  }

  if (command !== 'run' && command !== 'report' && command !== 'viewer') {
    const receivedCommand = command ?? '(none)'
    throw new Error(`Unsupported vieval command "${receivedCommand}". Expected "run", "report", or "viewer".`)
  }

  return {
    command,
    commandArgv: normalizedArgv.slice(1),
  }
}

/**
 * Dispatches the top-level `vieval` command to one concrete subcommand module.
 *
 * Call stack:
 *
 * published executable (`../bin/vieval`)
 *   -> {@link runTopLevelCli}
 *     -> {@link runEvalRunCli} / report CLI / {@link runViewerCli}
 *
 * Use when:
 * - the executable or tests need import-safe CLI orchestration
 * - subcommands should remain reusable without process-bound startup code
 *
 * Expects:
 * - argv excludes the node executable and script path
 *
 * Returns:
 * - resolves after the selected subcommand completes
 */
export async function runTopLevelCli(argv: readonly string[]): Promise<void> {
  const parsed = parseTopLevelCliArguments(argv)

  if (parsed.command === 'help') {
    process.stdout.write(`${topLevelHelpText.trim()}\n`)
    return
  }

  if (parsed.command === 'report') {
    const reportSubcommand = parsed.commandArgv[0]

    if (reportSubcommand === 'analyze') {
      await runReportAnalyzeCli(parsed.commandArgv)
      return
    }

    if (reportSubcommand === 'index') {
      await runReportIndexCli(parsed.commandArgv)
      return
    }

    if (reportSubcommand === 'cases') {
      await runReportCasesCli(parsed.commandArgv)
      return
    }

    if (reportSubcommand === 'compare') {
      await runReportCompareCli(parsed.commandArgv)
      return
    }

    throw new Error(`Unsupported vieval report command "${reportSubcommand ?? '(none)'}". Expected "analyze", "index", "cases", or "compare".`)
  }

  if (parsed.command === 'viewer') {
    await runViewerCli(parsed.commandArgv)
    return
  }

  await runEvalRunCli(parsed.commandArgv)
}

function normalizeCliArgv(argv: readonly string[]): string[] {
  return argv[0] === '--'
    ? argv.slice(1)
    : [...argv]
}
