import type { RunListItem, TaskNode } from '../shared/contract'

import { describe, expect, it } from 'vitest'

import { createEnvelopeFactory } from '../../test/helpers'
import { buildTaskNodes, createRunReducer } from '../shared/reduce'
import { buildMatrix } from './compare'

const TASK = 'evals%2Fdemo::default::run=tts%3Dofficial::eval=asr%3Dwhisper-1'

interface CaseResult {
  exact?: number
  state: 'errored' | 'failed' | 'passed'
}

/** One ended run of {@link TASK}: the given cases settle, out of `total` expected ones. */
function runOf(runKey: string, startedAt: string, total: number, results: readonly CaseResult[]): { item: RunListItem, tasks: TaskNode[] } {
  const envelope = createEnvelopeFactory(runKey)
  const reducer = createRunReducer()
  const taskScope = { projectId: 'demo', taskId: TASK }
  reducer.apply(envelope('task.started', {}, taskScope))
  results.forEach((result, index) => {
    const scope = { caseId: `${index}:case-${index}`, projectId: 'demo', taskId: TASK }
    reducer.apply(envelope('case.started', { index, name: `case-${index}`, total }, scope))
    if (result.exact != null)
      reducer.apply(envelope('score.recorded', { kind: 'exact', score: result.exact }, scope))
    reducer.apply(envelope('case.ended', { index, name: `case-${index}`, state: result.state, total }, scope))
  })
  reducer.apply(envelope('task.ended', { state: 'passed' }, taskScope))
  const item: RunListItem = {
    attemptId: `attempt-${runKey}`,
    counts: { errored: 0, failed: 0, passed: 0, requeued: 0, running: 0, skipped: 0, timeout: 0, total: 0 },
    evalMatrix: {},
    exactAverage: null,
    experimentId: 'exp-a',
    hybridAverage: null,
    judgeAverage: null,
    lastSeq: 0,
    matrix: {},
    projectIds: ['demo'],
    projectSegment: 'demo',
    reportPath: null,
    reportRoot: null,
    runId: runKey,
    runKey,
    source: 'offline',
    startedAt,
    state: 'ended',
    workspaceId: 'ws-a',
  }
  return { item, tasks: buildTaskNodes(reducer, () => 0) }
}

const scored = (count: number, exact: number): CaseResult[] => Array.from({ length: count }, () => ({ exact, state: 'passed' }))

describe('buildMatrix', () => {
  // ROOT CAUSE:
  //
  // A cell showed the newest run that touched it, whatever it measured. Re-running three cases of a 4-case task
  // after a full run made those three cases the headline score, and nothing marked the cell as partial:
  //
  // cell.latest = latest   // for every newer run
  //
  // We fixed this by giving every run of a cell a coverage (full, partial, none) and keeping a full (or running)
  // run as the headline over a newer partial one; the partial run stays in the history.
  /**
   * @example
   * expect(cell.latest.runKey).toBe('run-full')
   */
  it('keeps the newest full run as the headline over a newer partial re-run', () => {
    const full = runOf('run-full', '2026-10-19T06:36:00.000Z', 4, scored(4, 0.5))
    const partial = runOf('run-partial', '2026-10-19T07:00:00.000Z', 4, scored(3, 1))

    const [cell] = buildMatrix([full, partial]).cells

    expect(cell.latest.runKey).toBe('run-full')
    expect(cell.latest.coverage).toBe('full')
    expect(cell.latest.caseTotal).toBe(4)
    expect(cell.history.map(point => [point.runKey, point.coverage])).toEqual([['run-full', 'full'], ['run-partial', 'partial']])
  })

  /**
   * @example
   * expect(cell.history[0].coverage).toBe('none')
   */
  it('marks a run whose every case errored as without a result, and falls back to the newest run without a full one', () => {
    const errored = runOf('run-errored', '2026-10-19T06:23:00.000Z', 2, [{ state: 'errored' }, { state: 'errored' }])
    const partial = runOf('run-partial', '2026-10-19T06:24:00.000Z', 2, scored(1, 1))

    const [cell] = buildMatrix([errored, partial]).cells

    expect(cell.history.map(point => point.coverage)).toEqual(['none', 'partial'])
    expect(cell.latest.runKey).toBe('run-partial')
  })

  /**
   * @example
   * expect(cell.latest.coverage).toBe('full')
   */
  it('counts a run whose every case settled as full even when some cases errored', () => {
    const run = runOf('run-a', '2026-10-19T06:36:00.000Z', 3, [...scored(2, 1), { state: 'errored' }])

    const [cell] = buildMatrix([run]).cells

    expect(cell.latest.coverage).toBe('full')
    expect(cell.latest.counts).toMatchObject({ errored: 1, passed: 2, total: 3 })
  })

  /**
   * @example
   * expect(cell.latest.runKey).toBe('run-new')
   */
  it('moves the headline to a newer full run', () => {
    const old = runOf('run-old', '2026-10-19T06:36:00.000Z', 2, scored(2, 0.5))
    const partial = runOf('run-partial', '2026-10-19T07:00:00.000Z', 2, scored(1, 1))
    const fresh = runOf('run-new', '2026-10-19T11:07:00.000Z', 2, scored(2, 1))

    const [cell] = buildMatrix([fresh, old, partial]).cells

    expect(cell.latest.runKey).toBe('run-new')
    expect(cell.history.map(point => point.runKey)).toEqual(['run-old', 'run-partial', 'run-new'])
  })
})
