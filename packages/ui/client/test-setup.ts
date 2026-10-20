import { PiniaColada } from '@pinia/colada'
import { createHead } from '@unhead/vue/client'
import { createPinia } from 'pinia'
import { beforeEach } from 'vitest'
import { config } from 'vitest-browser-vue'

import { i18n } from './src/i18n'
import { queryDefaults } from './src/queryDefaults'

// Component tests render with the app's real styles: virtualized lists size their scroll containers with UnoCSS
// classes, so without the stylesheet every row would render.
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
// The state and chart tokens (`--mark-*`, `--ink-*`, `--series-*`) that components read through `var(...)`.
import './src/styles.css'

// Components read the API through Pinia Colada, set the document title through Unhead, and translate through vue-i18n,
// as in `main.ts`; every test gets its own cache and head, and starts in English, so nothing leaks between tests.
beforeEach(() => {
  i18n.global.locale.value = 'en'
  config.global.plugins = [createPinia(), [PiniaColada, { queryOptions: queryDefaults }], createHead(), i18n]
})
