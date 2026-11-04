import type { CompareAxis, Interval } from '../comparison'

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'

import CompareScoreTable from './CompareScoreTable.vue'

/** `count` score axes and `rows` columns, every column at 50% on every axis, without a baseline. */
function table(count: number, rows: number) {
  const axes: CompareAxis[] = Array.from({ length: count }, (_, index) => ({ better: 'higher', kind: 'score', label: `score ${index}`, name: `score-${index}` }))
  const columns = Array.from({ length: rows }, (_, index) => ({ id: `column-${index}`, label: `column ${index}` }))
  const interval: Interval = { high: 0.6, low: 0.4, mean: 0.5, n: 10 }
  const intervals = new Map(axes.map(axis => [axis.name, new Map(columns.map(column => [column.id, interval]))]))
  return { axes, columns, deltas: new Map(), formatDelta: String, formatValue: String, intervals, sortBy: 'score-0' }
}

describe('compareScoreTable', () => {
  /**
   * @example
   * expect(screen.container.querySelectorAll('tbody tr[data-hidden], tbody tr:not([aria-hidden])').length).toBeLessThan(120)
   */
  it('renders only the rows in view once a comparison has many columns, and scrolls both ways', async () => {
    const screen = await render(CompareScoreTable, { props: table(30, 120) })
    const scroller = screen.container.querySelector<HTMLElement>('[data-testid=compare-score-table]')!

    expect(scroller.dataset.virtual).toBe('true')
    expect(screen.container.querySelectorAll('tbody tr:not([aria-hidden])').length).toBeLessThan(120)
    expect(getComputedStyle(scroller).overflow).toBe('auto')
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth)
  })

  /**
   * @example
   * expect(scroller.dataset.virtual).toBeUndefined()
   */
  it('renders every row of a small comparison', async () => {
    const screen = await render(CompareScoreTable, { props: table(8, 7) })
    const scroller = screen.container.querySelector<HTMLElement>('[data-testid=compare-score-table]')!

    expect(scroller.dataset.virtual).toBeUndefined()
    expect(screen.container.querySelectorAll('tbody tr:not([aria-hidden])')).toHaveLength(7)
  })
})
