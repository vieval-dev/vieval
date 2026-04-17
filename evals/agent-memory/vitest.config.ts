import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: '.',
  test: {
    include: [
      'eval/cases/**/*.test.ts',
      'eval/test-objects/**/*.test.ts',
    ],
  },
})
