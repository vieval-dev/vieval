import type { RunReducer } from '../shared/reduce'
import type { RunHandle } from './store'

import { describe, expect, it } from 'vitest'

import { createEnvelopeFactory } from '../../test/helpers'
import { createRunReducer } from '../shared/reduce'
import { buildMetrics } from './views'

const TASK = 'evals%2Fdemo::default::run=default::eval=default'

function handleOf(reducer: RunReducer): RunHandle {
  return {
    artifactsRoot: () => undefined,
    parseErrors: () => 0,
    projectSegment: 'demo',
    reducer: () => reducer,
    refresh: async () => {},
    reportDirectory: undefined,
    reportPath: undefined,
    reportRoot: undefined,
    runKey: 'run-test',
    source: () => 'live-bus',
    state: () => 'running',
    subscribe: () => () => {},
    summary: () => undefined,
  }
}

describe('buildMetrics', () => {
  // ROOT CAUSE:
  //
  // A metric recorded once per step of a long run has hundreds of thousands of points. Its summary spread every
  // value into one call, which exceeds the engine's argument limit and made `/metrics` answer 500:
  //
  // max: Math.max(...values)   // RangeError: Maximum call stack size exceeded
  //
  // We fixed this by computing min, max, and sum in one loop over the values.
  /**
   * @example
   * expect(series.summary).toMatchObject({ count: 200_000, max: 199_999, min: 0 })
   */
  it('summarizes a metric series with hundreds of thousands of points', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    const scope = { caseId: '0:a', projectId: 'demo', taskId: TASK }
    reducer.apply(envelope('case.started', { index: 0, name: 'a', total: 1 }, scope))
    for (let value = 0; value < 200_000; value += 1) {
      reducer.apply(envelope('metric.recorded', { name: 'steps', value }, scope, '2026-01-01T00:00:00.000Z'))
    }

    const [series] = buildMetrics(handleOf(reducer), {}).numeric
    expect(series.summary).toMatchObject({ count: 200_000, max: 199_999, min: 0, sum: 199_999 * 100_000 })
  })
})
