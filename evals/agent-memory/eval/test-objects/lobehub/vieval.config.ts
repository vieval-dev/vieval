import { cwd } from 'node:process'

import { defineConfig, loadEnv, requiredEnvFrom } from 'vieval'
import { chatModelFrom, ChatModels } from 'vieval/plugins/chat-models'

export default defineConfig({
  concurrency: {
    case: 4,
  },
  plugins: [
    ChatModels({
      models: [
        chatModelFrom({
          apiKey: config => requiredEnvFrom(config.env.OPENROUTER_API_KEY, {
            name: 'OPENROUTER_API_KEY',
            type: 'string',
          }),
          baseURL: config => config.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
          inferenceExecutor: 'openrouter',
          model: 'openai/gpt-5.4-mini',
        }),
      ],
    }),
  ],
  env: loadEnv('test', cwd(), ''),
  projects: [
    {
      include: ['tasks/**/*.eval.ts'],
      name: 'locomo-lobehub',
      root: '.',
      runMatrix: {
        override: {
          model: ['openai/gpt-5.4-mini'],
        },
      },
    },
  ],
})
