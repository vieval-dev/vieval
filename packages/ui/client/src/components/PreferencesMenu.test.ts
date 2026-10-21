import { TooltipProvider } from 'reka-ui'
import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'

import PreferencesMenu from './PreferencesMenu.vue'

import { LOCALE_STORAGE_KEY } from '../i18n'
import { COLOR_VISION_STORAGE_KEY } from '../theme'

afterEach(() => {
  localStorage.removeItem(COLOR_VISION_STORAGE_KEY)
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  delete document.documentElement.dataset.colorVision
  document.documentElement.lang = 'en'
})

describe('preferencesMenu', () => {
  /**
   * @example
   * turning on "Colorblind" sets <html data-color-vision="safe"> and remembers it.
   */
  it('turns on colorblind state colors under Accessibility and remembers the choice', async () => {
    const screen = await render(defineComponent(() => () => h(TooltipProvider, () => h(PreferencesMenu))))

    await screen.getByRole('button', { name: 'Preferences' }).click()
    const colorblind = screen.getByRole('switch', { name: 'Colorblind' })
    await expect.element(colorblind).toHaveAttribute('aria-checked', 'false')
    await colorblind.click()

    await expect.poll(() => document.documentElement.dataset.colorVision).toBe('safe')
    await expect.element(colorblind).toHaveAttribute('aria-checked', 'true')
    expect(localStorage.getItem(COLOR_VISION_STORAGE_KEY)).toBe('safe')

    await colorblind.click()
    await expect.poll(() => document.documentElement.dataset.colorVision).toBeUndefined()
  })

  /**
   * @example
   * picking "简体中文" under Language renames the button "偏好设置" and sets <html lang="zh-Hans">.
   */
  it('switches the viewer language from the Language menu and remembers it', async () => {
    const screen = await render(defineComponent(() => () => h(TooltipProvider, () => h(PreferencesMenu))))

    await screen.getByRole('button', { name: 'Preferences' }).click()
    const language = screen.getByTestId('language-trigger')
    await expect.element(language).toHaveAccessibleName('Language Auto (English)')
    await language.click()
    await screen.getByRole('menuitemradio', { name: '简体中文' }).click()

    await expect.element(screen.getByRole('button', { name: '偏好设置' })).toBeInTheDocument()
    await expect.element(language).toHaveAccessibleName('语言 简体中文')
    await expect.element(screen.getByRole('switch', { name: '色盲模式' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('zh-Hans')
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-Hans')

    await language.click()
    await screen.getByRole('menuitemradio', { name: '自动（跟随浏览器）' }).click()

    await expect.element(language).toHaveAccessibleName('Language Auto (English)')
    expect(document.documentElement.lang).toBe('en')
  })
})
