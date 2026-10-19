import { defineConfig, loadEnv } from 'vieval'

export default defineConfig({
  // LoCoMo cases are derived once and shared by every test object.
  cache: { namespace: 'locomo-cases-v1' },
  // `.env.test` / `.env.local` next to this file configure every test object.
  env: loadEnv('test', import.meta.dirname, ''),
  id: 'agent-memory-semantic-approaches',
  workspaces: ['eval/test-objects/*'],
})
