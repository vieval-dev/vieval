import { cwd } from 'node:process'

import { defineConfig, loadEnv } from 'vieval'
import { chatModelFrom, ChatModels } from 'vieval/plugins/chat-models'

export default defineConfig({
  plugins: [
    ChatModels({
      models: [
        chatModelFrom({
          inferenceExecutor: 'openrouter',
          apiKey: config => config.env.OPENROUTER_API_KEY,
          baseURL: config => config.env.OPENROUTER_BASE_URL,
          model: 'qwen/qwen3.6-plus',
        }),
        chatModelFrom({
          inferenceExecutor: 'openrouter',
          apiKey: config => config.env.OPENROUTER_API_KEY,
          baseURL: config => config.env.OPENROUTER_BASE_URL,
          model: 'qwen/qwen3.5-flash-02-23',
        }),
        chatModelFrom({
          inferenceExecutor: 'openrouter',
          apiKey: config => config.env.OPENROUTER_API_KEY,
          baseURL: config => config.env.OPENROUTER_BASE_URL,
          model: 'qwen/qwen3.5-9b',
        }),
      ],
    }),
  ],
  env: loadEnv('test', cwd(), ''),
  projects: [
    {
      name: 'emotion-analysis',
      include: ['evals/emotion-analysis/**/*.eval.ts'],
      runMatrix: {
        override: {
          model: ['qwen/qwen3.6-plus', 'qwen/qwen3.5-flash-02-23', 'qwen/qwen3.5-9b'],
        },
      },
    },
  ],
})
