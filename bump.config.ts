import { defineConfig } from 'bumpp'
import { x } from 'tinyexec'

export default defineConfig({
  all: true,
  commit: 'release: v%s',
  execute: async () => {
    await x('pnpm', ['publish', '-r', '--access', 'public', '--no-git-checks', '--dry-run'])
  },
  push: false,
  recursive: true,
  sign: false,
})
