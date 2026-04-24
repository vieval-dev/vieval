import { defineConfig } from '../../../src'

export default defineConfig({
  models: [
    {
      aliases: [],
      id: 'openai:gpt-4.1-mini',
      inferenceExecutor: 'openai',
      inferenceExecutorId: 'openai:gpt-4.1-mini',
      model: 'gpt-4.1-mini',
    },
  ],
  projects: [
    {
      concurrency: {
        project: 2,
        task: 2,
      },
      include: ['evals/*.eval.ts'],
      name: 'concurrency-cli-overrides',
      root: '.',
    },
  ],
})
