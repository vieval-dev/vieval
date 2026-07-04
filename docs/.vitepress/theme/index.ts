import type { Theme } from 'vitepress'
import type { Component } from 'vue'

import { themeContextKey, VoidZeroTheme } from '@voidzero-dev/vitepress-theme'

import Layout from './Layout.vue'

import './styles.css'
import 'uno.css'

const iconLogoPath = '/vieval-logo.svg'
const wordmarkDarkPath = '/vieval-logo-with-text-dark.svg'
const wordmarkLightPath = '/vieval-logo-with-text-light.svg'

export default {
  ...VoidZeroTheme,
  enhanceApp(ctx) {
    ctx.app.provide(themeContextKey, {
      footerBg: wordmarkDarkPath,
      logoAlt: 'Vieval',
      logoDark: wordmarkDarkPath,
      logoLight: wordmarkLightPath,
      monoIcon: iconLogoPath,
    })

    VoidZeroTheme.enhanceApp(ctx)
  },
  Layout: Layout as Component,
} satisfies Theme
