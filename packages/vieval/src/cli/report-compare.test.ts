import { describe, expect, it } from 'vitest'

import { buildCompareReportArtifact } from './report-compare'

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
})
