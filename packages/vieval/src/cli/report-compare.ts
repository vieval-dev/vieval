import type { CaseRecord } from './report-records'
import type { CliRunOutput } from './run'

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export interface CompareMethodSummary {
  caseRecords?: readonly CaseRecord[]
  methodId: string
  output: CliRunOutput
}

/**
 * Coverage and score summary for one project inside a compare method output.
 */
export interface CompareProjectSummary {
  caseCount: number
  distinctCaseCount: number
  exactAverage: number | null
  executed: boolean
  hybridAverage: number | null
  name: string
  runCount: number
  taskCount: number
}

/**
 * Method-level compare row with coverage counts and weighted score averages.
 */
export interface CompareSummaryRow {
  caseCount: number
  distinctCaseCount: number
  exactAverage: number | null
  hybridAverage: number | null
  executedProjectCount: number
  methodId: string
  projectCount: number
  projects: CompareProjectSummary[]
  runCount: number
  taskCount: number
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
    const caseRecords = method.caseRecords ?? []
    const projects = method.output.projects.map((project): CompareProjectSummary => ({
      caseCount: countCasesForProject(caseRecords, project.name),
      distinctCaseCount: countDistinctCasesForProject(caseRecords, project.name),
      exactAverage: project.result?.overall.exactAverage ?? null,
      executed: project.executed,
      hybridAverage: project.result?.overall.hybridAverage ?? null,
      name: project.name,
      runCount: project.result?.overall.runCount ?? 0,
      taskCount: project.taskCount,
    }))

    return {
      caseCount: caseRecords.length,
      distinctCaseCount: countDistinctCases(caseRecords),
      exactAverage: createWeightedAverage(projects, project => project.exactAverage),
      executedProjectCount: projects.filter(project => project.executed).length,
      hybridAverage: createWeightedAverage(projects, project => project.hybridAverage),
      methodId: method.methodId,
      projectCount: projects.length,
      projects,
      runCount: projects.reduce((sum, project) => sum + project.runCount, 0),
      taskCount: projects.reduce((sum, project) => sum + project.taskCount, 0),
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

function countCasesForProject(caseRecords: readonly CaseRecord[], projectName: string): number {
  return caseRecords.filter(record => record.projectName === projectName).length
}

function countDistinctCasesForProject(caseRecords: readonly CaseRecord[], projectName: string): number {
  return countDistinctCases(caseRecords.filter(record => record.projectName === projectName))
}

function countDistinctCases(caseRecords: readonly CaseRecord[]): number {
  const caseKeys = new Set<string>()

  for (const record of caseRecords) {
    caseKeys.add(`${record.projectName}:${record.taskId}:${record.caseId}`)
  }

  return caseKeys.size
}

function createWeightedAverage(
  projects: readonly CompareProjectSummary[],
  selectAverage: (project: CompareProjectSummary) => number | null,
): number | null {
  let weightedScoreTotal = 0
  let weightTotal = 0

  for (const project of projects) {
    const average = selectAverage(project)
    if (average == null || project.runCount <= 0) {
      continue
    }

    weightedScoreTotal += average * project.runCount
    weightTotal += project.runCount
  }

  if (weightTotal === 0) {
    return null
  }

  return weightedScoreTotal / weightTotal
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
