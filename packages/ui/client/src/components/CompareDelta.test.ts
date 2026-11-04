import type { CompareAxis, Interval, PairedDelta } from '../comparison'

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'

import CompareDelta from './CompareDelta.vue'

const axis: CompareAxis = { better: 'higher', kind: 'score', label: 'Overall', name: 'overall' }
const value: Interval = { high: 0.8, low: 0.6, mean: 0.7, n: 6 }
const delta: PairedDelta = { columnId: 'b', differences: [{ key: 'case-0', value: 0.1 }], interval: { high: 0.2, low: -0.05, mean: 0.1, n: 6 }, losses: 1, ties: 0, wins: 5 }
const format = (number: number) => number.toFixed(2)

describe('compareDelta', () => {
  /**
   * @example
   * expect(screen.container.querySelectorAll('[data-testid=compare-delta-running]')).toHaveLength(1)
   */
  it('marks a column whose newest run is still running, and only that one', async () => {
    const screen = await render(CompareDelta, {
      props: {
        axis,
        baseline: { label: 'a', value },
        caseLabels: new Map([['case-0', 'case 0']]),
        formatDelta: format,
        formatValue: format,
        rows: [{ delta, label: 'b', running: true, value }, { delta: { ...delta, columnId: 'c' }, label: 'c', value }],
      },
    })

    expect(screen.container.querySelectorAll('[data-testid=compare-delta-running]')).toHaveLength(1)
  })
})
