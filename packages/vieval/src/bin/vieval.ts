#!/usr/bin/env node

import process from 'node:process'

import { errorMessageFrom } from '@moeru/std'

import { runTopLevelCli } from '../cli/index'

/**
 * Bootstraps the published `vieval` executable.
 *
 * Call stack:
 *
 * package manager shim / direct node execution
 *   -> {@link runTopLevelCli} (`../cli`)
 *     -> subcommand orchestration modules
 *
 * Use when:
 * - the installed `vieval` binary starts from the command line
 * - process-bound startup must stay outside import-safe CLI modules
 *
 * Expects:
 * - `process.argv` contains the raw CLI arguments after the node executable path
 *
 * Returns:
 * - resolves after the selected subcommand finishes and updates `process.exitCode`
 */
runTopLevelCli(process.argv.slice(2)).catch((error) => {
  const errorMessage = errorMessageFrom(error) ?? 'Unknown CLI failure.'
  process.stderr.write(`[vieval] ${errorMessage}\n`)
  process.exitCode = 1
})
