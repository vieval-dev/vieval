import { cwd } from 'node:process'

import { loadEnv } from 'vieval'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: '.',
  test: {
    env: loadEnv('test', cwd(), ''),
    include: [
      'eval/cases/**/*.test.ts',
      'eval/test-objects/**/*.test.ts',
    ],
  },
})
