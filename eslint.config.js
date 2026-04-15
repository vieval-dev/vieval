import { defineConfig } from '@moeru/eslint-config'

export default defineConfig(
  {
    masknet: false,
    preferArrow: false,
    perfectionist: false,
    sonarjs: false,
    sortPackageJsonScripts: false,
    typescript: true,
    unocss: false,
    vue: false,
  },
  {
    ignores: [
      '.agents/**',
      '.github/**',
      'CLAUDE.md', // Skip the symbolic link
    ],
  },
  {
    rules: {
      'antfu/import-dedupe': 'error',
      'import/order': 'off',
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
      'style/padding-line-between-statements': 'error',
      'vue/prefer-separate-static-class': 'off',
      'yaml/plain-scalar': 'off',
      'markdown/require-alt-text': 'off',
    },
  },
  {
    ignores: [
      '**/*.md',
    ],
    rules: {
      'perfectionist/sort-imports': [
        'error',
        {
          groups: [
            'type-builtin',
            'type-import',
            'type-internal',
            ['type-parent', 'type-sibling', 'type-index'],
            'default-value-builtin',
            'named-value-builtin',
            'value-builtin',
            'default-value-external',
            'named-value-external',
            'value-external',
            'default-value-internal',
            'named-value-internal',
            'value-internal',
            ['default-value-parent', 'default-value-sibling', 'default-value-index'],
            ['named-value-parent', 'named-value-sibling', 'named-value-index'],
            ['wildcard-value-parent', 'wildcard-value-sibling', 'wildcard-value-index'],
            ['value-parent', 'value-sibling', 'value-index'],
            'side-effect',
            'style',
          ],
          newlinesBetween: 1,
        },
      ],
    },
  },
)
