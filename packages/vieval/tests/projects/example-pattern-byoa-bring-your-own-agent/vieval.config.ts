import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, loadEnv } from '../../../src'
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
  env: loadEnv('test', dirname(fileURLToPath(import.meta.url)), ''),
  projects: [
    {
      name: 'example-pattern-byoa-bring-your-own-agent',
      root: '.',
      include: ['evals/*.eval.ts'],
      exclude: [],
      runMatrix: {
        scenario: ['default'],
      },
      evalMatrix: {
        rubric: ['default'],
      },
    },
  ],
})
