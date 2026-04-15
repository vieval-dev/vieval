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
    expect(() => parseTopLevelCliArguments(['list'])).toThrow('Unsupported vieval command "list". Expected "run".')
  })
})
