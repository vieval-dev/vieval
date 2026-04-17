import { defineConfig } from '../../../src'
import { chatModelFrom, ChatModels } from '../../../src/plugins/chat-models'

export default defineConfig({
  plugins: [
    ChatModels({
      models: [
        chatModelFrom({
          aliases: ['fixture-default'],
          inferenceExecutor: 'fixture',
          model: 'fixture-model',
        }),
      ],
    }),
  ],
  projects: [
    {
      evalMatrix: {
        extend: {
          rubric: ['strict', 'lenient'],
        },
      },
      include: ['evals/*.eval.ts'],
      name: 'example-api-reporters-and-experiments',
      root: '.',
      runMatrix: {
        extend: {
          scenario: ['baseline', 'stress'],
        },
      },
    },
  ],
})
