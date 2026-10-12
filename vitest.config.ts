import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'packages/vieval',
      'packages/ui/vitest.server.config.ts',
      'packages/ui/vitest.client.config.ts',
    ],
  },
})
