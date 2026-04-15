import { defineConfig } from '../../../src'
import { chatModelFrom, ChatModels } from '../../../src/plugins/chat-models'

export default defineConfig({
  plugins: [
    ChatModels({
      models: [
        chatModelFrom({
          aliases: ['agent-mini', 'judge-mini'],
          model: 'gpt-4.1-mini',
          inferenceExecutor: 'openai',
        }),
        chatModelFrom({
          aliases: ['agent-large', 'judge-large'],
          model: 'gpt-4.1',
          inferenceExecutor: 'openai',
        }),
        chatModelFrom({
          aliases: ['agent-openrouter-mini'],
          model: 'openai/gpt-4.1-mini',
          inferenceExecutor: 'openrouter',
        }),
      ],
    }),
  ],
  projects: [
    {
      include: ['evals/*.eval.ts'],
      name: 'example-api-config-matrix',
      root: '.',
      runMatrix: {
        extend: {
          model: ['gpt-4.1-mini', 'gpt-4.1'],
          promptLanguage: ['en', 'zh'],
          scenario: ['baseline', 'stress'],
        },
      },
      evalMatrix: {
        extend: {
          rubric: ['strict', 'lenient'],
          rubricModel: ['judge-mini', 'judge-large'],
        },
      },
    },
  ],
})
