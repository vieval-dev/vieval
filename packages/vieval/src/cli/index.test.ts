import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parseTopLevelCliArguments } from './index'

const packageDirectory = fileURLToPath(new URL('../../', import.meta.url))

describe('parseTopLevelCliArguments', () => {
  it('defaults to help when no command is provided', () => {
    expect(parseTopLevelCliArguments([])).toEqual({
      command: 'help',
      commandArgv: [],
    })
  })

  it('parses run command and forwards remaining argv', () => {
    expect(parseTopLevelCliArguments(['run', '--config', 'vieval.config.ts', '--project', 'chess'])).toEqual({
      command: 'run',
      commandArgv: ['--config', 'vieval.config.ts', '--project', 'chess'],
    })
  })

  it('normalizes forwarded argv prefixed with --', () => {
    expect(parseTopLevelCliArguments(['--', 'run', '--json'])).toEqual({
      command: 'run',
      commandArgv: ['--json'],
    })
  })

  it('accepts help aliases', () => {
    expect(parseTopLevelCliArguments(['help'])).toEqual({
      command: 'help',
      commandArgv: [],
    })
    expect(parseTopLevelCliArguments(['--help'])).toEqual({
      command: 'help',
      commandArgv: [],
    })
    expect(parseTopLevelCliArguments(['-h'])).toEqual({
      command: 'help',
      commandArgv: [],
    })
  })

  it('throws for unsupported command', () => {
    expect(() => parseTopLevelCliArguments(['list'])).toThrow('Unsupported vieval command "list". Expected "run", "compare", or "report".')
  })

  it('parses report command and forwards remaining argv', () => {
    expect(parseTopLevelCliArguments(['report', 'analyze', '.vieval/reports/run-1'])).toEqual({
      command: 'report',
      commandArgv: ['analyze', '.vieval/reports/run-1'],
    })
  })

  it('parses report index command and forwards remaining argv', () => {
    expect(parseTopLevelCliArguments(['report', 'index', '.vieval/reports'])).toEqual({
      command: 'report',
      commandArgv: ['index', '.vieval/reports'],
    })
  })

  it('parses compare command and forwards remaining argv', () => {
    expect(parseTopLevelCliArguments(['compare', '--config', 'vieval.cmp.config.ts'])).toEqual({
      command: 'compare',
      commandArgv: ['--config', 'vieval.cmp.config.ts'],
    })
  })

  /**
   * @example
   * expect(['if (isDirectExecution$1()) await main$1();', 'if (isDirectExecution()) await main();']).toHaveLength(1)
   */
  it('emits one self-executing CLI guard in the bundled artifact', async () => {
    execFileSync('pnpm', ['build'], {
      cwd: packageDirectory,
      stdio: 'pipe',
    })

    const bundledCliSource = await readFile(join(packageDirectory, 'dist', 'cli', 'index.mjs'), 'utf-8')

    // ROOT CAUSE:
    //
    // `src/cli/index.ts` is the published `bin`, but `src/cli/eval-run.ts`
    // also used to self-execute.
    // After bundling, both modules share the same `import.meta.url`, so both
    // direct-execution guards can match inside one `dist/cli/index.mjs` file.
    //
    // Before the patch, the bundled artifact contained two statements:
    // `if (isDirectExecution$1()) await main$1();`
    // `if (isDirectExecution()) await main();`
    //
    // We fix this by keeping self-execution only at the published top-level CLI
    // entrypoint and turning `eval-run.ts` into a reusable subcommand module.
    const directExecutionGuards = [...bundledCliSource.matchAll(/if \(isDirectExecution(?:\$\d+)?\(\)\) await main(?:\$\d+)?\(\);/g)]

    expect(directExecutionGuards).toHaveLength(1)
  })
})
