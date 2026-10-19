import { describe, expect, it } from 'vitest'

import { createEnvelopeFactory } from '../../test/helpers'
import { axisValues, buildTaskNodes, createRunReducer, currentPosition, estimateProgress, parseTaskId, scoreRounds } from './reduce'

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
    reducer.apply(envelope('score.recorded', { kind: 'exact', score: 0.5 }, scope('0:chrome%2Fa')))
    reducer.apply(envelope('case.ended', { index: 0, name: 'chrome/a', state: 'passed', total: 2 }, scope('0:chrome%2Fa')))

    const [task] = buildTaskNodes(reducer, () => 0)
    expect(task.displayName).toBe('demo [model=m, repeat=1]')
    expect(task.projectId).toBe('demo')
    expect(task.caseTotal).toBe(2)
    expect(task.matrix).toEqual({ eval: {}, evalRowId: 'default', run: { model: 'm', repeat: '1' }, runRowId: 'model=m&repeat=1' })
    expect(task.cases).toHaveLength(1)
    expect(task.cases[0].state).toBe('passed')
    expect(task.cases[0].scores).toEqual({ exact: 0.5 })
    expect(task.cases[0].metricCount).toBe(1)
    expect(task.scores.exact).toBe(0.5)
    expect([...reducer.projects.keys()]).toEqual(['demo'])
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
    // describeTask averages every round: failed (0) + passed (1) + passed (1) + passed (1).
    expect(task.scores.exact).toBe(0.75)
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
    expect(progress.cases).toEqual({ completed: 2, estimatedTotal: 20, knownTotal: 10, running: 2 })
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

describe('scoreRounds / parseTaskId', () => {
  it('follows scoreCaseOutcomes: failed → 0, passed without score → 1, judge averaged separately', () => {
    expect(scoreRounds([
      { scores: {}, state: 'failed' },
      { scores: {}, state: 'passed' },
      { scores: { exact: 0.5, judge: 0.8 }, state: 'passed' },
      { scores: {}, state: 'running' },
    ])).toEqual({ coverage: { measured: 3, total: 3 }, exact: 0.5, hybrid: 0.65, judge: 0.8, strictExact: 0.5 })
  })

  /**
   * @example
   * errored and unfinished rounds stay out of exact and lower the coverage, as in the run summary of vieval.
   */
  it('leaves rounds without a result out of exact and counts them in coverage', () => {
    const scores = scoreRounds([
      { scores: {}, state: 'passed' },
      { scores: {}, state: 'errored' },
      { scores: {}, state: 'timeout' },
      { scores: {}, state: 'unfinished' },
    ])

    expect(scores.exact).toBe(1)
    expect(scores.coverage).toEqual({ measured: 1, total: 4 })
    expect(scores.strictExact).toBe(0.25)
  })

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
