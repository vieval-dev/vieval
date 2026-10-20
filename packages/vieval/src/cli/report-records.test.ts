import type { ScoredCaseOutcome } from '../core/scoring'
import type { RunEventEnvelope, ScoreDefinedData } from '../events'
import type { CaseRecord } from './report-records'

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { scoreCases } from '../core/scoring'
import { buildCaseRecords, buildMetricsSummary, encodeJsonl, readCaseRecordFile, summarizeRecordScores } from './report-records'

let nextSeq = 0
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

/**
 * Creates the events of one settled case `caseId` of `task-1`: a start, the given score events, and an end.
 */
function caseEventsOf(caseId: string, state: string, scoreEvents: Array<Record<string, unknown>> = []): RunEventEnvelope[] {
  return [
    envelopeOf('case.started', { index: 0, name: caseId, total: 1 }, { caseId }),
    ...scoreEvents.map(data => envelopeOf('score.recorded', data, { caseId })),
    envelopeOf('case.ended', { index: 0, name: caseId, state, total: 1 }, { caseId }),
  ]
}

/**
 * Creates one task-scoped `score.defined` envelope of `task-1`.
 */
function definitionOf(data: ScoreDefinedData): RunEventEnvelope {
  return envelopeOf('score.defined', data, { caseId: undefined })
}

/**
 * Creates one schema 3 envelope for `case-1` of `task-1`; `overrides` replace envelope fields.
 */
function envelopeOf(event: string, data: unknown, overrides: Partial<Omit<RunEventEnvelope, 'data' | 'event'>> = {}): RunEventEnvelope {
  nextSeq += 1
  return {
    attemptId: 'attempt-1',
    caseId: 'case-1',
    data,
    event,
    experimentId: 'default',
    projectId: 'project-1',
    runId: 'run-1',
    schemaVersion: 3,
    seq: nextSeq,
    taskId: 'task-1',
    time: '2026-05-08T00:00:00.000Z',
    workspaceId: 'workspace-1',
    ...overrides,
  }
}

/**
 * Creates one current case record; `overrides` replace its fields.
 */
function recordOf(overrides: Partial<CaseRecord>): CaseRecord {
  return {
    attemptId: 'a',
    caseId: '1',
    caseName: '1',
    durationMs: 1,
    endedAt: 'e',
    experimentId: 'e',
    metrics: {},
    projectName: 'p',
    retryCount: 0,
    runId: 'r',
    schemaVersion: 2,
    scoreDetails: {},
    scores: {},
    startedAt: 's',
    state: 'passed',
    taskId: 't',
    unscored: {},
    workspaceId: 'w',
    ...overrides,
  }
}

/**
 * @example
 * describe('buildCaseRecords', () => {})
 */
describe('buildCaseRecords', () => {
  /**
   * @example
   * it('builds a case record with named scores, their details, and metrics', () => {})
   */
  it('builds a case record with named scores, their details, and metrics', () => {
    const records = buildCaseRecords({
      events: [
        envelopeOf('case.started', { index: 0, input: { prompt: 'When?' }, name: 'Case 1', retryIndex: 1, total: 1 }, { projectId: 'project-from-event', time: '2026-05-08T00:00:00.000Z' }),
        envelopeOf('metric.recorded', { name: 'benchmark.id', value: 'locomo' }),
        envelopeOf('score.recorded', { grader: { id: 'judge', kind: 'model', model: 'gpt-5.5' }, name: 'locomo.correct', rationale: 'The date matches.', value: 0.75 }),
        envelopeOf('case.ended', { index: 0, name: 'Case 1', output: { answer: 'May 8' }, state: 'passed', total: 1 }, { time: '2026-05-08T00:00:01.250Z' }),
      ],
      projectName: 'locomo-lobehub',
    })

    /**
     * @example
     * expect(records[0]).toMatchObject({ schemaVersion: 2, scores: { 'locomo.correct': 0.75 }, ... })
     */
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      attemptId: 'attempt-1',
      caseId: 'case-1',
      caseName: 'Case 1',
      durationMs: 1250,
      endedAt: '2026-05-08T00:00:01.250Z',
      experimentId: 'default',
      input: { prompt: 'When?' },
      metrics: { 'benchmark.id': 'locomo' },
      output: { answer: 'May 8' },
      projectName: 'project-from-event',
      retryCount: 1,
      runId: 'run-1',
      schemaVersion: 2,
      scores: { 'locomo.correct': 0.75 },
      startedAt: '2026-05-08T00:00:00.000Z',
      state: 'passed',
      taskId: 'task-1',
      unscored: {},
      workspaceId: 'workspace-1',
    })
    /**
     * @example
     * expect(records[0]?.scoreDetails).toEqual({ 'locomo.correct': { grader: {...}, rationale: 'The date matches.' } })
     */
    expect(records[0]?.scoreDetails).toEqual({
      'locomo.correct': { grader: { id: 'judge', kind: 'model', model: 'gpt-5.5' }, rationale: 'The date matches.' },
    })
  })

  /**
   * @example
   * it('counts every case state with the scoring rule of scoreCases', () => {})
   */
  it('counts every case state with the scoring rule of scoreCases', () => {
    // ROOT CAUSE:
    //
    // `cases.jsonl` used its own rule, `scores.exact ??= passed ? 1 : 0`, so a failed case kept a value it recorded
    // before the assertion failed, while `run-summary.json` counted it as 0. The two files disagreed.
    //
    // We fixed this by counting records with the state rule of `scoreCases` over the task's score names.
    const records = buildCaseRecords({
      events: [
        definitionOf({ name: 'correct' }),
        definitionOf({ errors: 'zero', name: 'answered' }),
        ...caseEventsOf('passed', 'passed', [{ name: 'correct', value: 1 }, { name: 'answered', value: 1 }]),
        ...caseEventsOf('passed-missing', 'passed', [{ name: 'answered', value: 1 }]),
        ...caseEventsOf('passed-unscored', 'passed', [{ name: 'correct', unscored: { reason: 'grader_failed' } }, { name: 'answered', value: 1 }]),
        ...caseEventsOf('failed', 'failed', [{ name: 'correct', value: 1 }]),
        ...caseEventsOf('errored', 'errored'),
        ...caseEventsOf('timeout', 'timeout'),
        ...caseEventsOf('skipped', 'skipped'),
      ],
      projectName: 'project-1',
    })
    const byName = Object.fromEntries(records.map(record => [record.caseName, record]))

    /**
     * @example
     * expect(byName.failed?.scores).toEqual({ answered: 0, correct: 0 })
     */
    expect(byName.passed?.scores).toEqual({ answered: 1, correct: 1 })
    expect(byName['passed-missing']?.scores).toEqual({ answered: 1 })
    expect(byName['passed-unscored']?.scores).toEqual({ answered: 1 })
    expect(byName['passed-unscored']?.unscored).toEqual({ correct: 'grader_failed' })
    expect(byName.failed?.scores).toEqual({ answered: 0, correct: 0 })
    expect(byName.errored?.scores).toEqual({ answered: 0 })
    expect(byName.timeout?.scores).toEqual({ answered: 0 })
    expect(byName.skipped?.scores).toEqual({})

    const outcomes: ScoredCaseOutcome[] = [
      { scores: { answered: 1, correct: 1 }, state: 'passed', unscored: {} },
      { scores: { answered: 1 }, state: 'passed', unscored: {} },
      { scores: { answered: 1 }, state: 'passed', unscored: { correct: 'grader_failed' } },
      { scores: { correct: 1 }, state: 'failed', unscored: {} },
      { scores: {}, state: 'errored', unscored: {} },
      { scores: {}, state: 'timeout', unscored: {} },
      { scores: {}, state: 'skipped', unscored: {} },
    ]
    const expected = scoreCases(outcomes, [{ name: 'correct' }, { errors: 'zero', name: 'answered' }]).scores
    /**
     * @example
     * expect(summarizeRecordScores(records)).toEqual({ answered: <scoreCases summary>, correct: <scoreCases summary> })
     */
    expect(summarizeRecordScores(records)).toEqual(Object.fromEntries(expected.map(summary => [summary.name, summary])))
  })

  /**
   * @example
   * it('keeps the last of a value and an unscored record of one name', () => {})
   */
  it('keeps the last of a value and an unscored record of one name', () => {
    const records = buildCaseRecords({
      events: [
        ...caseEventsOf('rescored', 'passed', [{ name: 'natural', unscored: { reason: 'invalid_response' } }, { name: 'natural', value: 0.5 }]),
        ...caseEventsOf('unscored', 'passed', [{ name: 'natural', rationale: 'first try', value: 1 }, { name: 'natural', unscored: { reason: 'refusal' } }]),
      ],
      projectName: 'project-1',
    })
    const byName = Object.fromEntries(records.map(record => [record.caseName, record]))

    /**
     * @example
     * expect(byName.unscored?.unscored).toEqual({ natural: 'refusal' })
     */
    expect(byName.rescored?.scores).toEqual({ natural: 0.5 })
    expect(byName.rescored?.unscored).toEqual({})
    expect(byName.unscored?.scores).toEqual({})
    expect(byName.unscored?.unscored).toEqual({ natural: 'refusal' })
    expect(byName.unscored?.scoreDetails).toEqual({})
  })

  /**
   * @example
   * it('marks derived scores in their details', () => {})
   */
  it('marks derived scores in their details', () => {
    const records = buildCaseRecords({
      events: caseEventsOf('case', 'passed', [{ name: 'correct', value: 1 }, { derived: true, name: 'pass', value: 1 }]),
      projectName: 'project-1',
    })

    /**
     * @example
     * expect(records[0]?.scoreDetails).toEqual({ pass: { derived: true } })
     */
    expect(records[0]?.scoreDetails).toEqual({ pass: { derived: true } })
  })

  /**
   * @example
   * it('uses the fallback project name and ignores invalid durations', () => {})
   */
  it('uses the fallback project name and ignores invalid durations', () => {
    const records = buildCaseRecords({
      events: [
        envelopeOf('case.started', { index: 0, name: 'case', total: 1 }, { projectId: undefined, time: 'not-a-date' }),
        envelopeOf('case.ended', { index: 0, name: 'case', state: 'failed', total: 1 }, { projectId: undefined, time: '2026-05-08T00:00:01.000Z' }),
      ],
      projectName: 'project-fallback',
    })

    /**
     * @example
     * expect(records[0]?.durationMs).toBe(0)
     */
    expect(records[0]?.projectName).toBe('project-fallback')
    expect(records[0]?.startedAt).toBe('not-a-date')
    expect(records[0]?.endedAt).toBe('2026-05-08T00:00:01.000Z')
    expect(records[0]?.durationMs).toBe(0)
    expect(records[0]?.state).toBe('failed')
  })

  /**
   * @example
   * it('skips events whose payload does not match the event schema', () => {})
   */
  it('skips events whose payload does not match the event schema', () => {
    const records = buildCaseRecords({
      events: [
        envelopeOf('case.started', { index: 0, name: 'case', total: 1 }),
        envelopeOf('case.ended', { name: 'case' }),
      ],
      projectName: 'project-1',
    })

    /**
     * @example
     * expect(records).toEqual([])
     */
    expect(records).toEqual([])
  })

  /**
   * @example
   * it('keeps only the final retry payload while preserving full case duration', () => {})
   */
  it('keeps only the final retry payload while preserving full case duration', () => {
    const records = buildCaseRecords({
      events: [
        envelopeOf('case.started', { autoRetry: 1, index: 0, name: 'case', retryIndex: 0, total: 1 }, { time: '2026-05-08T00:00:00.000Z' }),
        envelopeOf('score.recorded', { name: 'correct', value: 0.2 }),
        envelopeOf('metric.recorded', { name: 'attempt.metric', value: 'failed-attempt' }),
        envelopeOf('case.started', { autoRetry: 1, index: 0, name: 'case', retryIndex: 1, total: 1 }, { time: '2026-05-08T00:00:03.000Z' }),
        envelopeOf('metric.recorded', { name: 'attempt.metric', value: 'final-attempt' }),
        envelopeOf('case.ended', { index: 0, name: 'case', state: 'passed', total: 1 }, { time: '2026-05-08T00:00:05.000Z' }),
      ],
      projectName: 'project-1',
    })

    /**
     * @example
     * expect(records[0]?.scores).toEqual({})
     */
    expect(records).toHaveLength(1)
    expect(records[0]?.startedAt).toBe('2026-05-08T00:00:00.000Z')
    expect(records[0]?.endedAt).toBe('2026-05-08T00:00:05.000Z')
    expect(records[0]?.durationMs).toBe(5000)
    expect(records[0]?.retryCount).toBe(1)
    // The final try recorded no score, and a passed case without a value has no score.
    expect(records[0]?.scores).toEqual({})
    expect(records[0]?.metrics).toEqual({ 'attempt.metric': 'final-attempt' })
  })

  /**
   * @example
   * it('keeps every auto attempt of a case with counted scores and counts only in-attempt retries', () => {})
   */
  it('keeps every auto attempt of a case with counted scores and counts only in-attempt retries', () => {
    const records = buildCaseRecords({
      events: [
        envelopeOf('case.started', { attemptIndex: 0, autoAttempt: 1, autoRetry: 1, index: 0, name: 'Case 1', retryIndex: 0, total: 1 }, { time: '2026-05-08T00:00:00.000Z' }),
        envelopeOf('case.started', { attemptIndex: 0, autoAttempt: 1, autoRetry: 1, index: 0, name: 'Case 1', retryIndex: 1, total: 1 }, { time: '2026-05-08T00:00:01.000Z' }),
        envelopeOf('score.recorded', { name: 'correct', value: 1 }),
        envelopeOf('case.ended', { attemptIndex: 0, autoAttempt: 1, errorMessage: 'boom', index: 0, name: 'Case 1', state: 'failed', total: 1 }, { time: '2026-05-08T00:00:02.000Z' }),
        envelopeOf('case.started', { attemptIndex: 1, autoAttempt: 1, autoRetry: 1, index: 0, name: 'Case 1', retryIndex: 0, total: 1 }, { time: '2026-05-08T00:00:03.000Z' }),
        envelopeOf('score.recorded', { name: 'correct', value: 0.5 }),
        envelopeOf('score.recorded', { name: 'natural', unscored: { reason: 'no_response' } }),
        envelopeOf('case.ended', { attemptIndex: 1, autoAttempt: 1, index: 0, name: 'Case 1', state: 'passed', total: 1 }, { time: '2026-05-08T00:00:03.500Z' }),
      ],
      projectName: 'project-1',
    })

    /**
     * @example
     * expect(records[0]?.attempts?.[0]?.scores).toEqual({ correct: 0, natural: 0 })
     */
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      attemptId: 'attempt-1',
      attemptIndex: 1,
      autoAttempt: 1,
      durationMs: 3500,
      retryCount: 0,
      scores: { correct: 0.5 },
      state: 'passed',
      unscored: { natural: 'no_response' },
    })
    expect(records[0]?.attempts).toEqual([
      {
        attemptIndex: 0,
        durationMs: 2000,
        endedAt: '2026-05-08T00:00:02.000Z',
        errorMessage: 'boom',
        retryCount: 1,
        // The failed attempt scores 0 on every score of the task, including `natural` from the later attempt.
        scores: { correct: 0, natural: 0 },
        startedAt: '2026-05-08T00:00:00.000Z',
        state: 'failed',
        unscored: {},
      },
      {
        attemptIndex: 1,
        durationMs: 500,
        endedAt: '2026-05-08T00:00:03.500Z',
        retryCount: 0,
        scores: { correct: 0.5 },
        startedAt: '2026-05-08T00:00:03.000Z',
        state: 'passed',
        unscored: { natural: 'no_response' },
      },
    ])
  })

  /**
   * @example
   * it('omits auto attempt fields for logs without attemptIndex', () => {})
   */
  it('omits auto attempt fields for logs without attemptIndex', () => {
    const records = buildCaseRecords({
      events: [
        envelopeOf('case.started', { index: 0, name: 'Case 1', total: 1 }),
        envelopeOf('case.ended', { index: 0, name: 'Case 1', state: 'passed', total: 1 }),
      ],
      projectName: 'project-1',
    })

    /**
     * @example
     * expect(Object.keys(records[0]!).sort()).toEqual(['attemptId', ..., 'workspaceId'])
     */
    expect(Object.keys(records[0]!).sort()).toEqual([
      'attemptId',
      'caseId',
      'caseName',
      'durationMs',
      'endedAt',
      'experimentId',
      'metrics',
      'projectName',
      'retryCount',
      'runId',
      'schemaVersion',
      'scoreDetails',
      'scores',
      'startedAt',
      'state',
      'taskId',
      'unscored',
      'workspaceId',
    ])
  })
})

/**
 * @example
 * describe('buildMetricsSummary', () => {})
 */
describe('buildMetricsSummary', () => {
  /**
   * @example
   * it('summarizes scores by name overall and per metric group', () => {})
   */
  it('summarizes scores by name overall and per metric group', () => {
    const summary = buildMetricsSummary([
      recordOf({ caseId: '1', metrics: { 'benchmark.category': 2 }, scores: { correct: 1, natural: 0.5 } }),
      recordOf({ caseId: '2', metrics: { 'benchmark.category': 2 }, scores: { correct: 0 }, unscored: { natural: 'grader_failed' } }),
      recordOf({ caseId: '3', metrics: { 'benchmark.category': 3 }, scores: { correct: 0.5, natural: 1 } }),
      recordOf({ caseId: '4', metrics: { nullable: null }, scores: {}, state: 'errored' }),
      recordOf({ caseId: '5', scores: { other: 1 }, taskId: 'other-task' }),
    ], ['benchmark.category', 'taskId', 'nullable'])

    /**
     * @example
     * expect(summary.overall.correct).toEqual({ mean: 0.5, n: 3, name: 'correct', sum: 1.5, total: 4, unscored: {} })
     */
    expect(summary.overall.correct).toEqual({ mean: 0.5, n: 3, name: 'correct', sum: 1.5, total: 4, unscored: {} })
    expect(summary.overall.natural).toEqual({ mean: 0.75, n: 2, name: 'natural', sum: 1.5, total: 4, unscored: { grader_failed: 1 } })
    // A record of another task does not count toward `total` of this task's scores, and the reverse.
    expect(summary.overall.other).toEqual({ mean: 1, n: 1, name: 'other', sum: 1, total: 1, unscored: {} })
    expect(summary.groups['benchmark.category=2']?.correct?.mean).toBe(0.5)
    expect(summary.groups['benchmark.category=3']?.correct?.mean).toBe(0.5)
    expect(summary.groups['taskId=t']?.correct?.mean).toBe(0.5)
    expect(summary.groups['nullable=null']?.correct).toBeUndefined()
  })
})

/**
 * @example
 * describe('readCaseRecordFile', () => {})
 */
describe('readCaseRecordFile', () => {
  /**
   * @example
   * it('reads current records and rejects records of an older vieval', async () => {})
   */
  it('reads current records and rejects records of an older vieval', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vieval-case-records-'))
    temporaryDirectories.push(directory)
    const currentPath = join(directory, 'current.jsonl')
    const olderPath = join(directory, 'older.jsonl')
    await writeFile(currentPath, encodeJsonl([recordOf({ caseId: '1' })]), 'utf-8')
    await writeFile(olderPath, `${JSON.stringify({ ...recordOf({ caseId: '1' }), schemaVersion: 1, scores: { exact: 1 } })}\n`, 'utf-8')

    /**
     * @example
     * expect(() => readCaseRecordFile(olderPath)).toThrow('This report was written by an older vieval. Run it again.')
     */
    expect(readCaseRecordFile(currentPath).map(record => record.caseId)).toEqual(['1'])
    expect(() => readCaseRecordFile(olderPath)).toThrow('This report was written by an older vieval. Run it again.')
  })
})

/**
 * @example
 * describe('encodeJsonl', () => {})
 */
describe('encodeJsonl', () => {
  /**
   * @example
   * it('encodes case records as newline-delimited JSON', () => {})
   */
  it('encodes case records as newline-delimited JSON', () => {
    const jsonl = encodeJsonl([
      recordOf({ caseId: '1' }),
      recordOf({ caseId: '2', state: 'failed' }),
    ])

    /**
     * @example
     * expect(jsonl.split('\n')).toHaveLength(3)
     */
    expect(jsonl.endsWith('\n')).toBe(true)
    expect(jsonl.split('\n')).toHaveLength(3)
    expect(jsonl.trim()).toContain('"caseId":"1"')
    expect(jsonl.trim()).toContain('"caseId":"2"')
  })

  /**
   * @example
   * it('encodes empty case records as an empty string', () => {})
   */
  it('encodes empty case records as an empty string', () => {
    /**
     * @example
     * expect(encodeJsonl([])).toBe('')
     */
    expect(encodeJsonl([])).toBe('')
  })
})
