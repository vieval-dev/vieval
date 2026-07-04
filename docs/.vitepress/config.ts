import UnoCSS from 'unocss/vite'

import { extendConfig } from '@voidzero-dev/vitepress-theme/config'
import { defineConfig } from 'vitepress'

import { version } from '../../packages/vieval/package.json'

export default extendConfig(defineConfig({
  cleanUrls: true,
  description: 'Vitest-based evaluation framework for agents, models, and more.',
  head: [
    ['link', { href: '/favicon.ico', rel: 'icon', sizes: '48x48' }],
    ['link', { href: '/favicon.svg', rel: 'icon', type: 'image/svg+xml' }],
    ['link', { href: '/apple-touch-icon.png', rel: 'apple-touch-icon', sizes: '180x180' }],
    ['link', { href: '/site.webmanifest', rel: 'manifest' }],
  ],
  lang: 'en-US',
  lastUpdated: true,
  locales: {
    'en': {
      description: 'Vitest-based evaluation framework for agents, models, and more.',
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      themeConfig: {
        nav: [
          { activeMatch: '^/en/guide/', link: '/en/guide/', text: 'Guide' },
          { activeMatch: '^/en/config/', link: '/en/config/', text: 'Config' },
          { activeMatch: '^/en/api/', link: '/en/api/', text: 'API' },
          {
            items: [
              { link: `https://github.com/vieval-dev/vieval/releases/tag/v${version}`, text: 'Release' },
              { link: 'https://www.npmjs.com/package/vieval', text: 'Package' },
            ],
            text: `v${version}`,
          },
        ],
      },
      title: 'Vieval',
    },
    'zh-hans': {
      description: '面向 agents、模型和模型驱动工作流的 Vitest 风格评测框架。',
      label: '简体中文',
      lang: 'zh-Hans',
      themeConfig: {
        editLink: {
          pattern: 'https://github.com/vieval-dev/vieval/edit/main/docs/content/:path',
          text: '在 GitHub 上编辑此页',
        },
        footer: {
          copyright: `Copyright © ${new Date().getFullYear()} Vieval contributors.`,
          nav: [
            {
              items: [
                { link: '/zh-hans/guide/', text: '指南' },
                { link: '/zh-hans/config/', text: '配置' },
                { link: '/zh-hans/api/', text: 'API' },
              ],
              title: 'Vieval',
            },
            {
              items: [
                { link: 'https://github.com/vieval-dev/vieval', text: 'GitHub' },
                { link: 'https://www.npmjs.com/package/vieval', text: 'npm' },
              ],
              title: '资源',
            },
          ],
          social: [
            { icon: 'github', link: 'https://github.com/vieval-dev/vieval' },
          ],
        },
        nav: [
          { activeMatch: '^/zh-hans/guide/', link: '/zh-hans/guide/', text: '指南' },
          { activeMatch: '^/zh-hans/config/', link: '/zh-hans/config/', text: '配置' },
          { activeMatch: '^/zh-hans/api/', link: '/zh-hans/api/', text: 'API' },
          {
            items: [
              { link: `https://github.com/vieval-dev/vieval/releases/tag/v${version}`, text: 'Release' },
              { link: 'https://www.npmjs.com/package/vieval', text: 'Package' },
            ],
            text: `v${version}`,
          },
        ],
      },
      title: 'Vieval',
    },
  },
  markdown: {
    theme: {
      dark: 'github-dark',
      light: 'github-light',
    },
  },
  srcDir: 'content',
  themeConfig: {
    editLink: {
      pattern: 'https://github.com/vieval-dev/vieval/edit/main/docs/content/:path',
      text: 'Suggest changes to this page',
    },
    footer: {
      copyright: `Copyright © ${new Date().getFullYear()} Vieval contributors.`,
      nav: [
        {
          items: [
            { link: '/en/guide/', text: 'Guide' },
            { link: '/en/config/', text: 'Config' },
            { link: '/en/api/', text: 'API' },
          ],
          title: 'Vieval',
        },
        {
          items: [
            { link: 'https://github.com/vieval-dev/vieval', text: 'GitHub' },
            { link: 'https://www.npmjs.com/package/vieval', text: 'npm' },
          ],
          title: 'Resources',
        },
      ],
      social: [
        { icon: 'github', link: 'https://github.com/vieval-dev/vieval' },
      ],
    },
    logo: '/vieval-logo.svg',
    nav: [
      { activeMatch: '^/en/guide/', link: '/en/guide/', text: 'Guide' },
      { activeMatch: '^/en/config/', link: '/en/config/', text: 'Config' },
      { activeMatch: '^/en/api/', link: '/en/api/', text: 'API' },
      {
        items: [
          { link: `https://github.com/vieval-dev/vieval/releases/tag/v${version}`, text: 'Release' },
          { link: 'https://www.npmjs.com/package/vieval', text: 'Package' },
        ],
        text: `v${version}`,
      },
    ],
    search: {
      provider: 'local',
    },
    sidebar: {
      '/en/api/': [
        {
          items: [
            { link: '/en/api/', text: 'Overview' },
          ],
          text: 'API',
        },
      ],
      '/en/config/': [
        {
          items: [
            { link: '/en/config/', text: 'Overview' },
          ],
          text: 'Config',
        },
      ],
      '/en/guide/': [
        {
          items: [
            { link: '/en/guide/', text: 'Introduction' },
            { link: '/en/guide/getting-started', text: 'Getting Started' },
          ],
          text: 'Guide',
        },
      ],
      '/zh-hans/api/': [
        {
          items: [
            { link: '/zh-hans/api/', text: '概览' },
          ],
          text: 'API',
        },
      ],
      '/zh-hans/config/': [
        {
          items: [
            { link: '/zh-hans/config/', text: '概览' },
          ],
          text: '配置',
        },
      ],
      '/zh-hans/guide/': [
        {
          items: [
            { link: '/zh-hans/guide/', text: '介绍' },
            { link: '/zh-hans/guide/getting-started', text: '快速开始' },
          ],
          text: '指南',
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/vieval-dev/vieval' },
    ],
    variant: 'vitest',
  },
  title: 'Vieval',
  vite: {
    plugins: [
      UnoCSS() as any,
    ],
  },
}))
