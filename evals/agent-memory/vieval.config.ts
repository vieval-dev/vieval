import { defineConfig } from 'vieval'

export default defineConfig({
  comparisons: [
    {
      benchmark: {
        id: 'locomo',
        sharedCaseNamespace: 'locomo-cases-v1',
      },
      excludesWorkspaces: [],
      id: 'agent-memory-semantic-approaches',
      includesWorkspaces: ['eval/test-objects/*'],
    },
  ],
})
