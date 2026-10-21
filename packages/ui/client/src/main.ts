import { PiniaColada } from '@pinia/colada'
import { createHead } from '@unhead/vue/client'
import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'

import { i18n } from './i18n'
import { queryDefaults } from './queryDefaults'

import '@fontsource-variable/noto-sans'
import '@fontsource-variable/quicksand'
import '@fontsource/maple-mono/400.css'
import '@fontsource/maple-mono/700.css'
// Resource Han Rounded SC, self-hosted in slices (`scripts/buildCjkFont.py`): rounded CJK glyphs that match Quicksand.
import './assets/fonts/resource-han-rounded-sc/index.css'
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
import './styles.css'

createApp(App)
  .use(createPinia())
  .use(PiniaColada, { queryOptions: queryDefaults })
  .use(createHead())
  .use(i18n)
  .mount('#app')
