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
        rubricModel: ['judge-mini'],
      },
      include: ['evals/*.eval.ts'],
      name: 'example-api-expect',
      root: '.',
      runMatrix: {
        scenario: ['baseline'],
      },
    },
  ],
})
