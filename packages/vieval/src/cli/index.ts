#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import meow from 'meow'

import { errorMessageFrom } from '@moeru/std'

import { parseCliArguments as parseRunCliArguments } from './eval-run'
import { formatVievalCliRunOutput, runVievalCli } from './run'

type Command = 'run'

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

  Examples
    $ vieval run
    $ vieval run --config vieval.config.ts --project chess --json
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

  if (command !== 'run') {
    const receivedCommand = command ?? '(none)'
    throw new Error(`Unsupported vieval command "${receivedCommand}". Expected "run".`)
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

  const runArguments = parseRunCliArguments(parsed.commandArgv)
  const output = await runVievalCli({
    configFilePath: runArguments.configFilePath,
    project: runArguments.project,
  })

  if (runArguments.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    return
  }

  process.stdout.write(`${formatVievalCliRunOutput(output)}\n`)
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) {
    return false
  }

  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
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
