import { PiniaColada } from '@pinia/colada'
import { createPinia } from 'pinia'
import { beforeEach } from 'vitest'
import { config } from 'vitest-browser-vue'

import { queryDefaults } from './src/queryDefaults'

// Component tests render with the app's real styles: virtualized lists size their scroll containers with UnoCSS
// classes, so without the stylesheet every row would render.
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

// Components read the API through Pinia Colada; every test gets its own cache, so no response leaks between tests.
beforeEach(() => {
  config.global.plugins = [createPinia(), [PiniaColada, { queryOptions: queryDefaults }]]
})
