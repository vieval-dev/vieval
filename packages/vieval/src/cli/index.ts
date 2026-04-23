import process from 'node:process'

import meow from 'meow'

import { runCompareCliOrExit } from './compare'
import { runEvalRunCli } from './eval-run'
import { runReportAnalyzeCli } from './report-analyze'
import { runReportIndexCli } from './report-index'

type Command = 'compare' | 'report' | 'run'

interface ParsedTopLevelCliArguments {
  command: Command | 'help'
  commandArgv: string[]
}

const topLevelHelpText = `
  Execute and report evaluation projects.

  Usage
    $ vieval <command> [options]

  Commands
    run            Discover and execute eval projects
    compare        Compare multiple workspaces/methods on one benchmark
    report         Analyze and index generated report artifacts

  Examples
    $ vieval run
    $ vieval run --config vieval.config.ts --project chess --json --report-out .vieval/reports
    $ vieval compare --config vieval.config.ts --comparison agent-memory
    $ vieval report analyze .vieval/reports/my-run
    $ vieval report index .vieval/reports --output .vieval/reports/index/runs.jsonl
`

function normalizeCliArgv(argv: readonly string[]): string[] {
  return argv[0] === '--'
    ? argv.slice(1)
    : [...argv]
}

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
    autoHelp: false,
    autoVersion: false,
    argv: normalizedArgv,
    importMeta: import.meta,
  })

  if (command == null || command === 'help' || command === '--help' || command === '-h') {
    return {
      command: 'help',
      commandArgv: [],
    }
  }

  if (command !== 'run' && command !== 'report' && command !== 'compare') {
    const receivedCommand = command ?? '(none)'
    throw new Error(`Unsupported vieval command "${receivedCommand}". Expected "run", "compare", or "report".`)
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
 *     -> {@link runEvalRunCli} / report CLI / compare CLI
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

    throw new Error(`Unsupported vieval report command "${reportSubcommand ?? '(none)'}". Expected "analyze" or "index".`)
  }

  if (parsed.command === 'compare') {
    await runCompareCliOrExit(parsed.commandArgv)
    return
  }

  await runEvalRunCli(parsed.commandArgv)
}
