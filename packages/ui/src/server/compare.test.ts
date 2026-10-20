import type { RunListItem, TaskNode } from '../shared/contract'

import { describe, expect, it } from 'vitest'

import { createEnvelopeFactory } from '../../test/helpers'
import { buildTaskNodes, createRunReducer } from '../shared/reduce'
import { buildMatrix } from './compare'

const TASK = 'evals%2Fdemo::default::run=tts%3Dofficial::eval=asr%3Dwhisper-1'
const TASK_WITH_JUDGE = 'evals%2Fdemo::default::run=tts%3Dofficial::eval=judge%3Dgpt-5.5'

interface CaseResult {
  exact?: number
  state: 'errored' | 'failed' | 'passed'
}

/** One ended run of {@link TASK}: the given cases (named `<prefix>-<index>`) settle, out of `total` expected ones. */
function runOf(runKey: string, startedAt: string, total: number, results: readonly CaseResult[], options: { prefix?: string, taskId?: string } = {}): { item: RunListItem, tasks: TaskNode[] } {
  const { prefix = 'case', taskId = TASK } = options
  const envelope = createEnvelopeFactory(runKey)
  const reducer = createRunReducer()
  const taskScope = { projectId: 'demo', taskId }
  reducer.apply(envelope('task.started', {}, taskScope))
  results.forEach((result, index) => {
    const scope = { caseId: `${index}:${prefix}-${index}`, projectId: 'demo', taskId }
    reducer.apply(envelope('case.started', { index, name: `${prefix}-${index}`, total }, scope))
    if (result.exact != null)
      reducer.apply(envelope('score.recorded', { kind: 'exact', score: result.exact }, scope))
    reducer.apply(envelope('case.ended', { index, name: `${prefix}-${index}`, state: result.state, total }, scope))
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

  // ROOT CAUSE:
  //
  // A run that settled every case it planned counted as full, whatever it planned. A 5-case smoke run after a 67-case
  // run became the headline, and the change from the previous run compared scores over different cases (0% "↓65.7"
  // from a 5-case run, "↑12.5" against a run of another 120-case set under the same entry):
  //
  // passed + failed + errored + skipped + timeout >= expected ? 'full' : 'partial'
  //
  // We fixed this by scoring every cell over the cases (`identity`) of its newest run that settled everything and is no
  // strict subset of another run; a settled run over other cases is `other`, kept in the history like a partial run,
  // but never the headline or a baseline.
  /**
   * @example
   * expect(cell.history.map(point => point.coverage)).toEqual(['other', 'full', 'other'])
   */
  it('marks a settled run over some of the cell\'s cases as other, and keeps the full run as the headline', () => {
    const smoke = runOf('run-smoke', '2026-10-19T06:00:00.000Z', 3, scored(3, 1))
    const full = runOf('run-full', '2026-10-19T06:36:00.000Z', 6, scored(6, 0.5))
    const limited = runOf('run-limited', '2026-10-19T07:00:00.000Z', 2, scored(2, 0))

    const [cell] = buildMatrix([smoke, full, limited]).cells

    expect(cell.caseCount).toBe(6)
    expect(cell.history.map(point => point.coverage)).toEqual(['other', 'full', 'other'])
    expect(cell.latest.runKey).toBe('run-full')
    expect(cell.latest.caseScores).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5])
  })

  /**
   * @example
   * expect(cells.map(cell => cell.superseded)).toEqual([true, false])
   */
  it('marks a cell superseded when a newer run ran the same run row with other eval values', () => {
    const old = runOf('run-old', '2026-10-19T06:36:00.000Z', 2, scored(2, 0.5))
    const fresh = runOf('run-new', '2026-10-20T06:36:00.000Z', 2, scored(2, 1), { taskId: TASK_WITH_JUDGE })

    const cells = buildMatrix([old, fresh]).cells

    expect(cells.map(cell => [cell.eval, cell.superseded])).toEqual([[{ asr: 'whisper-1' }, true], [{ judge: 'gpt-5.5' }, false]])
  })

  /**
   * @example
   * expect(cell.latest.runKey).toBe('run-formula-new')
   */
  it('scores a cell over the cases of its newest full run when another case set ran under the same entry', () => {
    const formula = runOf('run-formula', '2026-10-19T06:36:00.000Z', 3, scored(3, 0.5), { prefix: 'formula' })
    const other = runOf('run-other-set', '2026-10-19T07:00:00.000Z', 5, scored(5, 1), { prefix: 'mb' })
    const fresh = runOf('run-formula-new', '2026-10-19T08:00:00.000Z', 3, scored(3, 1), { prefix: 'formula' })

    const [cell] = buildMatrix([formula, other, fresh]).cells

    expect(cell.latest.runKey).toBe('run-formula-new')
    expect(cell.caseCount).toBe(3)
    expect(cell.history.map(point => point.coverage)).toEqual(['full', 'other', 'full'])
  })
})
