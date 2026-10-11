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
  ],
  projects: [
    {
      // All four cases of a matrix row run at the same time, so their logs interleave.
      concurrency: {
        case: 4,
        task: 1,
      },
      include: ['evals/**/*.eval.ts'],
      name: 'case-output',
      root: '.',
      runMatrix: {
        extend: {
          repeat: [1, 2],
        },
      },
    },
  ],
})
