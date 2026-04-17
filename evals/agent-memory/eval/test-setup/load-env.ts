import process from 'node:process'

import { loadEnv } from 'vite'

const loadedEnv = loadEnv('test', process.cwd(), '')
for (const [key, value] of Object.entries(loadedEnv)) {
  process.env[key] ??= value
}
