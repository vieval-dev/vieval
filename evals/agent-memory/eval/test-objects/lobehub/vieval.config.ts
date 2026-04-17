import { defineConfig } from 'vieval'

export default defineConfig({
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
      name: 'locomo-lobehub',
      root: '.',
    },
  ],
})
