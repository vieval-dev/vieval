import { TooltipProvider } from 'reka-ui'
import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'

import HuePicker from './HuePicker.vue'

import { COLOR_VISION_STORAGE_KEY } from '../theme'

afterEach(() => {
  localStorage.removeItem(COLOR_VISION_STORAGE_KEY)
  delete document.documentElement.dataset.colorVision
})

describe('huePicker', () => {
  /**
   * @example
   * turning on "Colorblind" sets <html data-color-vision="safe"> and remembers it.
   */
  it('turns on colorblind state colors under Accessibility and remembers the choice', async () => {
    const screen = await render(defineComponent(() => () => h(TooltipProvider, () => h(HuePicker))))

    await screen.getByRole('button', { name: 'Colors' }).click()
    const colorblind = screen.getByRole('switch', { name: 'Colorblind' })
    await expect.element(colorblind).toHaveAttribute('aria-checked', 'false')
    await colorblind.click()

    await expect.poll(() => document.documentElement.dataset.colorVision).toBe('safe')
    await expect.element(colorblind).toHaveAttribute('aria-checked', 'true')
    expect(localStorage.getItem(COLOR_VISION_STORAGE_KEY)).toBe('safe')

    await colorblind.click()
    await expect.poll(() => document.documentElement.dataset.colorVision).toBeUndefined()
  })
})
