import type { RunEventEnvelope } from '../events'

import { describe, expect, it } from 'vitest'

import { buildCaseRecords, buildMetricsSummary, encodeJsonl } from './report-records'

let nextSeq = 0

/**
 * Creates one schema 2 envelope for `case-1` of `task-1`; `overrides` replace envelope fields.
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
    schemaVersion: 2,
    seq: nextSeq,
    taskId: 'task-1',
    time: '2026-05-08T00:00:00.000Z',
    workspaceId: 'workspace-1',
    ...overrides,
  }
}

/**
 * @example
 * describe('report records') verifies lifecycle events become inspectable case artifacts.
 */
describe('report records', () => {
  /**
   * @example
   * it('builds a case record from case lifecycle, score, and metric events') checks the minimum report inspect contract.
   */
  it('builds a case record from case lifecycle, score, and metric events', () => {
    const records = buildCaseRecords({
      events: [
        envelopeOf('case.started', { index: 0, input: { prompt: 'When?' }, name: 'Case 1', retryIndex: 1, total: 1 }, { projectId: 'project-from-event', time: '2026-05-08T00:00:00.000Z' }),
        envelopeOf('metric.recorded', { name: 'benchmark.id', value: 'locomo' }),
        envelopeOf('score.recorded', { kind: 'exact', score: 0.75 }),
        envelopeOf('case.ended', { index: 0, name: 'Case 1', output: { answer: 'May 8' }, state: 'passed', total: 1 }, { time: '2026-05-08T00:00:01.250Z' }),
      ],
      projectName: 'locomo-lobehub',
    })

    /**
     * @example
     * expect(records[0]).toMatchObject({ caseName: 'Case 1', durationMs: 1250, ... })
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
      schemaVersion: 1,
      scores: { exact: 0.75 },
      startedAt: '2026-05-08T00:00:00.000Z',
      state: 'passed',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
    })
  })

  /**
   * @example
   * it('uses the fallback project name and ignores invalid durations') covers events from custom project executors.
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
   * it('skips events whose payload does not match the event schema') keeps one malformed line from breaking a report.
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
   * it('keeps only the final retry attempt payload while preserving full case duration') verifies retry event ordering.
   */
  it('keeps only the final retry attempt payload while preserving full case duration', () => {
    const records = buildCaseRecords({
      events: [
        envelopeOf('case.started', { autoRetry: 1, index: 0, name: 'case', retryIndex: 0, total: 1 }, { time: '2026-05-08T00:00:00.000Z' }),
        envelopeOf('score.recorded', { kind: 'exact', score: 0.2 }),
        envelopeOf('metric.recorded', { name: 'attempt.metric', value: 'failed-attempt' }),
        envelopeOf('case.started', { autoRetry: 1, index: 0, name: 'case', retryIndex: 1, total: 1 }, { time: '2026-05-08T00:00:03.000Z' }),
        envelopeOf('metric.recorded', { name: 'attempt.metric', value: 'final-attempt' }),
        envelopeOf('case.ended', { index: 0, name: 'case', state: 'passed', total: 1 }, { time: '2026-05-08T00:00:05.000Z' }),
      ],
      projectName: 'project-1',
    })

    /**
     * @example
     * expect(records[0]?.metrics).toEqual({ 'attempt.metric': 'final-attempt' })
     */
    expect(records).toHaveLength(1)
    expect(records[0]?.startedAt).toBe('2026-05-08T00:00:00.000Z')
    expect(records[0]?.endedAt).toBe('2026-05-08T00:00:05.000Z')
    expect(records[0]?.durationMs).toBe(5000)
    expect(records[0]?.retryCount).toBe(1)
    expect(records[0]?.scores).toEqual({ exact: 1 })
    expect(records[0]?.metrics).toEqual({ 'attempt.metric': 'final-attempt' })
  })

  /**
   * @example
   * it('adds default exact scores from terminal case state') keeps ordinary pass/fail cases visible in metric projections.
   */
  it('adds default exact scores from terminal case state', () => {
    const records = buildCaseRecords({
      events: [
        envelopeOf('case.started', { index: 0, name: 'passed-case', total: 2 }, { caseId: 'passed-case' }),
        envelopeOf('case.ended', { index: 0, name: 'passed-case', state: 'passed', total: 2 }, { caseId: 'passed-case' }),
        envelopeOf('case.started', { index: 1, name: 'failed-case', total: 2 }, { caseId: 'failed-case' }),
        envelopeOf('case.ended', { index: 1, name: 'failed-case', state: 'failed', total: 2 }, { caseId: 'failed-case' }),
      ],
      projectName: 'project-1',
    })

    /**
     * @example
     * expect(records.map(record => [record.caseId, record.scores.exact])).toEqual([['passed-case', 1], ['failed-case', 0]])
     */
    expect(records.map(record => [record.caseId, record.scores.exact])).toEqual([
      ['passed-case', 1],
      ['failed-case', 0],
    ])
  })

  /**
   * @example
   * it('summarizes score averages by score kind and metric group') verifies generic group-by analysis input.
   */
  it('summarizes score averages by score kind and metric group', () => {
    const summary = buildMetricsSummary([
      { attemptId: 'a', caseId: '1', caseName: '1', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { 'benchmark.category': 2 }, projectName: 'p', retryCount: 0, runId: 'r', schemaVersion: 1, scores: { exact: 1, judge: 0.5 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' },
      { attemptId: 'a', caseId: '2', caseName: '2', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { 'benchmark.category': 2 }, projectName: 'p', retryCount: 0, runId: 'r', schemaVersion: 1, scores: { exact: 0 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' },
      { attemptId: 'a', caseId: '3', caseName: '3', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { 'benchmark.category': 3 }, projectName: 'p', retryCount: 0, runId: 'r', schemaVersion: 1, scores: { exact: 0.5, judge: 1 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' },
      { attemptId: 'a', caseId: '4', caseName: '4', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { nullable: null }, projectName: 'p', retryCount: 0, runId: 'r', schemaVersion: 1, scores: { exact: 1 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' },
    ], ['benchmark.category', 'taskId', 'nullable'])

    expect(summary.overall.exact.count).toBe(4)
    expect(summary.overall.exact.sum).toBe(2.5)
    expect(summary.overall.exact.average).toBe(0.625)
    expect(summary.overall.judge.count).toBe(2)
    expect(summary.overall.judge.average).toBe(0.75)
    expect(summary.groups['benchmark.category=2']?.exact.average).toBe(0.5)
    expect(summary.groups['benchmark.category=3']?.exact.average).toBe(0.5)
    expect(summary.groups['taskId=t']?.exact.average).toBe(0.625)
    expect(summary.groups['nullable=null']?.exact.average).toBe(1)
  })

  /**
   * @example
   * it('encodes case records as newline-delimited JSON') documents the local dataframe-friendly format.
   */
  it('encodes case records as newline-delimited JSON', () => {
    const jsonl = encodeJsonl([
      { attemptId: 'a', caseId: '1', caseName: '1', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: {}, projectName: 'p', retryCount: 0, runId: 'r', schemaVersion: 1, scores: {}, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' },
      { attemptId: 'a', caseId: '2', caseName: '2', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: {}, projectName: 'p', retryCount: 0, runId: 'r', schemaVersion: 1, scores: {}, startedAt: 's', state: 'failed', taskId: 't', workspaceId: 'w' },
    ])

    expect(jsonl.endsWith('\n')).toBe(true)
    expect(jsonl.split('\n')).toHaveLength(3)
    expect(jsonl.trim()).toContain('"caseId":"1"')
    expect(jsonl.trim()).toContain('"caseId":"2"')
  })

  /**
   * @example
   * it('encodes empty case records as an empty string') fixes the no-record artifact behavior.
   */
  it('encodes empty case records as an empty string', () => {
    expect(encodeJsonl([])).toBe('')
  })
})
