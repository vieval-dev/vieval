import { defineConfig } from 'vieval'

export default defineConfig({
  models: [
    {
      aliases: [],
      id: 'mock:model-a',
      inferenceExecutor: 'mock',
      inferenceExecutorId: 'mock:model-a',
      model: 'model-a',
    },
    {
      aliases: [],
      id: 'mock:model-b',
      inferenceExecutor: 'mock',
      inferenceExecutorId: 'mock:model-b',
      model: 'model-b',
    },
  ],
  projects: [
    {
      // All 16 tasks (4 eval tasks x 4 matrix rows) run at once, so the slow case bounds the run time.
      concurrency: {
        case: 8,
        task: 16,
      },
      include: ['evals/**/*.eval.ts'],
      name: 'showcase',
      root: '.',
      runMatrix: {
        extend: {
          model: ['mock:model-a', 'mock:model-b'],
          repeat: [1, 2],
        },
      },
    },
  ],
})
