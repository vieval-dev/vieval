import { defineConfig } from '../../../src'
import { chatModelFrom, ChatModels } from '../../../src/plugins/chat-models'

export default defineConfig({
  plugins: [
    ChatModels({
      models: [
        chatModelFrom({
          aliases: ['judge-mini'],
          inferenceExecutor: 'openai',
          model: 'gpt-4.1-mini',
        }),
      ],
    }),
  ],
  projects: [
    {
      evalMatrix: {
        rubric: ['default'],
      },
      include: ['evals/*/*.eval.ts'],
      name: 'example-api-load-datasource-as-cases',
      root: '.',
      runMatrix: {
        scenario: ['baseline', 'stress'],
      },
    },
  ],
})
