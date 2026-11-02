import type { MatrixCell } from '../../src/shared/contract'
import type { MatrixAxis } from './matrixGrid'

import { describe, expect, it } from 'vitest'

import { axisMeans, bestRowsFirst, buildGrid, chooseLayout, compareToBaseline, defaultAveraged, isSettled, matrixAxes } from './matrixGrid'

/** A settled matrix cell of `cases` cases, `hits` of them scoring 1 on the primary score. */
function cell(run: Record<string, string>, { cases = 60, hits = 30, state = 'passed' }: { cases?: number, hits?: number, state?: string } = {}): MatrixCell {
  const summary = (name: string, sum: number, n: number) => ({ mean: n === 0 ? null : sum / n, n, name, sum, total: n, unscored: {} })
  const counts = { errored: 0, failed: 0, passed: cases, requeued: 0, running: 0, skipped: 0, timeout: 0, total: cases }
  return {
    caseCount: cases,
    entryId: 'evals/reply-parent',
    eval: {},
    evalRowId: 'default',
    history: [],
    latest: {
      attemptId: 'attempt-1',
      caseScores: Array.from({ length: cases }, (_, index) => (index < hits ? 1 : 0)),
      caseTotal: cases,
      counts,
      coverage: 'full',
      experimentId: 'matrix-v1',
      runKey: `run-${Object.values(run).join('-')}`,
      scoring: { completion: summary('completion', cases, cases), passed: summary('passed', cases, cases), primary: 'accuracy', scores: [summary('accuracy', hits, cases)] },
      state,
      taskId: 'task',
    },
    run,
    runRowId: Object.entries(run).map(([axis, value]) => `${axis}=${value}`).join('&'),
    superseded: false,
  }
}

const axesOf = (names: Record<string, string[]>) => ({ axes: Object.entries(names).map(([name, values]) => ({ kind: 'run' as const, name, values })) })
/** About 7 px per character, like 12 px Quicksand. */
const textWidth = (text: string) => text.length * 7

describe('matrixAxes', () => {
  /**
   * @example
   * expect(matrixAxes(cells, response).shared).toEqual([{ name: 'listener', value: 'luna' }])
   */
  it('says an axis every cell shares once and lays out the axes that vary', () => {
    const cells = [cell({ listener: 'luna', model: 'a' }), cell({ listener: 'luna', model: 'b' })]

    const { shared, varying } = matrixAxes(cells, axesOf({ listener: ['luna'], model: ['a', 'b'] }))

    expect(shared).toEqual([{ name: 'listener', value: 'luna' }])
    expect(varying).toEqual([{ key: 'run.model', name: 'model', values: ['a', 'b'] }])
  })

  /**
   * @example
   * expect(varying[0].values).toEqual(['1', ''])
   */
  it('keeps cells that lack an axis at the empty value instead of dropping them', () => {
    const cells = [cell({ model: 'a', window: '1' }), cell({ model: 'a' })]

    const { varying } = matrixAxes(cells, axesOf({ model: ['a'], window: ['1'] }))

    expect(varying).toEqual([{ key: 'run.window', name: 'window', values: ['1', ''] }])
  })
})

describe('chooseLayout', () => {
  const axes: MatrixAxis[] = [
    { key: 'run.method', name: 'method', values: ['decide', 'text'] },
    { key: 'run.model', name: 'model', values: ['deepseek-v4-flash', 'gemini-3.1-flash-lite', 'qwen3.5-9b'] },
    { key: 'run.view', name: 'view', values: ['lookahead3', 'online'] },
    { key: 'run.window', name: 'window', values: ['5', '15', '30'] },
  ]

  /**
   * @example
   * expect(chooseLayout(axes, [], { available: 960, cellWidth: 64, textWidth }).layout.rows).toEqual(['run.model', 'run.method'])
   */
  it('fills the width with columns, near square, and keeps long labels down the side', () => {
    const { fits, layout } = chooseLayout(axes, [], { available: 960, cellWidth: 64, textWidth })

    expect(fits).toBe(true)
    expect(layout.rows).toEqual(['run.model', 'run.method'])
    expect(layout.columns).toEqual(['run.view', 'run.window'])
  })

  /**
   * @example
   * expect(chooseLayout(axes, [], { available: 320, cellWidth: 232, textWidth }).fits).toBe(false)
   */
  it('falls back to the narrowest layout when nothing fits', () => {
    const { fits, layout } = chooseLayout(axes, [], { available: 320, cellWidth: 232, textWidth })

    expect(fits).toBe(false)
    expect(layout.columns).toHaveLength(1)
  })

  /**
   * @example
   * expect(chooseLayout(axes, ['run.seed'], space).layout.averaged).toEqual(['run.seed'])
   */
  it('leaves averaged axes out of the rows and columns', () => {
    const withSeed = [...axes, { key: 'run.seed', name: 'seed', values: ['1', '2', '3'] }]

    const { layout } = chooseLayout(withSeed, defaultAveraged(withSeed), { available: 960, cellWidth: 64, textWidth })

    expect(layout.averaged).toEqual(['run.seed'])
    expect([...layout.rows, ...layout.columns]).not.toContain('run.seed')
  })
})

describe('buildGrid', () => {
  const axes: MatrixAxis[] = [
    { key: 'run.model', name: 'model', values: ['a', 'b'] },
    { key: 'run.window', name: 'window', values: ['5', '30'] },
  ]
  const layout = { averaged: [], columns: ['run.window'], rows: ['run.model'] }

  // ROOT CAUSE:
  //
  // The newest run of one cell re-ran a single case. The matrix API counted that run as the cell's full run
  // (`caseCount: 1`), so the old viewer showed "100.0%" and "completed 100.0%" next to cells of 60 cases.
  //
  // We fixed the display by measuring each cell against the usual case count of its entry: the cell reads as 1 of 60
  // cases, carries a completion ring, and stays out of the best mark and the means.
  /**
   * @example
   * expect(grid.cells[1][1].completion).toEqual({ errored: 0, expected: 60, failed: 0, running: false, scored: 1 })
   */
  it('measures a cell against the usual case count of its entry, so a one-case rerun reads as 1 of 60', () => {
    const cells = [cell({ model: 'a', window: '5' }), cell({ model: 'a', window: '30' }), cell({ model: 'b', window: '5' }), cell({ model: 'b', window: '30' }, { cases: 1, hits: 1 })]

    const grid = buildGrid(cells, axes, layout)

    expect(grid.cells[0]![0]!.completion).toBeUndefined()
    expect(grid.cells[1]![1]!.value).toBe(1)
    expect(grid.cells[1]![1]!.completion).toEqual({ errored: 0, expected: 60, failed: 0, running: false, scored: 1 })
    expect(isSettled(grid.cells[1]![1])).toBe(false)
    expect(isSettled(grid.cells[0]![0])).toBe(true)
  })

  /**
   * @example
   * expect(grid.cells[0][1]).toBeUndefined()
   */
  it('keeps a combination that never ran as a gap', () => {
    const grid = buildGrid([cell({ model: 'a', window: '5' }), cell({ model: 'b', window: '30' })], axes, layout)

    expect(grid.rows).toEqual([{ 'run.model': 'a' }, { 'run.model': 'b' }])
    expect(grid.columns).toEqual([{ 'run.window': '5' }, { 'run.window': '30' }])
    expect(grid.cells[0]![1]).toBeUndefined()
    expect(grid.cells[1]![0]).toBeUndefined()
  })

  /**
   * @example
   * expect(grid.cells[0][0].value).toBe(0.5)
   */
  it('pools the cells of an averaged axis, and marks a missing repeat as incomplete', () => {
    const withSeed = [...axes, { key: 'run.seed', name: 'seed', values: ['1', '2'] }]
    const cells = [
      cell({ model: 'a', seed: '1', window: '5' }, { hits: 20 }),
      cell({ model: 'a', seed: '2', window: '5' }, { hits: 40 }),
      cell({ model: 'a', seed: '1', window: '30' }, { hits: 30 }),
    ]

    const grid = buildGrid(cells, withSeed, { averaged: ['run.seed'], columns: ['run.window'], rows: ['run.model'] })

    expect(grid.cells[0]![0]!.members).toHaveLength(2)
    expect(grid.cells[0]![0]!.value).toBe(0.5)
    expect(grid.cells[0]![0]!.scoring.scores[0]!.n).toBe(120)
    expect(grid.cells[0]![0]!.completion).toBeUndefined()
    expect(grid.cells[0]![1]!.completion).toEqual({ errored: 0, expected: 120, failed: 0, running: false, scored: 60 })
  })
})

describe('compareToBaseline', () => {
  const axes: MatrixAxis[] = [
    { key: 'run.method', name: 'method', values: ['decide', 'text'] },
    { key: 'run.model', name: 'model', values: ['a', 'b'] },
  ]
  const layout = { averaged: [], columns: ['run.method'], rows: ['run.model'] }

  /**
   * @example
   * expect(comparisons[0][0]).toMatchObject({ clear: true, delta: -0.5 })
   */
  it('takes each cell against its twin with the baseline value', () => {
    const cells = [
      cell({ method: 'decide', model: 'a' }, { hits: 10 }),
      cell({ method: 'text', model: 'a' }, { hits: 40 }),
      cell({ method: 'decide', model: 'b' }, { hits: 31 }),
      cell({ method: 'text', model: 'b' }, { hits: 30 }),
    ]
    const grid = buildGrid(cells, axes, layout)

    const comparisons = compareToBaseline(grid, { 'run.method': 'text' })

    expect(comparisons[0]![1]).toBe('base')
    expect(comparisons[0]![0]).toMatchObject({ clear: true, delta: -0.5 })
    expect(comparisons[1]![0]).toMatchObject({ clear: false })
    expect((comparisons[1]![0] as { delta: number }).delta).toBeCloseTo(1 / 60)
  })

  /**
   * @example
   * expect(comparisons[0][0]).toBeUndefined()
   */
  it('gives no difference when the baseline cell is incomplete', () => {
    const cells = [cell({ method: 'decide', model: 'a' }), cell({ method: 'text', model: 'a' }, { cases: 1, hits: 1 }), cell({ method: 'text', model: 'b' })]
    const grid = buildGrid(cells, axes, layout)

    const comparisons = compareToBaseline(grid, { 'run.method': 'text' })

    expect(comparisons[0]![0]).toBeUndefined()
  })

  /**
   * @example
   * expect(compareToBaseline(grid, { 'run.method': 'text', 'run.model': 'b' })[0][0]).toMatchObject({ delta: -0.5 })
   */
  it('fixes several axes at once, and compares every cell to one configuration when all are fixed', () => {
    const cells = [
      cell({ method: 'decide', model: 'a' }, { hits: 10 }),
      cell({ method: 'text', model: 'a' }, { hits: 20 }),
      cell({ method: 'decide', model: 'b' }, { hits: 30 }),
      cell({ method: 'text', model: 'b' }, { hits: 40 }),
    ]
    const grid = buildGrid(cells, axes, layout)

    const comparisons = compareToBaseline(grid, { 'run.method': 'text', 'run.model': 'b' })

    expect(comparisons[1]![1]).toBe('base')
    expect((comparisons[0]![0] as { delta: number }).delta).toBeCloseTo(-0.5)
    expect((comparisons[0]![1] as { delta: number }).delta).toBeCloseTo(-20 / 60)
    expect((comparisons[1]![0] as { delta: number }).delta).toBeCloseTo(-10 / 60)
  })

  /**
   * @example
   * expect(compareToBaseline(grid, { 'run.method': 'text', 'run.view': 'online' })[0][1]).toBe('base')
   */
  it('ignores baseline values of axes the grid does not lay out', () => {
    const grid = buildGrid([cell({ method: 'decide', model: 'a' }), cell({ method: 'text', model: 'a' })], axes, layout)

    const comparisons = compareToBaseline(grid, { 'run.method': 'text', 'run.view': 'online' })

    expect(comparisons[0]![1]).toBe('base')
    expect(comparisons[0]![0]).toMatchObject({ delta: 0 })
  })
})

describe('axisMeans', () => {
  /**
   * @example
   * expect(axisMeans(cells, axes).get('run.window')!.get('30')).toBe(0.5)
   */
  it('averages each value over settled cells and leaves out a one-case rerun', () => {
    const axes: MatrixAxis[] = [
      { key: 'run.model', name: 'model', values: ['a', 'b'] },
      { key: 'run.window', name: 'window', values: ['5', '30'] },
    ]
    const cells = [
      cell({ model: 'a', window: '5' }, { hits: 12 }),
      cell({ model: 'b', window: '5' }, { hits: 24 }),
      cell({ model: 'a', window: '30' }, { hits: 30 }),
      cell({ model: 'b', window: '30' }, { cases: 1, hits: 1 }),
    ]

    const means = axisMeans(cells, axes)

    expect(means.get('run.window')!.get('5')).toBeCloseTo(0.3)
    expect(means.get('run.window')!.get('30')).toBe(0.5)
    expect(means.get('run.model')!.get('b')).toBe(0.4)
  })
})

describe('bestRowsFirst', () => {
  /**
   * @example
   * expect(bestRowsFirst(grid, [0.2, 0.6, 0.4, 0.1])).toEqual([1, 0, 2, 3])
   */
  it('orders outer groups by their mean, then rows inside a group by theirs', () => {
    const axes: MatrixAxis[] = [
      { key: 'run.model', name: 'model', values: ['a', 'b'] },
      { key: 'run.method', name: 'method', values: ['decide', 'text'] },
      { key: 'run.window', name: 'window', values: ['5'] },
    ]
    const cells = ['a', 'b'].flatMap(model => ['decide', 'text'].map(method => cell({ method, model, window: '5' })))
    const grid = buildGrid(cells, axes, { averaged: [], columns: ['run.window'], rows: ['run.model', 'run.method'] })

    expect(bestRowsFirst(grid, [0.2, 0.6, 0.4, 0.1])).toEqual([1, 0, 2, 3])
    expect(bestRowsFirst(grid, [0.1, 0.1, 0.5, 0.4])).toEqual([2, 3, 0, 1])
  })
})
