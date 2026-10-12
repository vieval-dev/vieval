import { PiniaColada } from '@pinia/colada'
import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'

import { queryDefaults } from './queryDefaults'

import '@fontsource-variable/noto-sans'
import '@fontsource-variable/noto-sans-sc'
import '@fontsource-variable/quicksand'
import '@fontsource/maple-mono/400.css'
import '@fontsource/maple-mono/700.css'
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
import './styles.css'

createApp(App)
  .use(createPinia())
  .use(PiniaColada, { queryOptions: queryDefaults })
  .mount('#app')
