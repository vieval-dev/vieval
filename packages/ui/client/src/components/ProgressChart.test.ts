import type { RunProgress } from '../../../src/shared/contract'

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'

import ProgressChart from './ProgressChart.vue'

/** A run 1 h in: 30 of 120 cases settled at a steady pace, the ETA says 3 more hours. */
const progress: RunProgress = {
  basis: 'cases',
  cases: { completed: 30, estimatedTotal: 120, knownTotal: 120, running: 4, waiting: 0 },
  elapsedMs: 3_600_000,
  estimatedTotalMs: 14_400_000,
  etaMs: 10_800_000,
  history: Array.from({ length: 30 }, (_, index) => ({ completed: index + 1, elapsedMs: (index + 1) * 120_000 })),
  lowerBound: false,
  ratio: 0.25,
  tasks: { completed: 0, total: 1 },
}

describe('progressChart', () => {
  /**
   * @example
   * expect(screen.getByTestId('progress-projection')).toBeInTheDocument()
   */
  it('draws the actual line, the dashed projection to the ETA, and the recent rate of a live run', async () => {
    const screen = await render(ProgressChart, { props: { elapsedMs: 3_600_000, finishAt: '2026-10-12T13:00:00.000Z', live: true, progress } })

    await expect.element(screen.getByTestId('progress-actual')).toBeInTheDocument()
    await expect.element(screen.getByTestId('progress-projection')).toBeInTheDocument()
    await expect.element(screen.getByTestId('progress-now')).toBeInTheDocument()
    await expect.element(screen.getByTestId('progress-total-guide')).toBeInTheDocument()
    // 30 cases in 60 min: the last 15 min hold 8 settled cases (one every 2 min), 32 per hour.
    await expect.element(screen.getByTestId('progress-rate')).toHaveTextContent('32 cases/h (last 15m 00s)')
  })

  // ROOT CAUSE:
  //
  // With a long ETA (6 of 345 cases after 18 h, 1029 h to go) the time axis ran to the projected finish, so the actual
  // line took the first pixels of the chart and its pace could not be read.
  //
  // We fixed this by cutting the axis at twice the elapsed time; the cut projection ends at the right edge with
  // "→ <finish>" instead of the finish marker.
  /**
   * @example
   * expect(screen.getByTestId('progress-finish-beyond')).toHaveTextContent('→')
   */
  it('cuts the time axis at twice the elapsed time when the finish lies further out', async () => {
    // 1 h in, 3 h to go: the finish (4 h) is beyond 2 × 1 h.
    const far = await render(ProgressChart, { props: { elapsedMs: 3_600_000, finishAt: '2026-10-12T13:00:00.000Z', live: true, progress } })
    await expect.element(far.getByTestId('progress-finish-beyond')).toHaveTextContent('→')
    await expect.element(far.getByText('2h 00m')).toBeInTheDocument()
    far.unmount()

    // 1 h in, 30 min to go: the finish (1.5 h) fits, so it keeps its marker and no cut label.
    const near = await render(ProgressChart, { props: { elapsedMs: 3_600_000, finishAt: '2026-10-12T10:30:00.000Z', live: true, progress: { ...progress, estimatedTotalMs: 5_400_000, etaMs: 1_800_000 } } })
    await expect.element(near.getByTestId('progress-projection')).toBeInTheDocument()
    expect(near.getByTestId('progress-finish-beyond').query()).toBeNull()
  })

  /**
   * @example
   * expect(screen.getByTestId('progress-projection').query()).toBeNull()
   */
  it('draws no projection for an ended run or a run without an ETA', async () => {
    const ended = await render(ProgressChart, { props: { elapsedMs: 3_600_000, live: false, progress } })
    await expect.element(ended.getByTestId('progress-actual')).toBeInTheDocument()
    expect(ended.getByTestId('progress-projection').query()).toBeNull()
    ended.unmount()

    const unknown = await render(ProgressChart, { props: { elapsedMs: 3_600_000, live: true, progress: { ...progress, estimatedTotalMs: undefined, etaMs: undefined } } })
    await expect.element(unknown.getByTestId('progress-actual')).toBeInTheDocument()
    expect(unknown.getByTestId('progress-projection').query()).toBeNull()
  })
})
