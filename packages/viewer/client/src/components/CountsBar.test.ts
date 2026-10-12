import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'

import CountsBar from './CountsBar.vue'

/** A run of one million cases, as a matrix cell or a list row shows it. */
const counts = { failed: 482_113, passed: 517_887, running: 0, skipped: 0, timeout: 0, total: 1_000_000 }

/** Renders the bar inside a box of `width` px, like a narrow matrix cell. */
function inBox(width: number) {
  return defineComponent(() => () => h('div', { 'data-testid': 'box', 'style': { width: `${width}px` } }, [h(CountsBar, { counts })]))
}

describe('countsBar', () => {
  // ROOT CAUSE:
  //
  // The counts sat right of the bar with `whitespace-nowrap` and the bar was `flex-1`: the longer the numbers, the
  // narrower the bar, and with a million cases in a narrow card the text pushed the bar to nothing or overflowed.
  //
  // We fixed this by compact counts from 10 000 on (`1M`) and by letting the text wrap below a bar that keeps a
  // minimum width.
  /**
   * @example
   * expect(screen.getByTestId('counts-text')).toHaveTextContent('/ 1M')
   */
  it('keeps a million cases short and inside a narrow card', async () => {
    const screen = await render(inBox(160))

    await expect.element(screen.getByTestId('counts-text')).toHaveTextContent('517.9K')
    await expect.element(screen.getByTestId('counts-text')).toHaveTextContent('/ 1M')
    await expect.element(screen.getByTestId('counts-text')).toHaveAttribute('title', '517887 passed · 482113 failed · 1000000 total')

    const box = screen.getByTestId('box').element()
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth)
    expect(screen.getByTestId('counts-bar').element().getBoundingClientRect().width).toBeGreaterThanOrEqual(96)
  })
})
