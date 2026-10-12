import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    'index': 'src/index.ts',
    'shared/contract': 'src/shared/contract.ts',
    'shared/reduce': 'src/shared/reduce.ts',
  },
  outDir: 'dist',
  sourcemap: true,
  target: 'node22',
})
