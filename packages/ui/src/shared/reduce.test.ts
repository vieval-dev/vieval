import type { CaseRound } from './contract'

import { describe, expect, it } from 'vitest'

import { createEnvelopeFactory } from '../../test/helpers'
import { axisValues, buildTaskNodes, countedScores, createRunReducer, currentPosition, estimateProgress, parseTaskId, resolveTaskHeadline, scoreRounds } from './reduce'

const TASK = 'evals%2Fdemo::default::run=model%3Dm%26repeat%3D1::eval=default'
const scope = (caseId?: string) => ({ caseId, projectId: 'demo', taskId: TASK })

describe('createRunReducer', () => {
  it('builds project → task → case and keeps the last round as the final state', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    reducer.apply(envelope('run.started', { totalTasks: 1 }))
    reducer.apply(envelope('task.queued', { displayName: 'demo [model=m, repeat=1]' }, scope()))
    reducer.apply(envelope('project.started', { taskCount: 1 }, { projectId: 'demo' }))
    reducer.apply(envelope('task.started', {}, scope()))
    reducer.apply(envelope('case.started', { index: 0, input: { id: 'a' }, name: 'chrome/a', total: 2 }, scope('0:chrome%2Fa')))
    reducer.apply(envelope('metric.recorded', { name: 'osworld.pod', value: 'pod-a' }, scope('0:chrome%2Fa')))
    reducer.apply(envelope('score.recorded', { name: 'osworld.success', value: 0.5 }, scope('0:chrome%2Fa')))
    reducer.apply(envelope('case.ended', { index: 0, name: 'chrome/a', state: 'passed', total: 2 }, scope('0:chrome%2Fa')))

    const [task] = buildTaskNodes(reducer, () => 0)
    expect(task.displayName).toBe('demo [model=m, repeat=1]')
    expect(task.projectId).toBe('demo')
    expect(task.caseTotal).toBe(2)
    expect(task.matrix).toEqual({ eval: {}, evalRowId: 'default', run: { model: 'm', repeat: '1' }, runRowId: 'model=m&repeat=1' })
    expect(task.cases).toHaveLength(1)
    expect(task.cases[0].state).toBe('passed')
    expect(task.cases[0].scores).toEqual({ unscored: {}, values: { 'osworld.success': 0.5 } })
    expect(task.cases[0].metricCount).toBe(1)
    expect(task.scoring.primary).toBe('osworld.success')
    expect(task.scoring.scores).toEqual([{ mean: 0.5, n: 1, name: 'osworld.success', sum: 0.5, total: 1, unscored: {} }])
    expect([...reducer.projects.keys()]).toEqual(['demo'])
  })

  /**
   * @example
   * case.started → case.requeued → case.started(requeueIndex 1) → case.ended: one round, tries [requeued, passed].
   */
  it('keeps a requeued case waiting in its round, then scores only its final run', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    reducer.apply(envelope('run.started', { totalTasks: 1 }))
    reducer.apply(envelope('task.started', {}, scope()))
    reducer.apply(envelope('case.started', { index: 0, name: 'a', requeue: 2, requeueIndex: 0, total: 1 }, scope('0:a')))
    reducer.apply(envelope('case.requeued', { delayMs: 30_000, errorMessage: 'Remote sent 429 response', errorName: 'APICallError', index: 0, name: 'a', requeue: 2, requeueIndex: 1, state: 'errored', total: 1 }, scope('0:a')))

    let [task] = buildTaskNodes(reducer, () => 0)
    expect(task.cases[0].state).toBe('requeued')
    expect(task.caseCounts).toMatchObject({ errored: 0, requeued: 1 })
    // A requeued round has not ended, so it does not count toward completion yet.
    expect(task.scoring.completion.total).toBe(0)
    expect(currentPosition(reducer, 0).waiting).toEqual([expect.objectContaining({ delayMs: 30_000, name: 'a', requeue: 2, requeueIndex: 1 })])
    expect(estimateProgress(reducer, 0).cases.completed).toBe(0)

    reducer.apply(envelope('case.started', { index: 0, name: 'a', requeue: 2, requeueIndex: 1, total: 1 }, scope('0:a')))
    reducer.apply(envelope('case.ended', { index: 0, name: 'a', state: 'passed', total: 1 }, scope('0:a')))

    ;[task] = buildTaskNodes(reducer, () => 0)
    const [round] = task.cases[0].rounds
    expect(task.cases[0].rounds).toHaveLength(1)
    expect(round.tries.map(entry => [entry.state, entry.requeueIndex])).toEqual([['requeued', 0], ['passed', 1]])
    // The error that requeued the case stays on its try; the passed run carries none.
    expect(round.tries[0]!.errorMessage).toBe('Remote sent 429 response')
    expect(round.errorMessage).toBeUndefined()
    expect(task.cases[0].state).toBe('passed')
    expect(task.scoring.passed.mean).toBe(1)
    expect(task.scoring.completion.mean).toBe(1)
    expect(estimateProgress(reducer, 0).cases.completed).toBe(1)
    expect(currentPosition(reducer, 0).waiting).toEqual([])
  })

  /**
   * @example
   * the run ends while a case waits to rerun -> the case is unfinished, a case without a result.
   */
  it('marks a case that was still waiting when the run ended as unfinished', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    reducer.apply(envelope('run.started', { totalTasks: 1 }))
    reducer.apply(envelope('case.started', { index: 0, name: 'a', requeue: 1, requeueIndex: 0, total: 1 }, scope('0:a')))
    reducer.apply(envelope('case.requeued', { delayMs: 0, index: 0, name: 'a', requeue: 1, requeueIndex: 1, state: 'timeout', total: 1 }, scope('0:a')))
    reducer.apply(envelope('run.ended', { failedTasks: 0, passedTasks: 0, skippedTasks: 0, totalTasks: 1 }))

    const [task] = buildTaskNodes(reducer, () => 0)
    expect(task.cases[0].state).toBe('unfinished')
    expect(task.caseCounts.errored).toBe(1)
  })

  /**
   * @example
   * expect(task.cases[0].errorName).toBe('APICallError')
   */
  it('keeps the state and the error name of a case without a result', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    reducer.apply(envelope('run.started', { totalTasks: 1 }))
    reducer.apply(envelope('task.started', {}, scope()))
    reducer.apply(envelope('case.started', { index: 0, name: 'a', total: 1 }, scope('0:a')))
    reducer.apply(envelope('case.ended', { errorMessage: 'Remote sent 429 response', errorName: 'APICallError', index: 0, name: 'a', state: 'errored', total: 1 }, scope('0:a')))

    const [task] = buildTaskNodes(reducer, () => 0)
    expect(task.cases[0].state).toBe('errored')
    expect(task.cases[0].errorName).toBe('APICallError')
    expect(task.cases[0].rounds[0]?.errorName).toBe('APICallError')
    expect(task.caseCounts.errored).toBe(1)
    expect(task.scoring.completion).toMatchObject({ mean: 0, n: 1, total: 1, unscored: { errored: 1 } })
  })

  /**
   * @example
   * expect(reducer.metricDefinitions.get('agent.steps')).toEqual({ better: 'lower', label: { en: 'Agent steps' }, name: 'agent.steps', unit: 'steps' })
   */
  it('keeps the latest metric definition per name and drops malformed text', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    reducer.apply(envelope('metric.defined', { label: 'Steps', name: 'agent.steps' }, scope()))
    reducer.apply(envelope('metric.defined', { better: 'lower', description: 42, label: { en: 'Agent steps', zh: 7 }, name: 'agent.steps', unit: 'steps' }, scope()))
    reducer.apply(envelope('artifact.recorded', { contentType: 'image/webp', label: { 'zh-Hans': '最终画面' }, name: 'final.webp', path: 'a/final.webp', size: 1 }, scope('0:chrome%2Fa')))

    expect(reducer.metricDefinitions.get('agent.steps')).toEqual({ better: 'lower', label: { en: 'Agent steps' }, name: 'agent.steps', unit: 'steps' })
    expect(reducer.cases.get(`${TASK}\u00000:chrome%2Fa`)?.artifacts[0]?.label).toEqual({ 'zh-Hans': '最终画面' })
  })

  // Event order observed in a real run with autoAttempt and autoRetry (design doc 1.5, `/tmp/vv-attempt-probe`):
  // the log carries no attemptIndex, so rounds are inferred from repeated `case.started` with retryIndex 0.
  it('infers auto attempt rounds and marks failed retries as retried', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    const started = (caseId: string, name: string, extra: object = {}) => reducer.apply(envelope('case.started', { index: 0, name, total: 2, ...extra }, scope(caseId)))
    const ended = (caseId: string, name: string, state: string) => reducer.apply(envelope('case.ended', { index: 0, name, state, total: 2 }, scope(caseId)))
    reducer.apply(envelope('run.started', { totalTasks: 1 }))
    started('0:flaky-attempt', 'flaky-attempt')
    started('1:flaky-retry', 'flaky-retry', { autoRetry: 1, retryIndex: 0 })
    started('1:flaky-retry', 'flaky-retry', { autoRetry: 1, retryIndex: 1 })
    ended('0:flaky-attempt', 'flaky-attempt', 'failed')
    ended('1:flaky-retry', 'flaky-retry', 'passed')
    started('0:flaky-attempt', 'flaky-attempt')
    started('1:flaky-retry', 'flaky-retry', { autoRetry: 1, retryIndex: 0 })
    ended('0:flaky-attempt', 'flaky-attempt', 'passed')
    ended('1:flaky-retry', 'flaky-retry', 'passed')

    const [task] = buildTaskNodes(reducer, () => 0)
    const [attempt, retry] = task.cases
    expect(task.roundCount).toBe(2)
    expect(attempt.rounds.map(round => [round.roundIndex, round.state, round.roundIndexInferred])).toEqual([[0, 'failed', true], [1, 'passed', true]])
    expect(attempt.state).toBe('passed')
    expect(retry.rounds[0].tries.map(entry => [entry.retryIndex, entry.state])).toEqual([[0, 'retried'], [1, 'passed']])
    expect(retry.rounds[1].tries.map(entry => [entry.retryIndex, entry.state])).toEqual([[0, 'passed']])
    // The passed share counts each case once by its last round: both cases end passed.
    expect(task.scoring.passed).toMatchObject({ mean: 1, n: 2 })
    expect(estimateProgress(reducer, Date.UTC(2026, 0, 1, 0, 1)).lowerBound).toBe(true)
  })

  // ROOT CAUSE:
  //
  // Plugins may emit events with any name. Counts were kept in a plain object, so a name that is also an
  // `Object.prototype` member started from that member instead of from 0:
  //
  // eventCounts[envelope.event] = (eventCounts[envelope.event] ?? 0) + 1   // 'constructor' → 'function Object() { [native code] }1'
  //
  // We fixed this by counting in an object without a prototype.
  /**
   * @example
   * expect(reducer.eventCounts.constructor).toBe(2)
   */
  it('counts events whose names are Object.prototype members', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    reducer.apply(envelope('constructor', {}))
    reducer.apply(envelope('constructor', {}))
    reducer.apply(envelope('toString', {}))

    expect(reducer.eventCounts.constructor).toBe(2)
    expect(reducer.eventCounts.toString).toBe(1)
  })

  it('uses attemptIndex from the log when present', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    reducer.apply(envelope('case.started', { attemptIndex: 0, autoAttempt: 2, index: 0, name: 'a', total: 1 }, scope('0:a')))
    reducer.apply(envelope('case.ended', { attemptIndex: 0, autoAttempt: 2, index: 0, name: 'a', state: 'failed', total: 1 }, scope('0:a')))
    reducer.apply(envelope('case.started', { attemptIndex: 1, autoAttempt: 2, index: 0, name: 'a', total: 1 }, scope('0:a')))

    const [task] = buildTaskNodes(reducer, () => 0)
    expect(task.autoAttemptMax).toBe(2)
    expect(task.cases[0].rounds.map(round => [round.roundIndex, round.roundIndexInferred, round.state])).toEqual([[0, false, 'failed'], [1, false, 'running']])
  })

  it('drops duplicate and foreign envelopes and counts seq gaps', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    const first = envelope('run.started', { totalTasks: 1 })
    const second = envelope('task.queued', { displayName: 'x' }, scope())
    envelope('task.started', {}, scope())
    const fourth = envelope('task.started', {}, scope())

    expect(reducer.apply(first)).toBe('applied')
    expect(reducer.apply(second)).toBe('applied')
    expect(reducer.apply(second)).toBe('duplicate')
    expect(reducer.apply(first)).toBe('duplicate')
    expect(reducer.apply({ ...fourth, runId: 'other-run' })).toBe('foreign')
    expect(reducer.apply(fourth)).toBe('applied')
    expect(reducer.seq()).toBe(4)
    expect(reducer.seqGaps()).toBe(1)
    expect(reducer.events).toHaveLength(3)
  })

  it('splits case output into log lines attached to the round', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    reducer.apply(envelope('case.started', { index: 0, name: 'a', total: 1 }, scope('0:a')))
    reducer.apply(envelope('case.output', { content: 'step 1\nstep 2\n', stream: 'stdout' }, scope('0:a')))
    reducer.apply(envelope('case.output', { content: 'warn', stream: 'stderr' }, scope('0:a')))

    expect(reducer.logs.map(line => [line.stream, line.text, line.roundIndex])).toEqual([['stdout', 'step 1', 0], ['stdout', 'step 2', 0], ['stderr', 'warn', 0]])
    expect(reducer.cases.get(`${TASK}\u00000:a`)?.logLineCount).toBe(3)
  })

  it('shows a task that vieval ended as passed but whose cases failed as failed', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    reducer.apply(envelope('run.started', { totalTasks: 1 }))
    reducer.apply(envelope('task.started', {}, scope()))
    reducer.apply(envelope('case.started', { index: 0, name: 'a', total: 2 }, scope('0:a')))
    reducer.apply(envelope('case.ended', { index: 0, name: 'a', state: 'passed', total: 2 }, scope('0:a')))
    reducer.apply(envelope('case.started', { index: 1, name: 'b', total: 2 }, scope('1:b')))
    reducer.apply(envelope('case.ended', { index: 1, name: 'b', state: 'failed', total: 2 }, scope('1:b')))
    // vieval's `task.ended` only reports whether the task threw.
    reducer.apply(envelope('task.ended', { state: 'passed' }, scope()))

    const [task] = buildTaskNodes(reducer, () => 0)
    expect(task.caseCounts).toMatchObject({ failed: 1, passed: 1 })
    expect(task.state).toBe('failed')
  })

  it('marks cases still running at the end of an interrupted run as unfinished', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    reducer.apply(envelope('run.started', { totalTasks: 1 }))
    reducer.apply(envelope('case.started', { index: 0, name: 'a', total: 1 }, scope('0:a')))
    reducer.apply(envelope('run.interrupted', { signal: 'SIGINT' }))

    const [task] = buildTaskNodes(reducer, () => 0)
    expect(task.state).toBe('unfinished')
    expect(task.cases[0].state).toBe('unfinished')
    expect(reducer.run().interruptSignal).toBe('SIGINT')
    expect(currentPosition(reducer, Date.now()).running).toEqual([])
  })
})

describe('estimateProgress', () => {
  it('estimates the ETA from throughput and extrapolates tasks that did not start', () => {
    const start = Date.UTC(2026, 0, 1, 0, 0, 0)
    const at = (seconds: number) => new Date(start + seconds * 1000).toISOString()
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    reducer.apply(envelope('run.started', { totalTasks: 2 }, {}, at(0)))
    for (let index = 0; index < 4; index += 1) {
      reducer.apply(envelope('case.started', { index, name: `c${index}`, total: 10 }, scope(`${index}:c${index}`), at(index * 10)))
    }
    reducer.apply(envelope('case.ended', { index: 0, name: 'c0', state: 'passed', total: 10 }, scope('0:c0'), at(50)))
    reducer.apply(envelope('case.ended', { index: 1, name: 'c1', state: 'failed', total: 10 }, scope('1:c1'), at(60)))

    const progress = estimateProgress(reducer, start + 100_000)
    expect(progress.basis).toBe('cases+task-extrapolation')
    expect(progress.cases).toEqual({ completed: 2, estimatedTotal: 20, knownTotal: 10, running: 2, waiting: 0 })
    expect(progress.elapsedMs).toBe(100_000)
    // 100 s for 2 cases → 50 s per case × 20 cases.
    expect(progress.estimatedTotalMs).toBe(1_000_000)
    expect(progress.etaMs).toBe(900_000)
    expect(progress.ratio).toBe(0.1)
    expect(progress.lowerBound).toBe(false)
    expect(currentPosition(reducer, start + 100_000).running.map(entry => [entry.name, entry.elapsedMs])).toEqual([['c2', 80_000], ['c3', 70_000]])
  })

  it('keeps the ETA at least as long as the longest running case has run', () => {
    const start = Date.UTC(2026, 0, 1, 0, 0, 0)
    const at = (milliseconds: number) => new Date(start + milliseconds).toISOString()
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    reducer.apply(envelope('run.started', { totalTasks: 1 }, {}, at(0)))
    reducer.apply(envelope('case.started', { index: 0, name: 'slow', total: 21 }, scope('0:slow'), at(0)))
    for (let index = 1; index <= 20; index += 1) {
      reducer.apply(envelope('case.started', { index, name: `fast${index}`, total: 21 }, scope(`${index}:fast${index}`), at(index * 10)))
      reducer.apply(envelope('case.ended', { index, name: `fast${index}`, state: 'passed', total: 21 }, scope(`${index}:fast${index}`), at(index * 10 + 5)))
    }

    // Throughput: 9 s for 20 cases → 0.45 s per case, 0.45 s left. The slow case has run 9 s.
    const progress = estimateProgress(reducer, start + 9000)
    expect(progress.etaMs).toBe(9000)
    expect(progress.estimatedTotalMs).toBe(18_000)
  })

  /**
   * @example
   * expect(history.length).toBeLessThanOrEqual(240)
   */
  it('downsamples the completed-cases history of a long run to at most 240 points', () => {
    const start = Date.UTC(2026, 0, 1, 0, 0, 0)
    const at = (seconds: number) => new Date(start + seconds * 1000).toISOString()
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    reducer.apply(envelope('run.started', { totalTasks: 1 }, {}, at(0)))
    for (let index = 0; index < 1000; index += 1) {
      reducer.apply(envelope('case.started', { index, name: `c${index}`, total: 2000 }, scope(`${index}:c${index}`), at(index)))
      reducer.apply(envelope('case.ended', { index, name: `c${index}`, state: 'passed', total: 2000 }, scope(`${index}:c${index}`), at(index + 0.5)))
    }

    const { cases, history } = estimateProgress(reducer, start + 1_200_000)
    expect(cases.completed).toBe(1000)
    expect(history.length).toBeLessThanOrEqual(240)
    expect(history[0]).toEqual({ completed: 0, elapsedMs: 0 })
    expect(history.at(-1)).toEqual({ completed: 1000, elapsedMs: 1_200_000 })
    for (let index = 1; index < history.length; index += 1) {
      expect(history[index].completed).toBeGreaterThanOrEqual(history[index - 1].completed)
      expect(history[index].elapsedMs).toBeGreaterThanOrEqual(history[index - 1].elapsedMs)
    }
  })

  /**
   * @example
   * expect(history.map(point => point.completed)).toEqual([0, 1, 0, 1, 1])
   */
  it('counts a settled round that starts again as not completed in the history', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    reducer.apply(envelope('run.started', { totalTasks: 1 }))
    reducer.apply(envelope('case.started', { attemptIndex: 0, index: 0, name: 'a', total: 1 }, scope('0:a')))
    reducer.apply(envelope('case.ended', { attemptIndex: 0, index: 0, name: 'a', state: 'failed', total: 1 }, scope('0:a')))
    // The same `attemptIndex` started again: the round runs again and is no longer completed.
    reducer.apply(envelope('case.started', { attemptIndex: 0, index: 0, name: 'a', total: 1 }, scope('0:a')))
    reducer.apply(envelope('case.ended', { attemptIndex: 0, index: 0, name: 'a', state: 'passed', total: 1 }, scope('0:a')))

    const { cases, history } = estimateProgress(reducer, Date.UTC(2026, 0, 1, 0, 1, 0))
    expect(cases.completed).toBe(1)
    expect(history.map(point => point.completed)).toEqual([0, 1, 0, 1, 1])
  })

  it('reports an unknown basis before the first case ended', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    reducer.apply(envelope('run.started', { totalTasks: 1 }))
    expect(estimateProgress(reducer, Date.now()).basis).toBe('unknown')
    expect(estimateProgress(reducer, Date.now()).etaMs).toBeUndefined()
  })
})

describe('axisValues', () => {
  /**
   * @example
   * expect(axisValues(rows)).toEqual({ model: ['gpt-5.5'], repeat: ['1', '2', '10'] })
   */
  it('collects distinct values per axis in natural order', () => {
    const rows = [{ model: 'gpt-5.5', repeat: '10' }, { model: 'gpt-5.5', repeat: '2' }, { model: 'gpt-5.5', repeat: '1' }, { model: 'gpt-5.5', repeat: '2' }]
    expect(axisValues(rows)).toEqual({ model: ['gpt-5.5'], repeat: ['1', '2', '10'] })
    expect(axisValues([])).toEqual({})
  })
})

describe('named scores', () => {
  const CORRECT = { description: { en: 'Matches the reference.' }, label: { 'en': 'Correct', 'zh-Hans': '正确' }, name: 'formula.correct' }
  const PASS = { combine: { inputs: [{ name: 'formula.correct' }], kind: 'all' as const }, name: 'formula.pass', primary: true }

  /**
   * @example
   * expect(reducer.scoreDefinitions.get('formula.correct')?.label).toEqual({ en: 'Correct answer' })
   */
  it('keeps the latest definition per name, in the order the task first announced them', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    reducer.apply(envelope('score.defined', CORRECT, scope()))
    reducer.apply(envelope('score.defined', PASS, scope()))
    reducer.apply(envelope('score.defined', { ...CORRECT, label: { en: 'Correct answer' } }, scope()))
    reducer.apply(envelope('score.defined', { name: 42 }, scope()))

    expect(reducer.scoreDefinitions.get('formula.correct')?.label).toEqual({ en: 'Correct answer' })
    expect([...reducer.tasks.get(TASK)!.scoreDefinitions.keys()]).toEqual(['formula.correct', 'formula.pass'])
    const [task] = buildTaskNodes(reducer, () => 0)
    // A declared score is known, with its primary flag, before any case records it.
    expect(task.scoring.primary).toBe('formula.pass')
    expect(task.scoring.scores.map(score => score.name)).toEqual(['formula.correct', 'formula.pass'])
  })

  /**
   * @example
   * expect(round.scores).toEqual({ unscored: { 'formula.natural': 'grader_failed' }, values: { 'formula.correct': 1 } })
   */
  it('keeps the last record per name of the last try of a round, and every record for the case detail', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    const caseScope = scope('0:a')
    reducer.apply(envelope('case.started', { autoRetry: 1, index: 0, name: 'a', retryIndex: 0, total: 1 }, caseScope))
    reducer.apply(envelope('score.recorded', { name: 'formula.correct', value: 0 }, caseScope))
    reducer.apply(envelope('case.started', { autoRetry: 1, index: 0, name: 'a', retryIndex: 1, total: 1 }, caseScope))
    reducer.apply(envelope('score.recorded', { name: 'formula.natural', value: 0.5 }, caseScope))
    reducer.apply(envelope('score.recorded', { name: 'formula.natural', rationale: 'no verdict', unscored: { reason: 'grader_failed' } }, caseScope))
    reducer.apply(envelope('score.recorded', { grader: { id: 'listener', kind: 'model', model: 'm' }, name: 'formula.correct', value: 1 }, caseScope))
    reducer.apply(envelope('score.recorded', { name: 'formula.broken', value: 'high' }, caseScope))
    reducer.apply(envelope('case.ended', { index: 0, name: 'a', state: 'passed', total: 1 }, caseScope))

    const [task] = buildTaskNodes(reducer, () => 0)
    const [round] = task.cases[0].rounds
    // The failed try's value is gone: the round's scores are those of its last try.
    expect(round.scores).toEqual({ unscored: { 'formula.natural': 'grader_failed' }, values: { 'formula.correct': 1 } })
    expect(task.cases[0].scores).toEqual(round.scores)
    const records = reducer.cases.get(`${TASK}\u00000:a`)!.scoreRecords
    expect(records.map(entry => [entry.seq, entry.roundIndex, entry.record.name])).toEqual([
      [2, 0, 'formula.correct'],
      [4, 0, 'formula.natural'],
      [5, 0, 'formula.natural'],
      [6, 0, 'formula.correct'],
    ])
    expect(records[2].record).toEqual({ name: 'formula.natural', rationale: 'no verdict', unscored: { reason: 'grader_failed' } })
    expect(records[3].record).toMatchObject({ grader: { id: 'listener', kind: 'model', model: 'm' } })
    expect(task.scoring.scores).toEqual([
      { mean: 1, n: 1, name: 'formula.correct', sum: 1, total: 1, unscored: {} },
      { mean: null, n: 0, name: 'formula.natural', sum: 0, total: 1, unscored: { grader_failed: 1 } },
    ])
  })

  /**
   * @example
   * expect(scoring.scores[0]).toMatchObject({ mean: 0.25, n: 4, total: 6 })
   */
  it('counts rounds with the rule of scoreCases: failed 0, errored excluded, unfinished as errored, running left out', () => {
    const rounds: Pick<CaseRound, 'scores' | 'state'>[] = [
      { scores: { unscored: {}, values: { s: 1 } }, state: 'passed' },
      { scores: { unscored: {}, values: { s: 1 } }, state: 'failed' },
      { scores: { unscored: {}, values: {} }, state: 'passed' },
      { scores: { unscored: { s: 'refusal' }, values: {} }, state: 'passed' },
      { scores: { unscored: {}, values: { s: 1 } }, state: 'errored' },
      { scores: { unscored: {}, values: {} }, state: 'unfinished' },
      { scores: { unscored: {}, values: { s: 1 } }, state: 'running' },
      { scores: { unscored: {}, values: { s: 1 } }, state: 'skipped' },
    ]
    const scoring = scoreRounds(rounds)
    // passed 1, failed 0; the passed round without a value and the unscored one do not count.
    expect(scoring.scores).toEqual([{ mean: 0.5, n: 2, name: 's', sum: 1, total: 6, unscored: { refusal: 1 } }])
    expect(scoring.completion).toMatchObject({ mean: 4 / 6, n: 6, total: 6, unscored: { errored: 2 } })
    expect(scoring.passed.mean).toBe(3 / 6)

    // `errors: 'zero'` counts the errored and the unfinished round as 0.
    const zero = scoreRounds(rounds, [{ errors: 'zero', name: 's' }])
    expect(zero.scores[0]).toMatchObject({ mean: 0.25, n: 4, sum: 1 })
  })

  /**
   * @example
   * expect(countedScores({ scores, state: 'failed' })).toEqual({ s: 0 })
   */
  it('returns the value one round counts with', () => {
    const scores = { unscored: { u: 'refusal' }, values: { s: 0.5 } }
    expect(countedScores({ scores, state: 'passed' })).toEqual({ s: 0.5 })
    expect(countedScores({ scores, state: 'failed' })).toEqual({ s: 0, u: 0 })
    expect(countedScores({ scores, state: 'errored' })).toEqual({})
    expect(countedScores({ scores, state: 'errored' }, [{ errors: 'zero', name: 's' }])).toEqual({ s: 0 })
  })

  /**
   * @example
   * expect(resolveTaskHeadline(tasks)?.headline.kind).toBe('per-task')
   */
  it('resolves the run headline over the tasks, by eval entry', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    const other = 'evals%2Fother::default::run=model%3Dm::eval=default'
    const otherScope = (caseId?: string) => ({ caseId, projectId: 'demo', taskId: other })
    reducer.apply(envelope('case.started', { index: 0, name: 'a', total: 1 }, scope('0:a')))
    expect(resolveTaskHeadline(buildTaskNodes(reducer, () => 0))).toBeNull()

    reducer.apply(envelope('score.recorded', { name: 'demo.score', value: 1 }, scope('0:a')))
    reducer.apply(envelope('case.ended', { index: 0, name: 'a', state: 'passed', total: 1 }, scope('0:a')))
    expect(resolveTaskHeadline(buildTaskNodes(reducer, () => 0))?.headline).toEqual({ kind: 'score', score: { mean: 1, n: 1, name: 'demo.score', sum: 1, total: 1, unscored: {} } })

    reducer.apply(envelope('case.started', { index: 0, name: 'b', total: 1 }, otherScope('0:b')))
    reducer.apply(envelope('score.recorded', { name: 'other.score', value: 0 }, otherScope('0:b')))
    reducer.apply(envelope('case.ended', { index: 0, name: 'b', state: 'passed', total: 1 }, otherScope('0:b')))
    const headline = resolveTaskHeadline(buildTaskNodes(reducer, () => 0))
    expect(headline?.completion).toMatchObject({ mean: 1, n: 2 })
    expect(headline?.headline.kind === 'per-task' ? headline.headline.tasks.map(entry => [entry.taskId, entry.score.name]) : []).toEqual([['evals/demo', 'demo.score'], ['evals/other', 'other.score']])
  })

  /**
   * @example
   * expect(resolveTaskHeadline(tasks)?.headline).toMatchObject({ kind: 'passed-cases' })
   */
  it('falls back to the passed share when no task records a score', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    reducer.apply(envelope('case.started', { index: 0, name: 'a', total: 2 }, scope('0:a')))
    reducer.apply(envelope('case.ended', { index: 0, name: 'a', state: 'passed', total: 2 }, scope('0:a')))
    reducer.apply(envelope('case.started', { index: 1, name: 'b', total: 2 }, scope('1:b')))
    reducer.apply(envelope('case.ended', { index: 1, name: 'b', state: 'failed', total: 2 }, scope('1:b')))
    expect(resolveTaskHeadline(buildTaskNodes(reducer, () => 0))?.headline).toEqual({ kind: 'passed-cases', score: { mean: 0.5, n: 2, name: 'passed', sum: 1, total: 2, unscored: {} } })
  })
})

describe('score graders', () => {
  /**
   * @example
   * definition grader judge-a; one record overrides with judge-b; a derived record is skipped ->
   * task.scoreGraders['formula.natural'] holds judge-a and judge-b once each.
   */
  it('lists each distinct grader of a score: the record\'s own, else the definition\'s', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    reducer.apply(envelope('score.defined', { grader: { id: 'judge', kind: 'model', model: 'judge-a' }, name: 'formula.natural' }, scope()))
    reducer.apply(envelope('score.defined', { combine: { inputs: [{ name: 'formula.natural' }], kind: 'all' }, name: 'formula.pass' }, scope()))
    for (const [index, grader] of [undefined, { id: 'judge', kind: 'model', model: 'judge-b' }, undefined].entries()) {
      const caseScope = scope(`${index}:c${index}`)
      reducer.apply(envelope('case.started', { index, name: `c${index}`, total: 3 }, caseScope))
      reducer.apply(envelope('score.recorded', { ...(grader == null ? {} : { grader }), name: 'formula.natural', value: 1 }, caseScope))
      reducer.apply(envelope('score.recorded', { derived: true, name: 'formula.pass', value: 1 }, caseScope))
      reducer.apply(envelope('case.ended', { index, name: `c${index}`, state: 'passed', total: 3 }, caseScope))
    }

    const [task] = buildTaskNodes(reducer, () => 0)
    expect(task.scoreGraders).toEqual({
      'formula.natural': [{ id: 'judge', kind: 'model', model: 'judge-a' }, { id: 'judge', kind: 'model', model: 'judge-b' }],
    })
  })
})

describe('parseTaskId', () => {
  /**
   * @example
   * expect(parseTaskId('custom')).toEqual({})
   */
  it('returns no matrix for ids that are not scheduled task ids', () => {
    expect(parseTaskId('custom')).toEqual({})
  })
})

describe('buildTaskNodes', () => {
  // ROOT CAUSE:
  //
  // A task with hundreds of thousands of cases spread the round of every case into one call, which exceeds the
  // engine's argument limit and failed every snapshot of the run:
  //
  // Math.max(0, ...allRounds.map(round => round.roundIndex + 1))   // RangeError: Maximum call stack size exceeded
  //
  // We fixed this by taking the maximum in a loop.
  /**
   * @example
   * expect(task.roundCount).toBe(1)
   */
  it('builds a task with hundreds of thousands of cases', () => {
    const envelope = createEnvelopeFactory()
    const reducer = createRunReducer()
    for (let index = 0; index < 200_000; index += 1) {
      reducer.apply(envelope('case.started', { index, name: `c${index}`, total: 200_000 }, scope(`${index}:c${index}`), '2026-01-01T00:00:00.000Z'))
    }

    const [task] = buildTaskNodes(reducer, () => 0)
    expect(task.cases).toHaveLength(200_000)
    expect(task.roundCount).toBe(1)
  })
})
