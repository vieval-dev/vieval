import { useHead } from '@unhead/vue'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, shallowRef } from 'vue'

import { FAVICON_KEYS, useStatusFavicon } from './useStatusFavicon'

/** Hrefs of the tab icons the app declares, in order (the Vitest runner page has an icon of its own). */
function iconHrefs(): string[] {
  return [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')]
    .map(link => link.getAttribute('href') ?? '')
    .filter(href => !href.startsWith('/__vitest__/'))
}

/** The app shell (plain logo, as `App.vue` declares it) with a page that badges the icon while `shown`. */
function shell(state: string) {
  const shown = shallowRef(true)
  const Page = defineComponent(() => {
    useStatusFavicon(() => state)
    return () => h('div', 'page')
  })
  const App = defineComponent(() => {
    useHead({ link: [{ href: './vieval-logo.svg', key: FAVICON_KEYS.svg, rel: 'icon', type: 'image/svg+xml' }, { href: './favicon-96x96.png', key: FAVICON_KEYS.png, rel: 'icon', type: 'image/png' }] })
    return () => (shown.value ? h(Page) : h('div', 'other page'))
  })
  return { App, shown }
}

describe('useStatusFavicon', () => {
  /**
   * @example
   * expect(iconHrefs()).toEqual([expect.stringMatching(/^data:image\/png/), expect.stringMatching(/^data:image\/png/)])
   */
  it('replaces the plain logo with a badged icon while the page is shown, and brings the logo back after', async () => {
    const { App, shown } = shell('failed')
    await render(App)

    await expect.poll(iconHrefs).toEqual([expect.stringMatching(/^data:image\/png;base64,/), expect.stringMatching(/^data:image\/png;base64,/)])

    shown.value = false
    await expect.poll(iconHrefs).toEqual(['./vieval-logo.svg', './favicon-96x96.png'])
  })

  /**
   * @example
   * expect(iconHrefs()).toEqual(['./vieval-logo.svg', './favicon-96x96.png'])
   */
  it('keeps the plain logo for a state without a clear outcome', async () => {
    const { App } = shell('unsupported')
    await render(App)

    await expect.poll(iconHrefs).toEqual(['./vieval-logo.svg', './favicon-96x96.png'])
  })
})
