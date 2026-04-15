import { defineConfig } from 'bumpp'
import { x } from 'tinyexec'

export default defineConfig({
  recursive: true,
  commit: 'release: v%s',
  sign: false,
  push: false,
  all: true,
  execute: async () => {
    await x('pnpm', ['publish', '-r', '--access', 'public', '--no-git-checks', '--dry-run'])
  },
})
