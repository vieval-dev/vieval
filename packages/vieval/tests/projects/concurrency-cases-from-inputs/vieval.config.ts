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
      include: ['evals/*.eval.ts'],
      name: 'concurrency-cases-from-inputs',
      root: '.',
    },
  ],
})
