import process from 'node:process'

import { resolve } from 'node:path'

import meow from 'meow'

import { errorMessageFrom } from '@moeru/std'

import { loadVievalComparisonConfig } from './comparison-config'
import { buildCompareReportArtifact, writeCompareReportArtifact } from './report-compare'
import { runVievalCli } from './run'

export interface ParsedCompareCliArguments {
  comparisonId?: string
  configFilePath?: string
  cwd?: string
  format: 'json' | 'table'
  output?: string
}

const compareHelpText = `
  Compare multiple methods on one benchmark.

  Usage
    $ vieval compare [--config <path>] [--comparison <id>] [--output <path>] [--format <format>]

  Options
    --config      Config file path (default: nearest vieval.config.*)
    --comparison  Comparison entry id from config.comparisons
    --output      Optional output artifact path
    --format      Console output format: table | json (default: table)
`

function normalizeCliArgv(argv: readonly string[]): string[] {
  const normalizedArgv = argv[0] === '--'
    ? argv.slice(1)
    : [...argv]

  if (normalizedArgv[0] === 'compare') {
    return normalizedArgv.slice(1)
  }

  return normalizedArgv
}

export function parseCompareCliArguments(argv: readonly string[]): ParsedCompareCliArguments {
  const cli = meow(compareHelpText, {
    argv: normalizeCliArgv(argv),
    flags: {
      config: {
        type: 'string',
      },
      comparison: {
        type: 'string',
      },
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

  return {
    comparisonId: cli.flags.comparison,
    configFilePath: cli.flags.config,
    format: cli.flags.format === 'json' ? 'json' : 'table',
    output: cli.flags.output,
  }
}

export interface CompareMethodRunResult {
  methodId: string
  output: Awaited<ReturnType<typeof runVievalCli>>
}

export interface CompareRunOutput {
  benchmarkId: string
  methods: CompareMethodRunResult[]
}

/**
 * Runs one compare session from `vieval.config.*` comparison-mode config.
 */
export async function runCompareCli(argv: readonly string[]): Promise<CompareRunOutput> {
  const parsed = parseCompareCliArguments(argv)
  const loaded = await loadVievalComparisonConfig({
    comparisonId: parsed.comparisonId,
    configFilePath: parsed.configFilePath,
    cwd: parsed.cwd,
  })
  const methodResults: CompareMethodRunResult[] = []

  for (const method of loaded.config.methods) {
    const methodWorkspace = resolve(method.workspace)
    const output = await runVievalCli({
      cacheProjectName: loaded.config.benchmark.sharedCaseNamespace,
      configFilePath: method.configFilePath ?? resolve(methodWorkspace, 'vieval.config.ts'),
      cwd: methodWorkspace,
      project: [method.project],
      workspace: loaded.config.benchmark.id,
    })

    const failedProject = output.projects.find(project => project.errorMessage != null)
    if (failedProject != null) {
      throw new Error(`Comparison method "${method.id}" failed: ${failedProject.errorMessage}`)
    }

    methodResults.push({
      methodId: method.id,
      output,
    })
  }

  const runOutput: CompareRunOutput = {
    benchmarkId: loaded.config.benchmark.id,
    methods: methodResults,
  }

  const artifact = buildCompareReportArtifact({
    benchmarkId: runOutput.benchmarkId,
    methods: runOutput.methods,
    reportPath: loaded.configFilePath,
  })
  if (parsed.output != null) {
    await writeCompareReportArtifact({
      artifact,
      outputPath: parsed.output,
    })
  }

  if (parsed.format === 'json') {
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`)
  }
  else {
    process.stdout.write([
      'COMPARE  vieval',
      `Benchmark  ${artifact.benchmarkId}`,
      ...artifact.methods.map((method, index) => {
        const hybrid = method.hybridAverage == null ? 'n/a' : method.hybridAverage.toFixed(3)
        const exact = method.exactAverage == null ? 'n/a' : method.exactAverage.toFixed(3)
        return `${index + 1}. ${method.methodId}  hybrid=${hybrid} exact=${exact} runs=${method.runCount}`
      }),
    ].join('\n').concat('\n'))
  }

  return runOutput
}

export async function runCompareCliOrExit(argv: readonly string[]): Promise<void> {
  try {
    await runCompareCli(argv)
  }
  catch (error) {
    const errorMessage = errorMessageFrom(error) ?? 'Unknown compare command failure.'
    process.stderr.write(`[vieval compare] ${errorMessage}\n`)
    process.exitCode = 1
  }
}
