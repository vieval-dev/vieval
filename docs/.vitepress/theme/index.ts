import type { Theme } from 'vitepress'

import { themeContextKey, VoidZeroTheme } from '@voidzero-dev/vitepress-theme'

import './styles.css'

export default {
  ...VoidZeroTheme,
  enhanceApp(ctx) {
    ctx.app.provide(themeContextKey, {
      footerBg: '/logo.svg',
      logoAlt: 'Vieval',
      logoDark: '/logo.svg',
      logoLight: '/logo.svg',
      monoIcon: '/logo.svg',
    })
    VoidZeroTheme.enhanceApp(ctx)
  },
} satisfies Theme
