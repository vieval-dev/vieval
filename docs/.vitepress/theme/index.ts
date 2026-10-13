import type { Theme } from 'vitepress'
import type { Component } from 'vue'

import { NolebaseGitChangelogPlugin } from '@nolebase/vitepress-plugin-git-changelog/client'
import { themeContextKey, VoidZeroTheme } from '@voidzero-dev/vitepress-theme'

import Layout from './Layout.vue'

import '@nolebase/vitepress-plugin-git-changelog/client/theme/voidzero.css'
import './fonts/alimamaFangYuanTi.css'
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
    ctx.app.use(NolebaseGitChangelogPlugin)
  },
  Layout: Layout as Component,
} satisfies Theme
