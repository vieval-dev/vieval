import type { RunSnapshot } from '../../src/shared/contract'

import { describe, expect, it } from 'vitest'

import { runSwitcherOptions } from './switcher'

/** The parts of a snapshot the task and case switchers read. */
// NOTICE:
// A full `RunSnapshot` carries progress, the current position, event counts, and every round of every case; none of
// it is read by `runSwitcherOptions`, so the fixture keeps only the fields it reads and is cast to the snapshot type.
// Source: `RunSnapshot` in `src/shared/contract.ts`.
// Removal condition: a shared snapshot fixture builder for client tests.
const snapshot = {
  runKey: 'run-1-a',
  tasks: [
    {
      caseCounts: { failed: 1, passed: 1, running: 0, skipped: 0, timeout: 0, total: 2 },
      cases: [
        { caseId: '0:chrome%2Fa', durationMs: 90_000, index: 0, name: 'chrome/a', scores: { exact: 1 }, state: 'passed', taskId: 't::1' },
        { caseId: '1:chrome%2Fb', index: 1, name: 'chrome/b', scores: {}, state: 'running', taskId: 't::1' },
      ],
      displayName: 'osworld [model=gpt-5.5]',
      id: 't::1',
      scores: { exact: 0.5 },
      startedAt: '2026-10-12T15:47:59.000Z',
      state: 'running',
    },
  ],
} as unknown as RunSnapshot

describe('runSwitcherOptions', () => {
  /**
   * @example
   * expect(runSwitcherOptions(snapshot, 'case', 't::1')?.map(option => option.id)).toEqual(['0:chrome%2Fa', '1:chrome%2Fb'])
   */
  it('offers the cases of the task as siblings of a case, linked to their case pages', () => {
    const options = runSwitcherOptions(snapshot, 'case', 't::1')

    expect(options?.map(option => option.id)).toEqual(['0:chrome%2Fa', '1:chrome%2Fb'])
    expect(options?.[0]?.detail).toBe('#1 · 1m 30s')
    expect(options?.[1]?.detail).toBe('#2')
    expect(options?.[1]?.state).toBe('running')
    expect(options?.[0]?.href).toBe('#/runs/run-1-a/case?caseId=0%3Achrome%252Fa&taskId=t%3A%3A1')
  })

  /**
   * @example
   * expect(runSwitcherOptions(snapshot, 'task')?.[0]?.label).toBe('osworld [model=gpt-5.5]')
   */
  it('offers the tasks of the run as siblings of a task', () => {
    const options = runSwitcherOptions(snapshot, 'task')

    expect(options?.[0]?.label).toBe('osworld [model=gpt-5.5]')
    expect(options?.[0]?.exact).toBe(0.5)
    expect(options?.[0]?.counts?.total).toBe(2)
  })

  /**
   * @example
   * expect(runSwitcherOptions(undefined, 'task')).toBeUndefined()
   */
  it('offers nothing before the snapshot loaded', () => {
    expect(runSwitcherOptions(undefined, 'task')).toBeUndefined()
  })
})
