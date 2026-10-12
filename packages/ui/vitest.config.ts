import { defineConfig } from 'vitest/config'

// The root `vitest.config.ts` lists the same two project files.
export default defineConfig({
  test: {
    projects: ['./vitest.server.config.ts', './vitest.client.config.ts'],
  },
})
