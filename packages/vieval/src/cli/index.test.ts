import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
    expect(() => parseTopLevelCliArguments(['list'])).toThrow('Unsupported vieval command "list". Expected "run", "compare", "report", or "viewer".')
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

  /**
   * @example
   * it('accepts report cases as a report subcommand') verifies case inspection is routed from the top-level CLI.
   */
  it('accepts report cases as a report subcommand', () => {
    expect(parseTopLevelCliArguments(['report', 'cases', '.vieval/reports/run-1'])).toEqual({
      command: 'report',
      commandArgv: ['cases', '.vieval/reports/run-1'],
    })
  })

  /**
   * @example
   * it('accepts report compare as a report subcommand') verifies local artifact comparison routing.
   */
  it('accepts report compare as a report subcommand', () => {
    expect(parseTopLevelCliArguments(['report', 'compare', '.vieval/reports/left', '.vieval/reports/right'])).toEqual({
      command: 'report',
      commandArgv: ['compare', '.vieval/reports/left', '.vieval/reports/right'],
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
   * expect([]).toHaveLength(0)
   */
  it('emits an import-safe cli module and a dedicated executable shim', async () => {
    // NOTICE:
    // The bundle is written to a temporary directory, not to `dist/`.
    // Rebuilding `dist/` (with `clean: true`) while the workspace suite runs breaks other projects that import
    // `vieval` from `dist/` at the same time (the viewer's `--with-viewer` test loaded a half-written package).
    // Remove when no test imports the built package concurrently.
    const outDirectory = await mkdtemp(join(tmpdir(), 'vieval-build-'))
    let bundledCliSource: string
    let bundledBinSource: string
    try {
      execFileSync('pnpm', ['exec', 'tsdown', '--out-dir', outDirectory], {
        cwd: packageDirectory,
        stdio: 'pipe',
      })
      bundledCliSource = await readFile(join(outDirectory, 'cli', 'index.mjs'), 'utf-8')
      bundledBinSource = await readFile(join(outDirectory, 'bin', 'vieval.mjs'), 'utf-8')
    }
    finally {
      await rm(outDirectory, { force: true, recursive: true })
    }

    // ROOT CAUSE:
    //
    // `src/cli/index.ts` used to be both the published `bin` and a reusable
    // import target. That forced the module to carry direct-execution logic.
    // When other CLI modules also self-executed, bundling collapsed them into
    // one file and duplicated top-level entrypoint guards.
    //
    // The fix is architectural: keep `dist/cli/index.mjs` import-safe and move
    // process-bound startup into `dist/bin/vieval.mjs`.
    //
    // Before the refactor, `dist/bin/vieval.mjs` did not exist and
    // `dist/cli/index.mjs` contained a direct-execution guard.
    //
    const directExecutionGuards = [...bundledCliSource.matchAll(/if \(isDirectExecution(?:\$\d+)?\(\)\) await main(?:\$\d+)?\(\);/g)]

    expect(directExecutionGuards).toHaveLength(0)
    expect(bundledBinSource).toContain('runTopLevelCli(process.argv.slice(2)).catch')
    // NOTICE: a full tsdown build takes 3-8 s while the workspace suite runs in parallel; 5 s is the Vitest default.
  }, 60_000)
})
