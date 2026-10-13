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
      include: ['evals/**/*.eval.ts'],
      name: 'showcase',
      root: '.',
      runMatrix: {
        extend: {
          model: ['mock:model-a', 'mock:model-b'],
          repeat: [1, 2],
        },
      },
      // All 16 tasks (4 eval tasks x 4 matrix rows) run at once, so the slow case bounds the run time. The case pool
      // is shared by the whole project, so it is large enough to keep every task moving.
      scheduler: {
        concurrency: {
          case: 32,
          task: 16,
        },
      },
    },
  ],
})
