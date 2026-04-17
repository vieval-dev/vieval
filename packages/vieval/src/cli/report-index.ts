#!/usr/bin/env node

import process from 'node:process'

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import meow from 'meow'

import { errorMessageFrom } from '@moeru/std'

import { readReportArtifacts, summarizeReportRunArtifact } from './report-artifacts'

export interface ParsedReportIndexCliArguments {
  format: 'json' | 'jsonl' | 'table'
  output?: string
  reportPath: string
}

const reportIndexHelpText = `
  Build report indexes from generated vieval artifacts.

  Usage
    $ vieval report index <reportPath> [--output <path>] [--format <format>]

  Options
    --output      Output file path (default: <reportPath>/index/runs.jsonl)
    --format      Console output format: table | json | jsonl (default: table)
`

function normalizeCliArgv(argv: readonly string[]): string[] {
  const normalizedArgv = argv[0] === '--'
    ? argv.slice(1)
    : [...argv]

  if (normalizedArgv[0] === 'report' && normalizedArgv[1] === 'index') {
    return normalizedArgv.slice(2)
  }

  if (normalizedArgv[0] === 'index') {
    return normalizedArgv.slice(1)
  }

  return normalizedArgv
}

export function parseReportIndexCliArguments(argv: readonly string[]): ParsedReportIndexCliArguments {
  const cli = meow(reportIndexHelpText, {
    argv: normalizeCliArgv(argv),
    flags: {
      format: {
        default: 'table',
        type: 'string',
      },
      output: {
        type: 'string',
      },
    },
    importMeta: import.meta,
  })

  const reportPath = cli.input[0]
  if (reportPath == null || reportPath.length === 0) {
    throw new Error('Missing required <reportPath> argument.')
  }

  const normalizedFormat = cli.flags.format.toLowerCase()
  const format = normalizedFormat === 'json'
    ? 'json'
    : normalizedFormat === 'jsonl'
      ? 'jsonl'
      : 'table'

  return {
    format,
    output: cli.flags.output,
    reportPath,
  }
}

interface ReportIndexOutput {
  indexFilePath: string
  indexedRunCount: number
  rows: ReturnType<typeof summarizeReportRunArtifact>[]
}

async function writeIndexFile(parsed: ParsedReportIndexCliArguments): Promise<ReportIndexOutput> {
  const artifacts = await readReportArtifacts(parsed.reportPath)
  const rows = artifacts.map(artifact => summarizeReportRunArtifact(artifact))
  const indexFilePath = resolve(parsed.output ?? resolve(parsed.reportPath, 'index', 'runs.jsonl'))
  const indexDirectory = dirname(indexFilePath)

  await mkdir(indexDirectory, { recursive: true })
  const indexContents = rows.map(row => JSON.stringify(row)).join('\n')
  await writeFile(indexFilePath, `${indexContents}${indexContents.length > 0 ? '\n' : ''}`, 'utf-8')

  return {
    indexFilePath,
    indexedRunCount: rows.length,
    rows,
  }
}

function formatTableOutput(output: ReportIndexOutput): string {
  return [
    'INDEX  vieval report',
    `Path      ${output.indexFilePath}`,
    `Run count ${output.indexedRunCount}`,
  ].join('\n')
}

export async function runReportIndexCli(argv: readonly string[]): Promise<void> {
  try {
    const parsed = parseReportIndexCliArguments(argv)
    const output = await writeIndexFile(parsed)

    if (parsed.format === 'json') {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
      return
    }

    if (parsed.format === 'jsonl') {
      const jsonl = output.rows.map(row => JSON.stringify(row)).join('\n')
      process.stdout.write(`${jsonl}${jsonl.length > 0 ? '\n' : ''}`)
      return
    }

    process.stdout.write(`${formatTableOutput(output)}\n`)
  }
  catch (error) {
    const errorMessage = errorMessageFrom(error) ?? 'Unknown report index failure.'
    process.stderr.write(`[vieval report index] ${errorMessage}\n`)
    process.exitCode = 1
  }
}
