import { describe, expect, it } from 'vitest'

import { parseReportIndexCliArguments } from './report-index'

describe('parseReportIndexCliArguments', () => {
  it('parses index input with default format', () => {
    expect(parseReportIndexCliArguments(['index', '.vieval/reports'])).toEqual({
      format: 'table',
      output: undefined,
      reportPath: '.vieval/reports',
    })
  })

  it('supports report index argv forwarding with output and json format', () => {
    expect(parseReportIndexCliArguments([
      'report',
      'index',
      '.vieval/reports',
      '--output',
      '.vieval/reports/index/runs.jsonl',
      '--format',
      'json',
    ])).toEqual({
      format: 'json',
      output: '.vieval/reports/index/runs.jsonl',
      reportPath: '.vieval/reports',
    })
  })
})
