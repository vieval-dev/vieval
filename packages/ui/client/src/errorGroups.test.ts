import type { CaseNode } from '../../src/shared/contract'

import { describe, expect, it } from 'vitest'

import { groupErrors, normalizeErrorMessage } from './errorGroups'

function caseOf(fields: Partial<CaseNode> & Pick<CaseNode, 'caseId' | 'state'>): CaseNode {
  return {
    artifactCount: 0,
    evidenceLinkCount: 0,
    index: 0,
    key: `task\u0000${fields.caseId}`,
    logLineCount: 0,
    metricCount: 0,
    name: fields.caseId,
    rounds: [],
    scores: {},
    startedAt: '2026-10-19T06:36:26.000Z',
    taskId: 'task',
    ...fields,
  }
}

describe('normalizeErrorMessage', () => {
  /**
   * @example
   * normalizeErrorMessage('… 429 … "ts":1792391786006') -> '… 429 … "ts":#'
   */
  it('keeps the first line and status codes, and masks long numbers and ids', () => {
    expect(normalizeErrorMessage('listener: Remote sent 429 response: {"request_id":"9f2c4e11ab03d7e5","ts":1792391786006}'))
      .toBe('listener: Remote sent 429 response: {"request_id":"#","ts":#}')
    expect(normalizeErrorMessage('ASR whisper-1: fetch failed\n    at node:internal/deps/undici')).toBe('ASR whisper-1: fetch failed')
    expect(normalizeErrorMessage('x'.repeat(200))).toHaveLength(161)
  })
})

describe('groupErrors', () => {
  /**
   * @example
   * three 429s and one TLS drop -> [{ count: 3 }, { count: 1 }]; passed and failed cases are left out.
   */
  it('groups cases without a result by error name and message, largest first', () => {
    const groups = groupErrors([{
      cases: [
        caseOf({ caseId: 'a', errorMessage: 'listener: Remote sent 429 response: {"ts":1792391786006}', errorName: 'APICallError', state: 'errored' }),
        caseOf({ caseId: 'b', errorMessage: 'listener: Remote sent 429 response: {"ts":1792391786999}', errorName: 'APICallError', state: 'errored' }),
        caseOf({ caseId: 'c', errorMessage: 'listener: Remote sent 429 response: {"ts":1792391787001}', errorName: 'APICallError', state: 'errored' }),
        caseOf({ caseId: 'd', errorMessage: 'ASR: fetch failed', errorName: 'TypeError', state: 'errored' }),
        caseOf({ caseId: 'e', errorMessage: 'expected 1 to be 2', errorName: 'AssertionError', state: 'failed' }),
        caseOf({ caseId: 'f', state: 'passed' }),
        caseOf({ caseId: 'g', state: 'unfinished' }),
      ],
    }])

    expect(groups.map(group => [group.count, group.errorName, group.message])).toEqual([
      [3, 'APICallError', 'listener: Remote sent 429 response: {"ts":#}'],
      [1, 'TypeError', 'ASR: fetch failed'],
      [1, undefined, 'The run ended while the case ran.'],
    ])
    expect(groups[0]!.example).toEqual({ caseId: 'a', name: 'a', taskId: 'task' })
  })
})
