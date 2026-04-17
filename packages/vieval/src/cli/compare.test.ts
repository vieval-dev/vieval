import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runCompareCli } from './compare'
import { loadVievalComparisonConfig } from './comparison-config'
import { runVievalCli } from './run'

vi.mock('./comparison-config', () => ({
  loadVievalComparisonConfig: vi.fn(),
}))
vi.mock('./run', () => ({
  runVievalCli: vi.fn(),
}))

describe('runCompareCli', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
