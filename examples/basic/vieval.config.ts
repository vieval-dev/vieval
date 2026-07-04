import { cwd } from 'node:process'

import { defineConfig, loadEnv } from 'vieval'
import { chatModelFrom, ChatModels } from 'vieval/plugins/chat-models'

export default defineConfig({
  env: loadEnv('test', cwd(), ''),
  plugins: [
    ChatModels({
      models: [
        chatModelFrom({
          apiKey: config => config.env.OPENROUTER_API_KEY,
          baseURL: config => config.env.OPENROUTER_BASE_URL,
          inferenceExecutor: 'openrouter',
          model: 'qwen/qwen3.6-plus',
        }),
        chatModelFrom({
          apiKey: config => config.env.OPENROUTER_API_KEY,
          baseURL: config => config.env.OPENROUTER_BASE_URL,
          inferenceExecutor: 'openrouter',
          model: 'qwen/qwen3.5-flash-02-23',
        }),
        chatModelFrom({
          apiKey: config => config.env.OPENROUTER_API_KEY,
          baseURL: config => config.env.OPENROUTER_BASE_URL,
          inferenceExecutor: 'openrouter',
          model: 'qwen/qwen3.5-9b',
        }),
      ],
    }),
  ],
  projects: [
    {
      include: ['evals/emotion-analysis/**/*.eval.ts'],
      name: 'emotion-analysis',
      runMatrix: {
        override: {
          model: ['qwen/qwen3.6-plus', 'qwen/qwen3.5-flash-02-23', 'qwen/qwen3.5-9b'],
        },
      },
    },
  ],
})
