import type { ComparisonCell, ComparisonResponse } from '../../src/shared/contract'
import type { CompareAxis } from './comparison'

import { describe, expect, it } from 'vitest'

import { columnIntervals, compareAxes, distinctLabels, pairedDeltas, paretoFront } from './comparison'

const OVERALL: CompareAxis = { better: 'higher', kind: 'score', label: 'Overall', name: 'overall' }
const LATENCY: CompareAxis = { better: 'lower', kind: 'metric', label: 'Latency', name: 'latency_ms' }

function cell(overall: number, latency?: number): ComparisonCell {
  return { counted: { overall }, metrics: latency == null ? {} : { latency_ms: latency }, roundCount: 1, scores: { unscored: {}, values: { overall } }, state: 'passed' }
}

/** A comparison of the given columns; `values[column][row]` is the overall score of that case (`null`: not run). */
function comparison(values: Record<string, (null | number)[]>): Pick<ComparisonResponse, 'columns' | 'metricDefinitions' | 'primary' | 'rows' | 'scoreDefinitions'> {
  const ids = Object.keys(values)
  const length = Math.max(...Object.values(values).map(list => list.length))
  return {
    columns: ids.map(id => ({ id, label: id, runs: [], scoreGraders: {} })),
    metricDefinitions: [],
    primary: 'overall',
    rows: Array.from({ length }, (_, index) => ({
      caseName: `case-${index}`,
      cells: Object.fromEntries(ids.flatMap(id => (values[id]![index] == null ? [] : [[id, cell(values[id]![index]!, 100 * (index + 1))]]))),
      changed: false,
    })),
    scoreDefinitions: [{ name: 'overall', primary: true }],
  }
}

describe('columnIntervals', () => {
  /**
   * @example
   * expect(interval.mean).toBe(200); expect(interval.high - interval.mean).toBeCloseTo(4.303 * 100 / Math.sqrt(3))
   */
  it('puts a Student-t 95% interval around each column mean', () => {
    // Latencies of 100, 200, and 300 ms (the helper records 100 ms per case index).
    const interval = columnIntervals(comparison({ a: [0, 0.5, 1] }), LATENCY).get('a')!

    expect(interval.mean).toBe(200)
    expect(interval.n).toBe(3)
    // sd = 100, n = 3, t(2) = 4.303
    expect(interval.high - interval.mean).toBeCloseTo(4.303 * 100 / Math.sqrt(3), 6)
  })
})

describe('columnIntervals of a score', () => {
  /**
   * @example
   * expect(interval.high).toBe(1)
   */
  it('keeps the interval of a score inside 0–100%', () => {
    const interval = columnIntervals(comparison({ a: [1, 1, 0.5] }), OVERALL).get('a')!

    expect(interval.high).toBe(1)
    expect(interval.low).toBeGreaterThanOrEqual(0)
  })
})

describe('pairedDeltas', () => {
  /**
   * @example
   * expect(delta.interval).toMatchObject({ high: 0.1, low: 0.1, mean: 0.1 })
   */
  it('pairs the cases, so a column better by the same amount on every case has an interval of zero width', () => {
    const [delta] = pairedDeltas(comparison({ base: [0.2, 0.5, 0.9], better: [0.3, 0.6, 1] }), OVERALL, 'base')

    expect(delta?.columnId).toBe('better')
    expect(delta?.interval.mean).toBeCloseTo(0.1, 9)
    expect(delta?.interval.high - delta!.interval.low).toBeCloseTo(0, 9)
    expect([delta?.wins, delta?.losses, delta?.ties]).toEqual([3, 0, 0])
  })

  /**
   * @example
   * expect(delta.differences.map(difference => difference.key)).toEqual(['case-0'])
   */
  it('leaves out the cases one of the two did not run', () => {
    const [delta] = pairedDeltas(comparison({ base: [0.5, null], other: [0.5, 1] }), OVERALL, 'base')

    expect(delta?.differences.map(difference => difference.key)).toEqual(['case-0'])
    expect([delta?.wins, delta?.losses, delta?.ties]).toEqual([0, 0, 1])
  })

  /**
   * @example
   * expect([delta.wins, delta.losses]).toEqual([2, 0])
   */
  it('counts a lower value as a win on an axis that is better lower', () => {
    const result = comparison({ base: [0.5, 0.5], fast: [0.5, 0.5] })
    result.rows[0]!.cells.fast = cell(0.5, 50)
    result.rows[1]!.cells.fast = cell(0.5, 150)
    const [delta] = pairedDeltas(result, LATENCY, 'base')

    expect([delta?.wins, delta?.losses]).toEqual([2, 0])
  })
})

describe('compareAxes', () => {
  /**
   * @example
   * expect(compareAxes(result).map(axis => axis.name)).toEqual(['overall', 'latency_ms', 'duration'])
   */
  it('lists the scores, then the metrics that vary between cases, then the duration', () => {
    const result = comparison({ a: [0.5, 1] })
    result.rows[0]!.cells.a = { ...cell(0.5, 100), durationMs: 1000, metrics: { latency_ms: 100, repeat: 1 } }
    result.rows[1]!.cells.a = { ...cell(1, 200), metrics: { latency_ms: 200, repeat: 1 } }

    expect(compareAxes(result).map(axis => axis.name)).toEqual(['overall', 'latency_ms', 'duration'])
  })
})

describe('paretoFront', () => {
  /**
   * @example
   * expect(paretoFront(points, LATENCY, OVERALL)).toEqual(['cheap', 'best'])
   */
  it('keeps the points no other point beats on both axes, ordered along x', () => {
    const points = [
      { id: 'best', x: 300, y: 0.9 },
      { id: 'cheap', x: 100, y: 0.6 },
      { id: 'beaten', x: 300, y: 0.7 },
    ]

    expect(paretoFront(points, LATENCY, OVERALL)).toEqual(['cheap', 'best'])
  })

  /**
   * @example
   * expect(paretoFront(points, { ...LATENCY, better: undefined }, OVERALL)).toEqual([])
   */
  it('has no front when an axis does not say which way is better', () => {
    expect(paretoFront([{ id: 'a', x: 1, y: 1 }], { ...LATENCY, better: undefined }, OVERALL)).toEqual([])
  })
})

describe('distinctLabels', () => {
  /**
   * @example
   * expect(distinctLabels([['arion', 'p-arion', 'exp', 'a1'], ['raw', 'p-raw', 'exp', 'a2']])).toEqual(['arion', 'raw'])
   */
  it('names runs of several workspaces by the workspace alone', () => {
    expect(distinctLabels([['arion', 'p-arion', 'exp', 'a1'], ['raw', 'p-raw', 'exp', 'a2']])).toEqual(['arion', 'raw'])
  })

  /**
   * @example
   * expect(labels).toEqual(['ws · exp-a', 'ws · exp-b'].map(...)) // the experiment, since the workspace is shared
   */
  it('skips the levels the runs share and adds levels until every label is unique', () => {
    expect(distinctLabels([['ws', 'p', 'exp-a', 'a1'], ['ws', 'p', 'exp-b', 'a2']])).toEqual(['exp-a', 'exp-b'])
    expect(distinctLabels([['ws', 'p', 'exp-a', 'a1'], ['ws', 'p', 'exp-a', 'a2'], ['ws', 'p', 'exp-b', 'a3']])).toEqual(['exp-a · a1', 'exp-a · a2', 'exp-b · a3'])
  })
})
