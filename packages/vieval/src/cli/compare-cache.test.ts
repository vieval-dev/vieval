import { describe, expect, it, vi } from 'vitest'

import { runCompareCli } from './compare'
import { loadVievalComparisonConfig } from './comparison-config'
import { runVievalCli } from './run'

vi.mock('./comparison-config', () => ({
  loadVievalComparisonConfig: vi.fn(),
}))
vi.mock('./run', () => ({
  runVievalCli: vi.fn(),
}))

describe('runCompareCli cache wiring', () => {
  it('reuses same benchmark case artifact path across method runs', async () => {
    vi.mocked(loadVievalComparisonConfig).mockResolvedValue({
      config: {
        benchmark: {
          id: 'locomo',
          sharedCaseNamespace: 'locomo-cases-v1',
        },
        methods: [
          { id: 'method-a', project: 'locomo', workspace: '/tmp/a' },
          { id: 'method-b', project: 'locomo', workspace: '/tmp/b' },
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

    await runCompareCli(['compare'])

    expect(runVievalCli).toHaveBeenNthCalledWith(1, expect.objectContaining({
      cacheProjectName: 'locomo-cases-v1',
      workspace: 'locomo',
    }))
    expect(runVievalCli).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cacheProjectName: 'locomo-cases-v1',
      workspace: 'locomo',
    }))
  })
})
