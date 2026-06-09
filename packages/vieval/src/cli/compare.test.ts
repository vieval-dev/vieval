import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runCompareCli } from './compare'
import { loadVievalComparisonConfig } from './comparison-config'
import { readCaseRecordsFromReport } from './report-cases'
import { runVievalCli } from './run'

vi.mock('./comparison-config', () => ({
  loadVievalComparisonConfig: vi.fn(),
}))
vi.mock('./report-cases', () => ({
  readCaseRecordsFromReport: vi.fn(),
}))
vi.mock('./run', () => ({
  runVievalCli: vi.fn(),
}))

describe('runCompareCli', () => {
  let writeOutput: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readCaseRecordsFromReport).mockResolvedValue([])
    writeOutput = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    writeOutput.mockRestore()
  })

  it('runs configured methods sequentially and aggregates outputs', async () => {
    vi.mocked(loadVievalComparisonConfig).mockResolvedValue({
      config: {
        benchmark: {
          id: 'locomo',
          sharedCaseNamespace: 'locomo-cases-v1',
        },
        methods: [
          { id: 'm1', project: 'locomo', workspace: '/tmp/m1' },
          { id: 'm2', project: 'locomo', workspace: '/tmp/m2' },
        ],
      },
      configFilePath: '/tmp/vieval.cmp.config.ts',
    })
    vi.mocked(runVievalCli).mockResolvedValue({
      configFilePath: '/tmp/vieval.config.ts',
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
              exactAverage: 1,
              hybridAverage: 1,
              judgeAverage: null,
              runCount: 1,
            },
            runs: [],
          },
          taskCount: 1,
        },
      ],
    })

    const output = await runCompareCli(['compare', '--format', 'json'])

    expect(output.benchmarkId).toBe('locomo')
    expect(output.methods).toHaveLength(2)
    expect(runVievalCli).toHaveBeenCalledTimes(2)
  })

  it('passes per-method reportOut directories and reads case records for compare artifacts', async () => {
    vi.mocked(loadVievalComparisonConfig).mockResolvedValue({
      config: {
        benchmark: {
          id: 'locomo',
          sharedCaseNamespace: 'locomo-cases-v1',
        },
        methods: [
          { id: 'm1', project: 'locomo', workspace: '/tmp/m1' },
          { id: 'm2', project: 'locomo', workspace: '/tmp/m2' },
        ],
      },
      configFilePath: '/tmp/vieval.cmp.config.ts',
    })
    vi.mocked(runVievalCli).mockResolvedValue({
      configFilePath: '/tmp/vieval.config.ts',
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
              exactAverage: 1,
              hybridAverage: 1,
              judgeAverage: null,
              runCount: 1,
            },
            runs: [],
          },
          taskCount: 1,
        },
      ],
    })
    vi.mocked(readCaseRecordsFromReport)
      .mockResolvedValueOnce([
        {
          attemptId: 'a1',
          caseId: 'case-a',
          caseName: 'A',
          durationMs: 1,
          endedAt: 'end',
          experimentId: 'e',
          metrics: {},
          projectName: 'locomo',
          retryCount: 0,
          runId: 'r1',
          schemaVersion: 1,
          scores: {},
          startedAt: 'start',
          state: 'passed',
          taskId: 'task',
          workspaceId: 'w',
        },
        {
          attemptId: 'a1',
          caseId: 'case-a',
          caseName: 'A retry',
          durationMs: 1,
          endedAt: 'end',
          experimentId: 'e',
          metrics: {},
          projectName: 'locomo',
          retryCount: 1,
          runId: 'r1',
          schemaVersion: 1,
          scores: {},
          startedAt: 'start',
          state: 'passed',
          taskId: 'task',
          workspaceId: 'w',
        },
      ])
      .mockResolvedValueOnce([
        {
          attemptId: 'a2',
          caseId: 'case-b',
          caseName: 'B',
          durationMs: 1,
          endedAt: 'end',
          experimentId: 'e',
          metrics: {},
          projectName: 'locomo',
          retryCount: 0,
          runId: 'r2',
          schemaVersion: 1,
          scores: {},
          startedAt: 'start',
          state: 'passed',
          taskId: 'task',
          workspaceId: 'w',
        },
      ])

    await runCompareCli(['compare', '--format', 'json', '--output', '/tmp/compare-artifact.json'])

    const firstReportOut = vi.mocked(runVievalCli).mock.calls[0]?.[0]?.reportOut
    const secondReportOut = vi.mocked(runVievalCli).mock.calls[1]?.[0]?.reportOut

    expect(runVievalCli).toHaveBeenNthCalledWith(1, expect.objectContaining({
      reportOut: expect.stringContaining('m1'),
    }))
    expect(runVievalCli).toHaveBeenNthCalledWith(2, expect.objectContaining({
      reportOut: expect.stringContaining('m2'),
    }))
    expect(readCaseRecordsFromReport).toHaveBeenNthCalledWith(1, firstReportOut)
    expect(readCaseRecordsFromReport).toHaveBeenNthCalledWith(2, secondReportOut)

    const printedArtifact = JSON.parse(writeOutput.mock.calls.at(-1)?.[0] as string)
    expect(printedArtifact.methods.find((method: { methodId: string }) => method.methodId === 'm1')).toMatchObject({
      caseCount: 2,
      distinctCaseCount: 1,
    })
    expect(printedArtifact.methods.find((method: { methodId: string }) => method.methodId === 'm2')).toMatchObject({
      caseCount: 1,
      distinctCaseCount: 1,
    })
  })

  it('surfaces case record read failures', async () => {
    vi.mocked(loadVievalComparisonConfig).mockResolvedValue({
      config: {
        benchmark: {
          id: 'locomo',
          sharedCaseNamespace: 'locomo-cases-v1',
        },
        methods: [
          { id: 'm1', project: 'locomo', workspace: '/tmp/m1' },
        ],
      },
      configFilePath: '/tmp/vieval.cmp.config.ts',
    })
    vi.mocked(runVievalCli).mockResolvedValue({
      configFilePath: '/tmp/vieval.config.ts',
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
              exactAverage: 1,
              hybridAverage: 1,
              judgeAverage: null,
              runCount: 1,
            },
            runs: [],
          },
          taskCount: 1,
        },
      ],
    })
    vi.mocked(readCaseRecordsFromReport).mockRejectedValue(new Error('invalid cases artifact'))

    await expect(runCompareCli(['compare'])).rejects.toThrow('invalid cases artifact')
  })

  it('propagates method-level failures with method id context', async () => {
    vi.mocked(loadVievalComparisonConfig).mockResolvedValue({
      config: {
        benchmark: {
          id: 'locomo',
          sharedCaseNamespace: 'locomo-cases-v1',
        },
        methods: [
          { id: 'm1', project: 'locomo', workspace: '/tmp/m1' },
        ],
      },
      configFilePath: '/tmp/vieval.cmp.config.ts',
    })
    vi.mocked(runVievalCli).mockResolvedValue({
      configFilePath: '/tmp/vieval.config.ts',
      projects: [
        {
          discoveredEvalFileCount: 1,
          entryCount: 1,
          errorMessage: 'boom',
          executed: false,
          matrixSummary: null,
          name: 'locomo',
          result: null,
          taskCount: 1,
        },
      ],
    })

    await expect(runCompareCli(['compare'])).rejects.toThrow('Comparison method "m1" failed: boom')
  })
})
