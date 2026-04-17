import { describe, expect, it } from 'vitest'

import { parseTopLevelCliArguments } from './index'

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
})
