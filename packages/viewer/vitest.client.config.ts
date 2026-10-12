import { join } from 'node:path'

import Vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'

import { playwright } from '@vitest/browser-playwright'
import { defineProject } from 'vitest/config'

/** Web UI component tests: they run in a real Chromium (Vitest browser mode) instead of a mocked DOM. */
export default defineProject({
  plugins: [Vue(), UnoCSS({ configFile: join(import.meta.dirname, 'uno.config.ts') })],
  root: import.meta.dirname,
  test: {
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: 'chromium' }],
      provider: playwright(),
      screenshotFailures: false,
    },
    include: ['client/**/*.test.ts'],
    name: 'viewer-client',
    setupFiles: ['client/test-setup.ts'],
  },
})
