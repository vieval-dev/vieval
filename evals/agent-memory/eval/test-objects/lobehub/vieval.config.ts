import { cwd } from 'node:process'

import { defineConfig, loadEnv } from 'vieval'

export default defineConfig({
  concurrency: {
    case: 4,
  },
  models: [
    {
      aliases: ['default-locomo-model'],
      id: 'default-locomo-model',
      inferenceExecutor: 'fixture',
      inferenceExecutorId: 'default',
      model: 'default-locomo-model',
    },
  ],
  env: loadEnv('test', cwd(), ''),
  projects: [
    {
      include: ['tasks/**/*.eval.ts'],
      name: 'locomo-lobehub',
      root: '.',
    },
  ],
})
