import { PiniaColada } from '@pinia/colada'
import { createHead } from '@unhead/vue/client'
import { createPinia } from 'pinia'
import { beforeEach } from 'vitest'
import { config } from 'vitest-browser-vue'

import { queryDefaults } from './src/queryDefaults'

// Component tests render with the app's real styles: virtualized lists size their scroll containers with UnoCSS
// classes, so without the stylesheet every row would render.
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
// The state and chart tokens (`--mark-*`, `--ink-*`, `--series-*`) that components read through `var(...)`.
import './src/styles.css'

// Components read the API through Pinia Colada and set the document title through Unhead, as in `main.ts`; every
// test gets its own cache and head, so nothing leaks between tests.
beforeEach(() => {
  config.global.plugins = [createPinia(), [PiniaColada, { queryOptions: queryDefaults }], createHead()]
})
