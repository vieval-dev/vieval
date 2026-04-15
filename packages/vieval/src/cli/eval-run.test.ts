import { describe, expect, it } from 'vitest'

import { parseCliArguments } from './eval-run'

describe('parseCliArguments', () => {
  it('parses config, json, and repeated project flags', () => {
    expect(parseCliArguments(['--config', 'vieval.config.ts', '--json', '--project', 'alpha', '--project', 'beta'])).toEqual({
      configFilePath: 'vieval.config.ts',
      json: true,
      project: ['alpha', 'beta'],
    })
  })

  it('supports equals form flags and ignores the run command token', () => {
    expect(parseCliArguments(['run', '--config=vieval.config.ts', '--project=alpha'])).toEqual({
      configFilePath: 'vieval.config.ts',
      json: false,
      project: ['alpha'],
    })
  })

  it('normalizes forwarded argv prefixed with --', () => {
    expect(parseCliArguments(['--', '--json', '--project', 'alpha'])).toEqual({
      configFilePath: undefined,
      json: true,
      project: ['alpha'],
    })
  })
})
