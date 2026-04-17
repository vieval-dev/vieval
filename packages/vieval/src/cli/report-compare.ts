import type { CliRunOutput } from './run'

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export interface CompareMethodSummary {
  methodId: string
  output: CliRunOutput
}

export interface CompareSummaryRow {
  exactAverage: number | null
  hybridAverage: number | null
  methodId: string
  runCount: number
}

export interface CompareReportArtifact {
  benchmarkId: string
  methods: CompareSummaryRow[]
  reportPath: string
}

/**
 * Builds a compact compare report sorted by hybrid/exact score.
 */
export function buildCompareReportArtifact(args: {
  benchmarkId: string
  methods: CompareMethodSummary[]
  reportPath: string
}): CompareReportArtifact {
  const rows = args.methods.map((method): CompareSummaryRow => {
    const firstProject = method.output.projects[0]
    const overall = firstProject?.result?.overall

    return {
      exactAverage: overall?.exactAverage ?? null,
      hybridAverage: overall?.hybridAverage ?? null,
      methodId: method.methodId,
      runCount: overall?.runCount ?? 0,
    }
  })

  rows.sort((left, right) => {
    const leftHybrid = left.hybridAverage ?? Number.NEGATIVE_INFINITY
    const rightHybrid = right.hybridAverage ?? Number.NEGATIVE_INFINITY
    if (leftHybrid !== rightHybrid) {
      return rightHybrid - leftHybrid
    }

    const leftExact = left.exactAverage ?? Number.NEGATIVE_INFINITY
    const rightExact = right.exactAverage ?? Number.NEGATIVE_INFINITY
    return rightExact - leftExact
  })

  return {
    benchmarkId: args.benchmarkId,
    methods: rows,
    reportPath: args.reportPath,
  }
}

/**
 * Writes compare report artifact as JSON.
 */
export async function writeCompareReportArtifact(args: {
  artifact: CompareReportArtifact
  outputPath: string
}): Promise<string> {
  const outputPath = resolve(args.outputPath)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(args.artifact, null, 2)}\n`, 'utf-8')
  return outputPath
}
