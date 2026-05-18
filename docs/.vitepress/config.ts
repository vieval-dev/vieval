import { extendConfig } from '@voidzero-dev/vitepress-theme/config'
import { defineConfig } from 'vitepress'

import { version } from '../../packages/vieval/package.json'

export default extendConfig(defineConfig({
  lang: 'en-US',
  title: 'Vieval',
  description: 'Vitest-based evaluation framework for agents, models, and more.',
  srcDir: 'content',
  lastUpdated: true,
  cleanUrls: true,
  locales: {
    'en': {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      title: 'Vieval',
      description: 'Vitest-based evaluation framework for agents, models, and more.',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/en/guide/', activeMatch: '^/en/guide/' },
          { text: 'Config', link: '/en/config/', activeMatch: '^/en/config/' },
          { text: 'API', link: '/en/api/', activeMatch: '^/en/api/' },
          {
            text: `v${version}`,
            items: [
              { text: 'Release', link: `https://github.com/vieval-dev/vieval/releases/tag/v${version}` },
              { text: 'Package', link: 'https://www.npmjs.com/package/vieval' },
            ],
          },
        ],
      },
    },
    'zh-hans': {
      label: '简体中文',
      lang: 'zh-Hans',
      title: 'Vieval',
      description: '面向 agents、模型和模型驱动工作流的 Vitest 风格评测框架。',
      themeConfig: {
        editLink: {
          pattern: 'https://github.com/vieval-dev/vieval/edit/main/docs/content/:path',
          text: '在 GitHub 上编辑此页',
        },
        footer: {
          copyright: `Copyright © ${new Date().getFullYear()} Vieval contributors.`,
          nav: [
            {
              title: 'Vieval',
              items: [
                { text: '指南', link: '/zh-hans/guide/' },
                { text: '配置', link: '/zh-hans/config/' },
                { text: 'API', link: '/zh-hans/api/' },
              ],
            },
            {
              title: '资源',
              items: [
                { text: 'GitHub', link: 'https://github.com/vieval-dev/vieval' },
                { text: 'npm', link: 'https://www.npmjs.com/package/vieval' },
              ],
            },
          ],
          social: [
            { icon: 'github', link: 'https://github.com/vieval-dev/vieval' },
          ],
        },
        nav: [
          { text: '指南', link: '/zh-hans/guide/', activeMatch: '^/zh-hans/guide/' },
          { text: '配置', link: '/zh-hans/config/', activeMatch: '^/zh-hans/config/' },
          { text: 'API', link: '/zh-hans/api/', activeMatch: '^/zh-hans/api/' },
          {
            text: `v${version}`,
            items: [
              { text: 'Release', link: `https://github.com/vieval-dev/vieval/releases/tag/v${version}` },
              { text: 'Package', link: 'https://www.npmjs.com/package/vieval' },
            ],
          },
        ],
      },
    },
  },
  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark',
    },
  },
  themeConfig: {
    variant: 'vite',
    logo: '/logo.svg',
    search: {
      provider: 'local',
    },
    editLink: {
      pattern: 'https://github.com/vieval-dev/vieval/edit/main/docs/content/:path',
      text: 'Suggest changes to this page',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/vieval-dev/vieval' },
    ],
    footer: {
      copyright: `Copyright © ${new Date().getFullYear()} Vieval contributors.`,
      nav: [
        {
          title: 'Vieval',
          items: [
            { text: 'Guide', link: '/en/guide/' },
            { text: 'Config', link: '/en/config/' },
            { text: 'API', link: '/en/api/' },
          ],
        },
        {
          title: 'Resources',
          items: [
            { text: 'GitHub', link: 'https://github.com/vieval-dev/vieval' },
            { text: 'npm', link: 'https://www.npmjs.com/package/vieval' },
          ],
        },
      ],
      social: [
        { icon: 'github', link: 'https://github.com/vieval-dev/vieval' },
      ],
    },
    nav: [
      { text: 'Guide', link: '/en/guide/', activeMatch: '^/en/guide/' },
      { text: 'Config', link: '/en/config/', activeMatch: '^/en/config/' },
      { text: 'API', link: '/en/api/', activeMatch: '^/en/api/' },
      {
        text: `v${version}`,
        items: [
          { text: 'Release', link: `https://github.com/vieval-dev/vieval/releases/tag/v${version}` },
          { text: 'Package', link: 'https://www.npmjs.com/package/vieval' },
        ],
      },
    ],
    sidebar: {
      '/en/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Introduction', link: '/en/guide/' },
            { text: 'Getting Started', link: '/en/guide/getting-started' },
          ],
        },
      ],
      '/en/config/': [
        {
          text: 'Config',
          items: [
            { text: 'Overview', link: '/en/config/' },
          ],
        },
      ],
      '/en/api/': [
        {
          text: 'API',
          items: [
            { text: 'Overview', link: '/en/api/' },
          ],
        },
      ],
      '/zh-hans/guide/': [
        {
          text: '指南',
          items: [
            { text: '介绍', link: '/zh-hans/guide/' },
            { text: '快速开始', link: '/zh-hans/guide/getting-started' },
          ],
        },
      ],
      '/zh-hans/config/': [
        {
          text: '配置',
          items: [
            { text: '概览', link: '/zh-hans/config/' },
          ],
        },
      ],
      '/zh-hans/api/': [
        {
          text: 'API',
          items: [
            { text: '概览', link: '/zh-hans/api/' },
          ],
        },
      ],
    },
  },
}))
