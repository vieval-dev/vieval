import { TooltipProvider } from 'reka-ui'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'

import CountsBar from './CountsBar.vue'

/** A run of one million cases, as a matrix cell or a list row shows it. */
const counts = { errored: 0, failed: 482_113, passed: 517_887, running: 0, skipped: 0, timeout: 0, total: 1_000_000 }

/** Renders the bar inside a box of `width` px, like a narrow matrix cell or a table cell; tooltips need the provider `App.vue` sets. */
function inBox(width: number, labels: 'hover' | 'tooltip') {
  return defineComponent(() => () => h(TooltipProvider, { delayDuration: 0 }, () => h('div', { 'data-testid': 'box', 'style': { width: `${width}px` } }, [h(CountsBar, { counts, labels })])))
}

describe('countsBar', () => {
  /**
   * @example
   * expect(bar).toHaveAttribute('aria-label', '5 passed, 2 failed, 3 no result, 10 total')
   */
  it('shows cases without a result as their own hatched segment, apart from failed ones', async () => {
    const screen = await render(defineComponent(() => () => h(TooltipProvider, { delayDuration: 0 }, () => h('div', { style: { width: '200px' } }, [
      h(CountsBar, { counts: { errored: 2, failed: 2, passed: 5, running: 0, skipped: 0, timeout: 1, total: 10 }, labels: 'none' }),
    ]))))

    const bar = screen.getByTestId('counts-bar')
    await expect.element(bar).toHaveAttribute('aria-label', '5 passed, 2 failed, 3 no result, 10 total')
    const segments = [...bar.element().children] as HTMLElement[]
    expect(segments).toHaveLength(3)
    expect(segments[2]!.classList.contains('vv-hatch')).toBe(true)
    expect(segments[1]!.classList.contains('vv-hatch')).toBe(false)
  })

  /**
   * @example
   * data-color-vision="safe" turns the passed segment from green to Okabe-Ito blue (#0072b2).
   */
  it('recolors the segments in the colorblind-safe mode', async () => {
    const screen = await render(defineComponent(() => () => h(CountsBar, { counts: { errored: 0, failed: 0, passed: 1, running: 0, skipped: 0, timeout: 0, total: 1 }, labels: 'none' })))
    const passed = screen.getByTestId('counts-bar').element().children[0] as HTMLElement

    expect(getComputedStyle(passed).backgroundColor).toBe('rgb(47, 158, 68)')
    document.documentElement.dataset.colorVision = 'safe'
    try {
      expect(getComputedStyle(passed).backgroundColor).toBe('rgb(0, 114, 178)')
    }
    finally {
      delete document.documentElement.dataset.colorVision
    }
  })

  // ROOT CAUSE:
  //
  // The counts sat right of the bar with `whitespace-nowrap` and the bar was `flex-1`: the longer the numbers, the
  // narrower the bar, and with a million cases in a narrow card the text pushed the bar to nothing or overflowed.
  //
  // We fixed this by compact counts from 10 000 on (`1M`); the bar now carries no text beside it at all, so it keeps
  // the full width of its box and the numbers live in the hover labels or the tooltip.
  /**
   * @example
   * expect(screen.getByTestId('counts-segment-label').first()).toHaveTextContent('517.9K')
   */
  it('keeps a million cases short and inside a narrow card', async () => {
    const screen = await render(inBox(160, 'hover'))

    await expect.element(screen.getByTestId('counts-segment-label').first()).toHaveTextContent('517.9K')
    await expect.element(screen.getByTestId('counts-bar-hover')).toHaveAttribute('aria-label', '517887 passed, 482113 failed, 1000000 total')

    const box = screen.getByTestId('box').element()
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth)
    expect(screen.getByTestId('counts-bar').element().getBoundingClientRect().width).toBe(160)
  })

  /**
   * @example
   * expect(screen.getByTestId('counts-tooltip')).toHaveTextContent('517.9K passed')
   */
  it('shows the counts in a tooltip where the bar sits in a row', async () => {
    const screen = await render(inBox(120, 'tooltip'))

    expect(screen.getByTestId('box').element().textContent).toBe('')
    await screen.getByTestId('counts-bar-tooltip').hover()

    const tooltip = screen.getByTestId('counts-tooltip')
    await expect.element(tooltip).toHaveTextContent('517.9K passed')
    await expect.element(tooltip).toHaveTextContent('482.1K failed')
    await expect.element(tooltip).toHaveTextContent('/ 1M')
  })
})
