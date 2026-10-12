import { TooltipProvider } from 'reka-ui'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'

import CountsBar from './CountsBar.vue'

/** A run of one million cases, as a matrix cell or a list row shows it. */
const counts = { failed: 482_113, passed: 517_887, running: 0, skipped: 0, timeout: 0, total: 1_000_000 }

/** Renders the bar inside a box of `width` px, like a narrow matrix cell or a table cell; tooltips need the provider `App.vue` sets. */
function inBox(width: number, labels: 'hover' | 'tooltip') {
  return defineComponent(() => () => h(TooltipProvider, { delayDuration: 0 }, () => h('div', { 'data-testid': 'box', 'style': { width: `${width}px` } }, [h(CountsBar, { counts, labels })])))
}

describe('countsBar', () => {
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
