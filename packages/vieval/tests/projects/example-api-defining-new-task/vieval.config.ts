import { defineConfig } from '../../../src'
import { chatModelFrom, ChatModels } from '../../../src/plugins/chat-models'

export default defineConfig({
  plugins: [
    ChatModels({
      models: [
        chatModelFrom({
          aliases: ['judge-mini'],
          model: 'gpt-4.1-mini',
          inferenceExecutor: 'openai',
        }),
      ],
    }),
  ],
  projects: [
    {
      include: ['evals/*.eval.ts'],
      name: 'example-api-defining-new-task',
      root: '.',
      runMatrix: {
        scenario: ['baseline'],
      },
      evalMatrix: {
        rubric: ['default'],
      },
    },
  ],
})
