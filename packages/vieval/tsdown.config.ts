import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'bin/vieval': 'src/bin/vieval.ts',
    'index': 'src/index.ts',
    'config': 'src/config/index.ts',
    'cli/index': 'src/cli/index.ts',
    'core/runner/index': 'src/core/runner/index.ts',
    'core/assertions/index': 'src/core/assertions/index.ts',
    'core/processors/results/index': 'src/core/processors/results/index.ts',
    'core/inference-executors/index': 'src/core/inference-executors/index.ts',
    'plugins/chat-models/index': 'src/plugins/chat-models/index.ts',
    'expect': 'src/expect.ts',
    'testing/expect-extensions': 'src/testing/expect-extensions.ts',
  },
  target: 'node18',
  outDir: 'dist',
  clean: true,
  dts: true,
  sourcemap: true,
})
