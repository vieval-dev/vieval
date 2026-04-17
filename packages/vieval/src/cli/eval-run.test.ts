import { describe, expect, it } from 'vitest'

import { parseCliArguments } from './eval-run'

describe('parseCliArguments', () => {
  it('parses config, json, and repeated project flags', () => {
    expect(parseCliArguments(['--config', 'vieval.config.ts', '--json', '--project', 'alpha', '--project', 'beta'])).toEqual({
      attempt: undefined,
      configFilePath: 'vieval.config.ts',
      experiment: undefined,
      json: true,
      project: ['alpha', 'beta'],
      reportOut: undefined,
      workspace: undefined,
    })
  })

  it('supports equals form flags and ignores the run command token', () => {
    expect(parseCliArguments(['run', '--config=vieval.config.ts', '--project=alpha'])).toEqual({
      attempt: undefined,
      configFilePath: 'vieval.config.ts',
      experiment: undefined,
      json: false,
      project: ['alpha'],
      reportOut: undefined,
      workspace: undefined,
    })
  })

  it('normalizes forwarded argv prefixed with --', () => {
    expect(parseCliArguments(['--', '--json', '--project', 'alpha'])).toEqual({
      attempt: undefined,
      configFilePath: undefined,
      experiment: undefined,
      json: true,
      project: ['alpha'],
      reportOut: undefined,
      workspace: undefined,
    })
  })

  it('parses report identity and output flags', () => {
    expect(parseCliArguments([
      '--workspace',
      'packages/vieval',
      '--experiment',
      'baseline-v2',
      '--attempt',
      'attempt-03',
      '--report-out',
      '.vieval/reports',
    ])).toEqual({
      attempt: 'attempt-03',
      configFilePath: undefined,
      experiment: 'baseline-v2',
      json: false,
      project: [],
      reportOut: '.vieval/reports',
      workspace: 'packages/vieval',
    })
  })
})
