import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'packages/vieval',
      'packages/viewer/vitest.server.config.ts',
      'packages/viewer/vitest.client.config.ts',
    ],
  },
})
