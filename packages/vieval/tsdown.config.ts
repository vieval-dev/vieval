import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    'bin/vieval': 'src/bin/vieval.ts',
    'cli/index': 'src/cli/index.ts',
    'config': 'src/config/index.ts',
    'core/assertions/index': 'src/core/assertions/index.ts',
    'core/inference-executors/index': 'src/core/inference-executors/index.ts',
    'core/processors/results/index': 'src/core/processors/results/index.ts',
    'core/runner/index': 'src/core/runner/index.ts',
    'core/scheduler/index': 'src/core/scheduler/index.ts',
    'expect': 'src/expect.ts',
    'index': 'src/index.ts',
    'plugins/chat-models/index': 'src/plugins/chat-models/index.ts',
    'testing/expect-extensions': 'src/testing/expect-extensions.ts',
  },
  outDir: 'dist',
  sourcemap: true,
  target: 'node18',
})
