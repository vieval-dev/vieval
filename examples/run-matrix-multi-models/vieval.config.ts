import { defineConfig } from 'vieval'

export default defineConfig({
  models: [
    {
      aliases: [],
      id: 'mock:deepseek-v4-pro',
      inferenceExecutor: 'mock',
      inferenceExecutorId: 'mock:deepseek-v4-pro',
      model: 'deepseek-v4-pro',
    },
    {
      aliases: [],
      id: 'mock:gpt-5.6-luna',
      inferenceExecutor: 'mock',
      inferenceExecutorId: 'mock:gpt-5.6-luna',
      model: 'gpt-5.6-luna',
    },
  ],
  projects: [
    {
      evalMatrix: {
        extend: {
          rubric: ['strict'],
        },
      },
      include: ['evals/**/*.eval.ts'],
      name: 'run-matrix-multi-models',
      root: '.',
      runMatrix: {
        extend: {
          languages: ['en', 'ja', 'zh'],
          model: ['deepseek-v4-pro', 'gpt-5.6-luna'],
        },
      },
    },
  ],
})
