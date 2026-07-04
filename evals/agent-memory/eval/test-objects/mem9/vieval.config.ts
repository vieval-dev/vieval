import { cwd } from 'node:process'

import { defineConfig, loadEnv, requiredEnvFrom } from 'vieval'
import { chatModelFrom, ChatModels } from 'vieval/plugins/chat-models'

export default defineConfig({
  concurrency: {
    case: 4,
  },
  env: loadEnv('test', cwd(), ''),
  plugins: [
    ChatModels({
      models: [
        chatModelFrom({
          apiKey: config => requiredEnvFrom(config.env, {
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
  projects: [
    {
      include: ['tasks/**/*.eval.ts'],
      name: 'locomo-mem9',
      root: '.',
      runMatrix: {
        override: {
          model: ['openai/gpt-5.4-mini'],
        },
      },
    },
  ],
})
