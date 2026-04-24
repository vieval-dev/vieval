import { describe, expect, it } from 'vitest'

import { parseCliArguments } from './eval-run'

describe('parseCliArguments', () => {
  it('parses config, json, and repeated project flags', () => {
    expect(parseCliArguments(['--config', 'vieval.config.ts', '--json', '--project', 'alpha', '--project', 'beta'])).toEqual({
      attempt: undefined,
      attemptConcurrency: undefined,
      caseConcurrency: undefined,
      configFilePath: 'vieval.config.ts',
      experiment: undefined,
      json: true,
      project: ['alpha', 'beta'],
      projectConcurrency: undefined,
      reportOut: undefined,
      taskConcurrency: undefined,
      workspace: undefined,
      workspaceConcurrency: undefined,
    })
  })

  it('supports equals form flags and ignores the run command token', () => {
    expect(parseCliArguments(['run', '--config=vieval.config.ts', '--project=alpha'])).toEqual({
      attempt: undefined,
      attemptConcurrency: undefined,
      caseConcurrency: undefined,
      configFilePath: 'vieval.config.ts',
      experiment: undefined,
      json: false,
      project: ['alpha'],
      projectConcurrency: undefined,
      reportOut: undefined,
      taskConcurrency: undefined,
      workspace: undefined,
      workspaceConcurrency: undefined,
    })
  })

  it('normalizes forwarded argv prefixed with --', () => {
    expect(parseCliArguments(['--', '--json', '--project', 'alpha'])).toEqual({
      attempt: undefined,
      attemptConcurrency: undefined,
      caseConcurrency: undefined,
      configFilePath: undefined,
      experiment: undefined,
      json: true,
      project: ['alpha'],
      projectConcurrency: undefined,
      reportOut: undefined,
      taskConcurrency: undefined,
      workspace: undefined,
      workspaceConcurrency: undefined,
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
      attemptConcurrency: undefined,
      caseConcurrency: undefined,
      configFilePath: undefined,
      experiment: 'baseline-v2',
      json: false,
      project: [],
      projectConcurrency: undefined,
      reportOut: '.vieval/reports',
      taskConcurrency: undefined,
      workspace: 'packages/vieval',
      workspaceConcurrency: undefined,
    })
  })

  it('parses concurrency caps from eval run CLI flags', () => {
    expect(parseCliArguments([
      'run',
      '--workspace-concurrency',
      '2',
      '--project-concurrency',
      '3',
      '--task-concurrency',
      '4',
      '--attempt-concurrency',
      '5',
      '--case-concurrency',
      '6',
    ])).toMatchObject({
      attemptConcurrency: 5,
      caseConcurrency: 6,
      projectConcurrency: 3,
      taskConcurrency: 4,
      workspaceConcurrency: 2,
    })
  })
})
