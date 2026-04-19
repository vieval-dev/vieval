#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import meow from 'meow'

import { errorMessageFrom } from '@moeru/std'

import { runCompareCliOrExit } from './compare'
import { parseCliArguments as parseRunCliArguments } from './eval-run'
import { runReportAnalyzeCli } from './report-analyze'
import { runReportIndexCli } from './report-index'
import { formatVievalCliRunOutput, hasRunFailures, runVievalCli } from './run'

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

  const runArguments = parseRunCliArguments(parsed.commandArgv)
  const output = await runVievalCli({
    attempt: runArguments.attempt,
    configFilePath: runArguments.configFilePath,
    experiment: runArguments.experiment,
    project: runArguments.project,
    reportOut: runArguments.reportOut,
    workspace: runArguments.workspace,
  })

  if (runArguments.json) {
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

function isDirectExecution(): boolean {
  if (!process.argv[1]) {
    return false
  }

  const resolvedArgvPath = path.resolve(process.argv[1])
  const currentModulePath = fileURLToPath(import.meta.url)

  try {
    if (realpathSync.native(resolvedArgvPath) === realpathSync.native(currentModulePath)) {
      return true
    }
  }
  catch {
    if (resolvedArgvPath === currentModulePath) {
      return true
    }
  }

  const normalizedArgvPath = resolvedArgvPath.replaceAll('\\', '/')
  return normalizedArgvPath.endsWith('/.bin/vieval')
}

async function main(): Promise<void> {
  try {
    await runTopLevelCli(process.argv.slice(2))
  }
  catch (error) {
    const errorMessage = errorMessageFrom(error) ?? 'Unknown CLI failure.'
    process.stderr.write(`[vieval] ${errorMessage}\n`)
    process.exitCode = 1
  }
}

if (isDirectExecution()) {
  await main()
}
