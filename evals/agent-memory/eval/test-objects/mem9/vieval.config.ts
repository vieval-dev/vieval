import { resolve } from 'node:path'

import { defineConfig, loadEnv, requiredEnvFrom } from 'vieval'
import { chatModelFrom, ChatModels } from 'vieval/plugins/chat-models'

export default defineConfig({
  // Env files live at the agent-memory root, so this workspace finds them alone and inside the comparison.
  env: loadEnv('test', resolve(import.meta.dirname, '../../..'), ''),
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
  scheduler: {
    concurrency: {
      case: 4,
    },
  },
})
