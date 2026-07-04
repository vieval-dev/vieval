import { describe, expect, it } from 'vitest'

import { buildCaseRecords, buildMetricsSummary, encodeJsonl } from './report-records'

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
      attemptId: 'attempt-1',
      events: [
        {
          caseId: 'case-1',
          data: {
            caseName: 'Case 1',
            input: { prompt: 'When?' },
            retryIndex: 1,
            startedAt: '2026-05-08T00:00:00.000Z',
          },
          event: 'task.case.start',
          projectName: 'project-from-event',
          taskId: 'task-1',
          timestamp: '2026-05-08T00:00:00.000Z',
        },
        {
          caseId: 'case-1',
          data: { name: 'benchmark.id', value: 'locomo' },
          event: 'task.case.metric',
          taskId: 'task-1',
        },
        {
          caseId: 'case-1',
          data: { kind: 'exact', score: 0.75 },
          event: 'task.case.score',
          taskId: 'task-1',
        },
        {
          caseId: 'case-1',
          data: {
            endedAt: '2026-05-08T00:00:01.250Z',
            output: { answer: 'May 8' },
            state: 'passed',
          },
          event: 'task.case.end',
          taskId: 'task-1',
          timestamp: '2026-05-08T00:00:01.250Z',
        },
      ],
      experimentId: 'default',
      projectName: 'locomo-lobehub',
      runId: 'run-1',
      workspaceId: 'agent-memory',
    })

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
      workspaceId: 'agent-memory',
    })
  })

  /**
   * @example
   * it('falls back to event timestamps and ignores invalid durations') verifies current CLI event envelopes remain usable.
   */
  it('falls back to event timestamps and ignores invalid durations', () => {
    const records = buildCaseRecords({
      attemptId: 'attempt-1',
      events: [
        { caseId: 'case-1', event: 'task.case.start', taskId: 'task-1', timestamp: 'not-a-date' },
        { caseId: 'case-1', event: 'task.case.end', taskId: 'task-1', timestamp: '2026-05-08T00:00:01.000Z' },
      ],
      experimentId: 'default',
      projectName: 'project-1',
      runId: 'run-1',
      workspaceId: 'workspace-1',
    })

    expect(records[0]?.startedAt).toBe('not-a-date')
    expect(records[0]?.endedAt).toBe('2026-05-08T00:00:01.000Z')
    expect(records[0]?.durationMs).toBe(0)
    expect(records[0]?.state).toBe('failed')
  })

  /**
   * @example
   * it('keeps only the final retry attempt payload while preserving full case duration') verifies current CLI retry event ordering.
   */
  it('keeps only the final retry attempt payload while preserving full case duration', () => {
    const records = buildCaseRecords({
      attemptId: 'attempt-1',
      events: [
        {
          caseId: 'case-1',
          data: {
            retryIndex: 0,
            startedAt: '2026-05-08T00:00:00.000Z',
          },
          event: 'CaseStarted',
          taskId: 'task-1',
        },
        {
          caseId: 'case-1',
          data: { kind: 'exact', score: 0.2 },
          event: 'task.case.score',
          taskId: 'task-1',
        },
        {
          caseId: 'case-1',
          data: { name: 'attempt.metric', value: 'failed-attempt' },
          event: 'task.case.metric',
          taskId: 'task-1',
        },
        {
          caseId: 'case-1',
          data: {
            retryIndex: 1,
            startedAt: '2026-05-08T00:00:03.000Z',
          },
          event: 'CaseStarted',
          taskId: 'task-1',
        },
        {
          caseId: 'case-1',
          data: { name: 'attempt.metric', value: 'final-attempt' },
          event: 'task.case.metric',
          taskId: 'task-1',
        },
        {
          caseId: 'case-1',
          data: {
            endedAt: '2026-05-08T00:00:05.000Z',
            state: 'passed',
          },
          event: 'CaseEnded',
          taskId: 'task-1',
        },
      ],
      experimentId: 'default',
      projectName: 'project-1',
      runId: 'run-1',
      workspaceId: 'workspace-1',
    })

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
      attemptId: 'attempt-1',
      events: [
        { caseId: 'passed-case', data: { startedAt: '2026-05-08T00:00:00.000Z' }, event: 'CaseStarted', taskId: 'task-1' },
        { caseId: 'passed-case', data: { endedAt: '2026-05-08T00:00:01.000Z', state: 'passed' }, event: 'CaseEnded', taskId: 'task-1' },
        { caseId: 'failed-case', data: { startedAt: '2026-05-08T00:00:00.000Z' }, event: 'CaseStarted', taskId: 'task-1' },
        { caseId: 'failed-case', data: { endedAt: '2026-05-08T00:00:01.000Z', state: 'failed' }, event: 'CaseEnded', taskId: 'task-1' },
      ],
      experimentId: 'default',
      projectName: 'project-1',
      runId: 'run-1',
      workspaceId: 'workspace-1',
    })

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
