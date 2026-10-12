import { defineProject } from 'vitest/config'

/** Server and shared-module tests (Node). */
export default defineProject({
  root: import.meta.dirname,
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    name: 'viewer',
    testTimeout: 20_000,
  },
})
