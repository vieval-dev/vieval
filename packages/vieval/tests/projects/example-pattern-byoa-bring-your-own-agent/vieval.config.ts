import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, loadEnv } from '../../../src'
import { chatModelFrom, ChatModels } from '../../../src/plugins/chat-models'

export default defineConfig({
  env: loadEnv('test', dirname(fileURLToPath(import.meta.url)), ''),
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
      },
      exclude: [],
      include: ['evals/*.eval.ts'],
      name: 'example-pattern-byoa-bring-your-own-agent',
      root: '.',
      runMatrix: {
        model: ['judge-mini'],
        scenario: ['default'],
      },
    },
  ],
})
