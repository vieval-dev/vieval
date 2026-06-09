import type { CaseRecord } from './report-records'
import type { CliProjectSummary, CliRunOutput } from './run'

import { describe, expect, it } from 'vitest'

import { buildCompareReportArtifact } from './report-compare'

function createProjectSummary(args: {
  exactAverage?: number | null
  executed?: boolean
  hybridAverage?: number | null
  name: string
  runCount?: number
  taskCount?: number
}): CliProjectSummary {
  const runCount = args.runCount ?? 1
  const executed = args.executed ?? true

  return {
    discoveredEvalFileCount: 1,
    entryCount: 1,
    errorMessage: null,
    executed,
    matrixSummary: null,
    name: args.name,
    result: executed
      ? {
          inferenceExecutors: [],
          overall: {
            exactAverage: args.exactAverage ?? null,
            hybridAverage: args.hybridAverage ?? null,
            judgeAverage: null,
            runCount,
          },
          runs: [],
        }
      : null,
    taskCount: args.taskCount ?? runCount,
  }
}

function createRunOutput(projects: CliProjectSummary[]): CliRunOutput {
  return {
    configFilePath: '/tmp/vieval.config.ts',
    projects,
  }
}

function createCaseRecord(args: {
  caseId: string
  projectName: string
  taskId?: string
}): CaseRecord {
  return {
    attemptId: 'attempt',
    caseId: args.caseId,
    caseName: args.caseId,
    durationMs: 1,
    endedAt: 'end',
    experimentId: 'experiment',
    metrics: {},
    projectName: args.projectName,
    retryCount: 0,
    runId: 'run',
    schemaVersion: 1,
    scores: {},
    startedAt: 'start',
    state: 'passed',
    taskId: args.taskId ?? 'task',
    workspaceId: 'workspace',
  }
}

describe('buildCompareReportArtifact', () => {
  it('emits comparison summary sorted by hybrid/exact score', () => {
    const artifact = buildCompareReportArtifact({
      benchmarkId: 'locomo',
      methods: [
        {
          methodId: 'method-b',
          output: {
            configFilePath: '/tmp/b',
            projects: [
              {
                discoveredEvalFileCount: 1,
                entryCount: 1,
                errorMessage: null,
                executed: true,
                matrixSummary: null,
                name: 'locomo',
                result: {
                  inferenceExecutors: [],
                  overall: {
                    exactAverage: 0.8,
                    hybridAverage: 0.7,
                    judgeAverage: null,
                    runCount: 1,
                  },
                  runs: [],
                },
                taskCount: 1,
              },
            ],
          },
        },
        {
          methodId: 'method-a',
          output: {
            configFilePath: '/tmp/a',
            projects: [
              {
                discoveredEvalFileCount: 1,
                entryCount: 1,
                errorMessage: null,
                executed: true,
                matrixSummary: null,
                name: 'locomo',
                result: {
                  inferenceExecutors: [],
                  overall: {
                    exactAverage: 0.9,
                    hybridAverage: 0.9,
                    judgeAverage: null,
                    runCount: 1,
                  },
                  runs: [],
                },
                taskCount: 1,
              },
            ],
          },
        },
      ],
      reportPath: '/tmp/report',
    })

    expect(artifact.methods.map(method => method.methodId)).toEqual(['method-a', 'method-b'])
  })

  it('aggregates weighted scores and coverage across every project in one method output', () => {
    const artifact = buildCompareReportArtifact({
      benchmarkId: 'locomo',
      methods: [
        {
          methodId: 'method-a',
          output: createRunOutput([
            createProjectSummary({
              exactAverage: 0.2,
              hybridAverage: 0.2,
              name: 'locomo-small',
              runCount: 1,
              taskCount: 1,
            }),
            createProjectSummary({
              exactAverage: 0.8,
              hybridAverage: 0.9,
              name: 'locomo-large',
              runCount: 3,
              taskCount: 3,
            }),
          ]),
        },
      ],
      reportPath: '/tmp/report',
    })

    expect(artifact.methods[0].methodId).toBe('method-a')
    expect(artifact.methods[0].projectCount).toBe(2)
    expect(artifact.methods[0].executedProjectCount).toBe(2)
    expect(artifact.methods[0].taskCount).toBe(4)
    expect(artifact.methods[0].runCount).toBe(4)
    expect(artifact.methods[0].exactAverage).toBeCloseTo(0.65)
    expect(artifact.methods[0].hybridAverage).toBeCloseTo(0.725)
    expect(artifact.methods[0].projects).toEqual([
      {
        caseCount: 0,
        distinctCaseCount: 0,
        exactAverage: 0.2,
        executed: true,
        hybridAverage: 0.2,
        name: 'locomo-small',
        runCount: 1,
        taskCount: 1,
      },
      {
        caseCount: 0,
        distinctCaseCount: 0,
        exactAverage: 0.8,
        executed: true,
        hybridAverage: 0.9,
        name: 'locomo-large',
        runCount: 3,
        taskCount: 3,
      },
    ])
  })

  it('surfaces lower project coverage when methods do not run aligned project sets', () => {
    const artifact = buildCompareReportArtifact({
      benchmarkId: 'locomo',
      methods: [
        {
          methodId: 'full-method',
          output: createRunOutput([
            createProjectSummary({
              exactAverage: 0.5,
              hybridAverage: 0.5,
              name: 'locomo-a',
              runCount: 2,
              taskCount: 2,
            }),
            createProjectSummary({
              exactAverage: 0.7,
              hybridAverage: 0.7,
              name: 'locomo-b',
              runCount: 2,
              taskCount: 2,
            }),
          ]),
        },
        {
          methodId: 'partial-method',
          output: createRunOutput([
            createProjectSummary({
              exactAverage: 0.9,
              hybridAverage: 0.9,
              name: 'locomo-a',
              runCount: 1,
              taskCount: 1,
            }),
          ]),
        },
      ],
      reportPath: '/tmp/report',
    })

    expect(artifact.methods.map(method => method.methodId)).toEqual(['partial-method', 'full-method'])
    expect(artifact.methods[0].projectCount).toBe(1)
    expect(artifact.methods[0].executedProjectCount).toBe(1)
    expect(artifact.methods[0].taskCount).toBe(1)
    expect(artifact.methods[0].runCount).toBe(1)
    expect(artifact.methods[1].projectCount).toBe(2)
    expect(artifact.methods[1].executedProjectCount).toBe(2)
    expect(artifact.methods[1].taskCount).toBe(4)
    expect(artifact.methods[1].runCount).toBe(4)
  })

  it('aggregates case record coverage for methods and projects without requiring aligned case sets', () => {
    const artifact = buildCompareReportArtifact({
      benchmarkId: 'locomo',
      methods: [
        {
          caseRecords: [
            createCaseRecord({ caseId: 'case-a', projectName: 'locomo-a', taskId: 'task-1' }),
            createCaseRecord({ caseId: 'case-a', projectName: 'locomo-a', taskId: 'task-1' }),
            createCaseRecord({ caseId: 'case-b', projectName: 'locomo-b', taskId: 'task-2' }),
          ],
          methodId: 'method-a',
          output: createRunOutput([
            createProjectSummary({
              exactAverage: 0.8,
              hybridAverage: 0.8,
              name: 'locomo-a',
            }),
            createProjectSummary({
              exactAverage: 0.7,
              hybridAverage: 0.7,
              name: 'locomo-b',
            }),
          ]),
        },
        {
          caseRecords: [
            createCaseRecord({ caseId: 'case-c', projectName: 'locomo-a', taskId: 'task-3' }),
          ],
          methodId: 'method-b',
          output: createRunOutput([
            createProjectSummary({
              exactAverage: 0.9,
              hybridAverage: 0.9,
              name: 'locomo-a',
            }),
          ]),
        },
      ],
      reportPath: '/tmp/report',
    })

    expect(artifact.methods[0]).toMatchObject({
      caseCount: 1,
      distinctCaseCount: 1,
      methodId: 'method-b',
    })
    expect(artifact.methods[0].projects).toEqual([
      {
        caseCount: 1,
        distinctCaseCount: 1,
        exactAverage: 0.9,
        executed: true,
        hybridAverage: 0.9,
        name: 'locomo-a',
        runCount: 1,
        taskCount: 1,
      },
    ])
    expect(artifact.methods[1]).toMatchObject({
      caseCount: 3,
      distinctCaseCount: 2,
      methodId: 'method-a',
    })
    expect(artifact.methods[1].projects).toEqual([
      {
        caseCount: 2,
        distinctCaseCount: 1,
        exactAverage: 0.8,
        executed: true,
        hybridAverage: 0.8,
        name: 'locomo-a',
        runCount: 1,
        taskCount: 1,
      },
      {
        caseCount: 1,
        distinctCaseCount: 1,
        exactAverage: 0.7,
        executed: true,
        hybridAverage: 0.7,
        name: 'locomo-b',
        runCount: 1,
        taskCount: 1,
      },
    ])
  })
})
