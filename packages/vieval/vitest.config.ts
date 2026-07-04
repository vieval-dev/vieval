import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [],
  root: import.meta.dirname,
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
