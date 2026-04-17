import { defineConfig } from 'vieval'

export default defineConfig({
  projects: [
    {
      include: ['tasks/**/*.eval.ts'],
      name: 'locomo-mem9',
      root: '.',
    },
  ],
})
