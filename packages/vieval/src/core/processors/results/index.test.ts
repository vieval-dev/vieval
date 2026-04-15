import type { AggregatedRunResults } from '../../runner/aggregate'

import { describe, expect, it } from 'vitest'

import { processRunResults } from './index'

function createScheduledTaskMatrix() {
  return {
    eval: {},
    meta: {
      evalRowId: 'default',
      runRowId: 'default',
    },
    run: {},
  }
}

function createAggregatedResults(overrides: Partial<AggregatedRunResults> = {}): AggregatedRunResults {
  return {
    overall: {
      exactAverage: 0.8,
      hybridAverage: 0.8,
      judgeAverage: 0.8,
      runCount: 2,
    },
    inferenceExecutors: [{
      exactAverage: 0.8,
      hybridAverage: 0.8,
      judgeAverage: 0.8,
      inferenceExecutorId: 'openai:gpt-4.1-mini',
      runCount: 2,
    }],
    runs: [{
      entryId: 'plugins/airi-plugin-game-chess/src/agent/evals/chess-commentary',
      exactAverage: 0.8,
      hybridAverage: 0.8,
      id: 'run-1',
      judgeAverage: 0.8,
      matrix: createScheduledTaskMatrix(),
      inferenceExecutorId: 'openai:gpt-4.1-mini',
    }, {
      entryId: 'plugins/airi-plugin-game-chess/src/agent/evals/chess-commentary',
      exactAverage: 0.7,
      hybridAverage: 0.7,
      id: 'run-2',
      judgeAverage: 0.7,
      matrix: createScheduledTaskMatrix(),
      inferenceExecutorId: 'openai:gpt-4.1-mini',
    }],
    ...overrides,
  }
}

describe('processRunResults', () => {
  it('passes when threshold and hard-limit policies are satisfied', () => {
    const decision = processRunResults(createAggregatedResults(), {
      maxFailedRuns: {
        maxFailedRuns: 0,
        minRunHybridScore: 0.7,
      },
      threshold: {
        minOverallHybridScore: 0.75,
        minProviderHybridScore: 0.75,
      },
    })

    expect(decision.pass).toBe(true)
    expect(decision.violations).toEqual([])
  })

  it('fails threshold policy when overall or inferenceExecutor hybrid scores are below limits', () => {
    const decision = processRunResults(createAggregatedResults({
      overall: {
        exactAverage: 0.5,
        hybridAverage: 0.5,
        judgeAverage: 0.5,
        runCount: 2,
      },
      inferenceExecutors: [{
        exactAverage: 0.55,
        hybridAverage: 0.55,
        judgeAverage: 0.55,
        inferenceExecutorId: 'openai:gpt-4.1-mini',
        runCount: 2,
      }],
    }), {
      threshold: {
        minOverallHybridScore: 0.7,
        minProviderHybridScore: 0.6,
      },
    })

    expect(decision.pass).toBe(false)
    expect(decision.violations.map(violation => violation.policyId)).toEqual([
      'threshold:overall-hybrid',
      'threshold:inferenceExecutor-hybrid',
    ])
  })

  it('fails hard-limit policy when failed runs exceed maxFailedRuns', () => {
    const decision = processRunResults(createAggregatedResults({
      runs: [{
        entryId: 'plugins/airi-plugin-game-chess/src/agent/evals/chess-commentary',
        exactAverage: 0.3,
        hybridAverage: 0.3,
        id: 'run-1',
        judgeAverage: 0.3,
        matrix: createScheduledTaskMatrix(),
        inferenceExecutorId: 'openai:gpt-4.1-mini',
      }, {
        entryId: 'plugins/airi-plugin-game-chess/src/agent/evals/chess-commentary',
        exactAverage: 0.2,
        hybridAverage: 0.2,
        id: 'run-2',
        judgeAverage: 0.2,
        matrix: createScheduledTaskMatrix(),
        inferenceExecutorId: 'openai:gpt-4.1-mini',
      }],
    }), {
      maxFailedRuns: {
        maxFailedRuns: 1,
        minRunHybridScore: 0.6,
      },
    })

    expect(decision.pass).toBe(false)
    expect(decision.violations.map(violation => violation.policyId)).toContain('hard-limit:max-failed-runs')
  })
})
