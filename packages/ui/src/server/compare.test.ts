import type { MetricDefinition, RunListItem, ScoreDefinition, TaskNode } from '../shared/contract'
import type { RunReducer } from '../shared/reduce'

import { describe, expect, it } from 'vitest'

import { createEnvelopeFactory, createReducerHandle } from '../../test/helpers'
import { buildTaskNodes, createRunReducer } from '../shared/reduce'
import { buildMatrix, compareRuns } from './compare'

const TASK = 'evals%2Fdemo::default::run=tts%3Dofficial::eval=asr%3Dwhisper-1'
const TASK_WITH_JUDGE = 'evals%2Fdemo::default::run=tts%3Dofficial::eval=judge%3Dgpt-5.5'

/** Score every case of the test runs records, unless a case names other values. */
const SCORE = 'demo.score'

interface CaseResult {
  /** Recorded metric values by name. */
  metrics?: Record<string, unknown>
  /** Recorded score values by name. */
  scores?: Record<string, number>
  state: 'errored' | 'failed' | 'passed'
}

interface TestRun {
  item: RunListItem
  reducer: RunReducer
  scoreDefinitions: ReadonlyMap<string, ScoreDefinition>
  tasks: TaskNode[]
}

/** One ended run of {@link TASK}: the given cases (named `<prefix>-<index>`) settle, out of `total` expected ones. */
function runOf(runKey: string, startedAt: string, total: number, results: readonly CaseResult[], options: { definitions?: ScoreDefinition[], metricDefinitions?: MetricDefinition[], prefix?: string, taskId?: string, taskIds?: string[] } = {}): TestRun {
  const { prefix = 'case', taskId = TASK } = options
  const envelope = createEnvelopeFactory(runKey)
  const reducer = createRunReducer()
  // Every task (matrix row) of the run runs the same cases.
  for (const id of options.taskIds ?? [taskId]) {
    const taskScope = { projectId: 'demo', taskId: id }
    reducer.apply(envelope('task.started', {}, taskScope))
    for (const definition of options.definitions ?? []) {
      reducer.apply(envelope('score.defined', definition, taskScope))
    }
    for (const definition of options.metricDefinitions ?? []) {
      reducer.apply(envelope('metric.defined', definition, taskScope))
    }
    results.forEach((result, index) => {
      const scope = { caseId: `${index}:${prefix}-${index}`, projectId: 'demo', taskId: id }
      reducer.apply(envelope('case.started', { index, name: `${prefix}-${index}`, total }, scope))
      for (const [name, value] of Object.entries(result.scores ?? {})) {
        reducer.apply(envelope('score.recorded', { name, value }, scope))
      }
      for (const [name, value] of Object.entries(result.metrics ?? {})) {
        reducer.apply(envelope('metric.recorded', { name, value }, scope))
      }
      reducer.apply(envelope('case.ended', { index, name: `${prefix}-${index}`, state: result.state, total }, scope))
    })
    reducer.apply(envelope('task.ended', { state: 'passed' }, taskScope))
  }
  const item: RunListItem = {
    attemptId: `attempt-${runKey}`,
    counts: { errored: 0, failed: 0, passed: 0, requeued: 0, running: 0, skipped: 0, timeout: 0, total: 0 },
    evalMatrix: {},
    experimentId: 'exp-a',
    headline: null,
    headlineDefinitions: [],
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
  return { item, reducer, scoreDefinitions: reducer.scoreDefinitions, tasks: buildTaskNodes(reducer, () => 0) }
}

const scored = (count: number, value: number): CaseResult[] => Array.from({ length: count }, () => ({ scores: { [SCORE]: value }, state: 'passed' }))

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

  /**
   * @example
   * expect(cell.latest.caseScores).toEqual([1, 0, null])
   */
  it('scores each run of a cell by its primary score, with the completion rate next to it', () => {
    const definitions = [{ label: 'Correct', name: 'demo.correct' }, { name: SCORE, primary: true }]
    const old = runOf('run-old', '2026-10-19T06:36:00.000Z', 2, scored(2, 0.5), { definitions })
    const fresh = runOf('run-new', '2026-10-19T07:00:00.000Z', 3, [
      { scores: { 'demo.correct': 1, [SCORE]: 1 }, state: 'passed' },
      { scores: { [SCORE]: 1 }, state: 'failed' },
      { state: 'errored' },
    ], { definitions })

    const [cell] = buildMatrix([old, fresh]).cells
    expect(cell.history.map(point => [point.runKey, point.score, point.completion])).toEqual([['run-old', 0.5, 1], ['run-new', 0.5, 2 / 3]])
    expect(cell.latest.scoring.primary).toBe(SCORE)
    // Per case, the value it counts with: the failed case 0, the errored one none.
    expect(cell.latest.caseScores).toEqual([1, 0, null])
  })

  /**
   * @example
   * expect(buildMatrix(runs).scoreDefinitions.map(definition => definition.name)).toEqual(['demo.correct', 'demo.score'])
   */
  it('returns the newest definition of each score in the cells', () => {
    const old = runOf('run-old', '2026-10-19T06:36:00.000Z', 1, scored(1, 1), { definitions: [{ label: 'Old', name: SCORE }] })
    const fresh = runOf('run-new', '2026-10-19T07:00:00.000Z', 1, scored(1, 1), { definitions: [{ label: 'Correct', name: 'demo.correct' }, { label: 'New', name: SCORE }] })

    expect(buildMatrix([old, fresh]).scoreDefinitions).toEqual([{ label: 'Correct', name: 'demo.correct' }, { label: 'New', name: SCORE }])
  })
})

describe('compareRuns', () => {
  /**
   * @example
   * expect(comparison.rows.map(row => [row.caseName, row.changed])).toEqual([['case-0', false], ['case-1', true], ['case-2', false]])
   */
  it('marks a row changed when the state or the value it counts with in the shared primary score differs', () => {
    const left = runOf('run-a', '2026-10-19T06:36:00.000Z', 3, [
      { scores: { 'demo.other': 0, [SCORE]: 1 }, state: 'passed' },
      { scores: { [SCORE]: 0.5 }, state: 'passed' },
      { scores: { [SCORE]: 1 }, state: 'failed' },
    ], { definitions: [{ name: SCORE, primary: true }] })
    const right = runOf('run-b', '2026-10-19T07:00:00.000Z', 3, [
      // Another value of a score that is not primary does not change the row.
      { scores: { 'demo.other': 1, [SCORE]: 1 }, state: 'passed' },
      { scores: { [SCORE]: 1 }, state: 'passed' },
      // Both failed: both count 0, whatever they recorded.
      { scores: { [SCORE]: 0 }, state: 'failed' },
    ], { definitions: [{ name: SCORE, primary: true }] })

    const comparison = compareRuns([createReducerHandle(left.reducer), createReducerHandle(right.reducer)], Date.parse('2026-10-20T00:00:00.000Z'))
    expect(comparison.primary).toBe(SCORE)
    expect(comparison.rows.map(row => [row.caseName, row.changed])).toEqual([['case-0', false], ['case-1', true], ['case-2', false]])
    expect(comparison.rows[0].cells['run-a']).toEqual({ counted: { 'demo.other': 0, [SCORE]: 1 }, durationMs: 3000, metrics: {}, roundCount: 1, scores: { unscored: {}, values: { 'demo.other': 0, [SCORE]: 1 } }, state: 'passed' })
    expect(comparison.columns.map(column => column.runs[0].headline?.headline.kind)).toEqual(['score', 'score'])
    expect(comparison.scoreDefinitions).toEqual([{ name: SCORE, primary: true }])
  })

  /**
   * @example
   * run-a judged by judge-a (definition), run-b by judge-b (definition) -> each column lists its own grader.
   */
  it('lists the graders of each column, so a comparison can tell columns judged by different models apart', () => {
    const left = runOf('run-a', '2026-10-19T06:36:00.000Z', 1, scored(1, 1), { definitions: [{ grader: { kind: 'model', model: 'judge-a' }, name: SCORE, primary: true }] })
    const right = runOf('run-b', '2026-10-19T07:00:00.000Z', 1, scored(1, 1), { definitions: [{ grader: { kind: 'model', model: 'judge-b' }, name: SCORE, primary: true }] })

    const comparison = compareRuns([createReducerHandle(left.reducer), createReducerHandle(right.reducer)], Date.parse('2026-10-20T00:00:00.000Z'))
    expect(comparison.columns.map(column => column.scoreGraders)).toEqual([
      { [SCORE]: [{ kind: 'model', model: 'judge-a' }] },
      { [SCORE]: [{ kind: 'model', model: 'judge-b' }] },
    ])
  })

  /**
   * @example
   * expect(comparison.primary).toBeUndefined()
   */
  it('compares by state only when the columns have different primary scores', () => {
    const left = runOf('run-a', '2026-10-19T06:36:00.000Z', 1, [{ scores: { 'demo.a': 1 }, state: 'passed' }])
    const right = runOf('run-b', '2026-10-19T07:00:00.000Z', 1, [{ scores: { 'demo.b': 0 }, state: 'passed' }])

    const comparison = compareRuns([createReducerHandle(left.reducer), createReducerHandle(right.reducer)], Date.parse('2026-10-20T00:00:00.000Z'))
    expect(comparison.primary).toBeUndefined()
    expect(comparison.rows.map(row => row.changed)).toEqual([false])
  })

  // ROOT CAUSE:
  //
  // If one run runs the same cases under several matrix rows (`context=none` and `context=home-assistant`), the
  // comparison showed each case once, with the result of whichever task came last.
  // This happens because `buildComparison` keyed its rows by the case name alone:
  //
  // rows.get(node.name)
  //
  // We fixed this by keying a row by the case name and its variant: the matrix values that tell apart the tasks of a
  // column that ran a case of that name.
  // rows.get(`${node.name}\0${variant}`)
  /**
   * @example
   * expect(comparison.rows.map(row => [row.caseName, row.variant])).toEqual([['case-0', 'context=home'], ['case-0', 'context=none']])
   */
  it('keeps one row per matrix row when a run runs the same case under several matrix rows', () => {
    const taskIds = ['evals%2Fdemo::default::run=context%3Dnone%26tts%3Dofficial::eval=asr%3Dwhisper-1', 'evals%2Fdemo::default::run=context%3Dhome%26tts%3Dofficial::eval=asr%3Dwhisper-1']
    const left = runOf('run-a', '2026-10-19T06:36:00.000Z', 1, scored(1, 1), { definitions: [{ name: SCORE, primary: true }], taskIds })
    const right = runOf('run-b', '2026-10-19T07:00:00.000Z', 1, scored(1, 0.5), { definitions: [{ name: SCORE, primary: true }], taskIds })

    const comparison = compareRuns([createReducerHandle(left.reducer), createReducerHandle(right.reducer)], Date.parse('2026-10-20T00:00:00.000Z'))
    expect(comparison.rows.map(row => [row.caseName, row.variant])).toEqual([['case-0', 'context=home'], ['case-0', 'context=none']])
    expect(comparison.rows.map(row => row.cells['run-b']?.counted[SCORE])).toEqual([0.5, 0.5])
    expect(comparison.summary.rows).toBe(2)
  })

  // ROOT CAUSE:
  //
  // If one workspace runs an extra matrix axis the others do not have (`prompt=baseline|cleanup` next to the shared
  // `context`), its rows were keyed `context=none, prompt=baseline` while the others were keyed `context=none`, so no
  // row had both columns and nothing could be paired against the baseline.
  //
  // We fixed this by aligning rows on the varying axes every column has, and averaging the tasks of a column that
  // differ only in an axis the other columns lack (as the matrix view averages axes).
  /**
   * @example
   * expect(comparison.rows.map(row => row.variant)).toEqual(['context=home', 'context=none'])
   */
  it('aligns rows on the axes every column has and averages an axis only one column runs', () => {
    const shared = ['evals%2Fdemo::default::run=context%3Dnone::eval=asr%3Dwhisper-1', 'evals%2Fdemo::default::run=context%3Dhome::eval=asr%3Dwhisper-1']
    const withPrompt = ['none', 'home'].flatMap(context => ['a', 'b'].map(prompt => `evals%2Fdemo::default::run=context%3D${context}%26prompt%3D${prompt}::eval=asr%3Dwhisper-1`))
    const left = runOf('run-a', '2026-10-19T06:36:00.000Z', 1, scored(1, 1), { definitions: [{ name: SCORE, primary: true }], taskIds: shared })
    const right = runOf('run-b', '2026-10-19T07:00:00.000Z', 1, scored(1, 0.5), { definitions: [{ name: SCORE, primary: true }], taskIds: withPrompt })

    const comparison = compareRuns([createReducerHandle(left.reducer), createReducerHandle(right.reducer)], Date.parse('2026-10-20T00:00:00.000Z'))
    expect(comparison.rows.map(row => row.variant)).toEqual(['context=home', 'context=none'])
    expect(comparison.rows.map(row => [row.cells['run-a']?.pooled, row.cells['run-b']?.pooled])).toEqual([[undefined, 2], [undefined, 2]])
    expect(comparison.rows.map(row => row.cells['run-b']?.counted[SCORE])).toEqual([0.5, 0.5])
  })

  /**
   * @example
   * expect(comparison.rows[0].cells['run-a'].metrics).toEqual({ 'demo.latency_ms': 120 })
   */
  it('carries the numeric metrics of each case, with the definitions of the metrics the cells have', () => {
    const run = runOf('run-a', '2026-10-19T06:36:00.000Z', 1, [{ metrics: { 'demo.label': 'text', 'demo.latency_ms': 120 }, scores: { [SCORE]: 1 }, state: 'passed' }], {
      metricDefinitions: [{ better: 'lower', name: 'demo.latency_ms', unit: 'ms' }],
    })

    const comparison = compareRuns([createReducerHandle(run.reducer)], Date.parse('2026-10-20T00:00:00.000Z'))
    expect(comparison.rows[0].cells['run-a']?.metrics).toEqual({ 'demo.latency_ms': 120 })
    expect(comparison.metricDefinitions).toEqual([{ better: 'lower', name: 'demo.latency_ms', unit: 'ms' }])
  })

  /**
   * @example
   * expect(comparison.columns[0].runs[0].workspaceId).toBe('ws-a')
   */
  it('names the workspace and project of each compared run, so runs of several workspaces can be told apart', () => {
    const run = runOf('run-a', '2026-10-19T06:36:00.000Z', 1, scored(1, 1))

    const comparison = compareRuns([createReducerHandle(run.reducer)], Date.parse('2026-10-20T00:00:00.000Z'))
    expect(comparison.columns[0].runs[0]?.project).toBe('demo')
    expect(comparison.columns[0].runs[0]?.workspaceId).toBe('ws-a')
  })
})
