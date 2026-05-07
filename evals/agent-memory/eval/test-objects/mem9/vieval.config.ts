import { defineConfig } from 'vieval'

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
  projects: [
    {
      include: ['tasks/**/*.eval.ts'],
      name: 'locomo-mem9',
      root: '.',
    },
  ],
})
