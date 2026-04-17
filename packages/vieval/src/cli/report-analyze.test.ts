import { describe, expect, it } from 'vitest'

import { buildExperimentSummaries, parseReportAnalyzeCliArguments } from './report-analyze'

describe('parseReportAnalyzeCliArguments', () => {
  it('parses analyze input with default table format', () => {
    expect(parseReportAnalyzeCliArguments(['analyze', '.vieval/reports/run-1'])).toEqual({
      attempt: undefined,
      caseState: undefined,
      contains: undefined,
      errorContains: undefined,
      experiment: undefined,
      format: 'table',
      project: undefined,
      reportPath: '.vieval/reports/run-1',
      run: undefined,
      taskState: undefined,
      workspace: undefined,
    })
  })

  it('supports report analyze argv forwarding and json format', () => {
    expect(parseReportAnalyzeCliArguments(['report', 'analyze', '.vieval/reports/run-1', '--format', 'json'])).toEqual({
      attempt: undefined,
      caseState: undefined,
      contains: undefined,
      errorContains: undefined,
      experiment: undefined,
      format: 'json',
      project: undefined,
      reportPath: '.vieval/reports/run-1',
      run: undefined,
      taskState: undefined,
      workspace: undefined,
    })
  })

  it('parses filter flags and csv format', () => {
    expect(parseReportAnalyzeCliArguments([
      'analyze',
      '.vieval/reports',
      '--format',
      'csv',
      '--workspace',
      'packages-vieval',
      '--project',
      'example-project',
      '--experiment',
      'baseline',
      '--attempt',
      'attempt-1',
      '--run',
      'run-1',
      '--task-state',
      'passed',
      '--case-state',
      'failed',
      '--contains',
      'toolcall',
      '--error-contains',
      'timeout',
      '--run-matrix',
      'scenario=stress,model=gpt-4.1-mini',
      '--eval-matrix',
      'rubric=strict',
    ])).toEqual({
      attempt: 'attempt-1',
      caseState: 'failed',
      contains: 'toolcall',
      evalMatrix: {
        rubric: 'strict',
      },
      errorContains: 'timeout',
      experiment: 'baseline',
      format: 'csv',
      project: 'example-project',
      reportPath: '.vieval/reports',
      runMatrix: {
        model: 'gpt-4.1-mini',
        scenario: 'stress',
      },
      run: 'run-1',
      taskState: 'passed',
      workspace: 'packages-vieval',
    })
  })

  it('throws when task/case state filters are unsupported', () => {
    expect(() => parseReportAnalyzeCliArguments(['analyze', '.vieval/reports', '--task-state', 'unknown'])).toThrow(
      'Unsupported state filter "unknown". Expected "passed", "failed", or "skipped".',
    )
  })

  it('throws when run/eval matrix selectors are malformed', () => {
    expect(() => parseReportAnalyzeCliArguments(['analyze', '.vieval/reports', '--run-matrix', 'scenario'])).toThrow(
      'Invalid matrix selector segment "scenario". Expected "key=value".',
    )
    expect(() => parseReportAnalyzeCliArguments(['analyze', '.vieval/reports', '--eval-matrix', '=strict'])).toThrow(
      'Invalid matrix selector segment "=strict". Expected "key=value".',
    )
  })
})

describe('buildExperimentSummaries', () => {
  it('groups runs by workspace and experiment and computes reliability stats', () => {
    const summaries = buildExperimentSummaries([
      {
        attemptId: 'attempt-a',
        eventsCount: 10,
        executedProjects: 1,
        experimentId: 'exp-1',
        failedProjects: 0,
        projectNames: ['project-a'],
        reportDirectory: '/tmp/reports/1',
        runId: 'run-1',
        totalProjects: 1,
        totalTasks: 4,
        workspaceId: 'ws-1',
      },
      {
        attemptId: 'attempt-a',
        eventsCount: 12,
        executedProjects: 1,
        experimentId: 'exp-1',
        failedProjects: 1,
        projectNames: ['project-a'],
        reportDirectory: '/tmp/reports/2',
        runId: 'run-2',
        totalProjects: 1,
        totalTasks: 5,
        workspaceId: 'ws-1',
      },
      {
        attemptId: 'attempt-b',
        eventsCount: 9,
        executedProjects: 1,
        experimentId: 'exp-1',
        failedProjects: 0,
        projectNames: ['project-a'],
        reportDirectory: '/tmp/reports/3',
        runId: 'run-3',
        totalProjects: 1,
        totalTasks: 3,
        workspaceId: 'ws-1',
      },
    ])

    expect(summaries).toEqual([
      {
        attemptCount: 2,
        attemptSummaries: [
          {
            attemptId: 'attempt-a',
            failedProjects: 1,
            runCount: 2,
            runIds: ['run-1', 'run-2'],
            successRate: 0.5,
            totalEvents: 22,
            totalTasks: 9,
          },
          {
            attemptId: 'attempt-b',
            failedProjects: 0,
            runCount: 1,
            runIds: ['run-3'],
            successRate: 1,
            totalEvents: 9,
            totalTasks: 3,
          },
        ],
        attemptSuccessRateStats: {
          avg: 0.75,
          max: 1,
          min: 0.5,
          stdev: 0.25,
        },
        experimentId: 'exp-1',
        failedProjects: 1,
        runCount: 3,
        successRate: 0.666667,
        totalEvents: 31,
        totalTasks: 12,
        workspaceId: 'ws-1',
      },
    ])
  })
})
