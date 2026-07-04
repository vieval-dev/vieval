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
            name: 'OPENAI_API_KEY',
            type: 'string',
          }),
          baseURL: config => config.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
          inferenceExecutor: 'openai',
          model: 'deepseek-v4-flash',
        }),
        chatModelFrom({
          apiKey: config => requiredEnvFrom(config.env, {
            name: 'OPENAI_API_KEY',
            type: 'string',
          }),
          baseURL: config => config.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
          inferenceExecutor: 'openai',
          model: 'deepseek-v4-pro',
        }),
        chatModelFrom({
          apiKey: config => requiredEnvFrom(config.env, {
            name: 'OPENAI_API_KEY',
            type: 'string',
          }),
          baseURL: config => config.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
          inferenceExecutor: 'openai',
          model: 'gpt-5.4-mini',
        }),
        chatModelFrom({
          apiKey: config => requiredEnvFrom(config.env, {
            name: 'OPENAI_API_KEY',
            type: 'string',
          }),
          baseURL: config => config.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
          inferenceExecutor: 'openai',
          model: 'gpt-5.5',
        }),
        chatModelFrom({
          apiKey: config => requiredEnvFrom(config.env, {
            name: 'OPENAI_API_KEY',
            type: 'string',
          }),
          baseURL: config => config.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
          inferenceExecutor: 'openai',
          model: 'gpt-5.5-pro',
        }),
      ],
    }),
  ],
  projects: [
    {
      include: ['tasks/**/*.eval.ts'],
      name: 'locomo-lobehub',
      root: '.',
      runMatrix: {
        override: {
          model: ['deepseek-v4-pro'], // <- change the model name here to run the tests with a different model
        },
      },
    },
  ],
})
