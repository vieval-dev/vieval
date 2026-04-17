import { defineConfig } from 'vieval'

export default defineConfig({
  projects: [
    {
      include: ['tasks/**/*.eval.ts'],
      name: 'locomo-lobehub',
      root: '.',
    },
  ],
})
