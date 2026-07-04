import { describe, expect, it } from 'vitest'

import { buildCaseComparison, formatCaseComparisonTable } from './report-case-compare'

/**
 * @example
 * describe('report compare') verifies generic case score diffs between two runs.
 */
describe('report compare', () => {
  /**
   * @example
   * it('reports matched case score deltas and changed metrics') checks the core regression analysis contract.
   */
  it('reports matched case score deltas and changed metrics', () => {
    const comparison = buildCaseComparison({
      caseKey: 'benchmark.case.id',
      left: [{ attemptId: 'a', caseId: 'left-1', caseName: 'Case', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { 'benchmark.case.id': 'case-a', 'prediction': 'wrong' }, projectName: 'p', retryCount: 0, runId: 'left', schemaVersion: 1, scores: { exact: 0 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' }],
      right: [{ attemptId: 'a', caseId: 'right-1', caseName: 'Case', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { 'benchmark.case.id': 'case-a', 'prediction': 'right' }, projectName: 'p', retryCount: 0, runId: 'right', schemaVersion: 1, scores: { exact: 1 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' }],
      scoreKind: 'exact',
    })

    expect(comparison.overall.delta).toBe(1)
    expect(comparison.cases[0]?.caseKey).toBe('case-a')
    expect(comparison.cases[0]?.delta.score).toBe(1)
    expect(comparison.cases[0]?.metricsChanged.prediction).toEqual({ left: 'wrong', right: 'right' })
    expect(comparison.topImprovements[0]?.caseKey).toBe('case-a')
    expect(comparison.topRegressions).toHaveLength(0)
  })

  /**
   * @example
   * it('reports added and removed cases') verifies unmatched case accounting.
   */
  it('reports added and removed cases', () => {
    const comparison = buildCaseComparison({
      left: [{ attemptId: 'a', caseId: 'removed', caseName: 'Removed', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: {}, projectName: 'p', retryCount: 0, runId: 'left', schemaVersion: 1, scores: { exact: 1 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' }],
      right: [{ attemptId: 'a', caseId: 'added', caseName: 'Added', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: {}, projectName: 'p', retryCount: 0, runId: 'right', schemaVersion: 1, scores: { exact: 0 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' }],
      scoreKind: 'exact',
    })

    expect(comparison.added).toHaveLength(1)
    expect(comparison.removed).toHaveLength(1)
  })

  /**
   * @example
   * it('does not silently fall back when an explicit case key is missing') keeps case matching strict.
   */
  it('does not silently fall back when an explicit case key is missing', () => {
    expect(() => buildCaseComparison({
      caseKey: 'benchmark.case.id',
      left: [{ attemptId: 'a', caseId: 'same', caseName: 'Left', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: {}, projectName: 'p', retryCount: 0, runId: 'left', schemaVersion: 1, scores: { exact: 1 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' }],
      right: [{ attemptId: 'a', caseId: 'same', caseName: 'Right', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: {}, projectName: 'p', retryCount: 0, runId: 'right', schemaVersion: 1, scores: { exact: 0 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' }],
    })).toThrow('Missing explicit case key "benchmark.case.id" for case "same".')
  })

  /**
   * @example
   * it('throws for duplicate case keys on either side') prevents silent Map overwrite in comparisons.
   */
  it('throws for duplicate case keys on either side', () => {
    expect(() => buildCaseComparison({
      left: [
        { attemptId: 'a', caseId: 'first', caseName: 'First', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { 'benchmark.case.id': 'same' }, projectName: 'p', retryCount: 0, runId: 'left', schemaVersion: 1, scores: { exact: 1 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' },
        { attemptId: 'a', caseId: 'second', caseName: 'Second', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { 'benchmark.case.id': 'same' }, projectName: 'p', retryCount: 0, runId: 'left', schemaVersion: 1, scores: { exact: 0 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' },
      ],
      right: [],
    })).toThrow('Duplicate case key "same" in left report.')

    expect(() => buildCaseComparison({
      left: [],
      right: [
        { attemptId: 'a', caseId: 'first', caseName: 'First', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { 'benchmark.case.id': 'same' }, projectName: 'p', retryCount: 0, runId: 'right', schemaVersion: 1, scores: { exact: 1 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' },
        { attemptId: 'a', caseId: 'second', caseName: 'Second', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { 'benchmark.case.id': 'same' }, projectName: 'p', retryCount: 0, runId: 'right', schemaVersion: 1, scores: { exact: 0 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' },
      ],
    })).toThrow('Duplicate case key "same" in right report.')
  })

  /**
   * @example
   * it('falls back to vieval.case.id before direct caseId') checks default matching with Vieval metric ids.
   */
  it('falls back to vieval.case.id before direct caseId', () => {
    const comparison = buildCaseComparison({
      left: [{ attemptId: 'a', caseId: 'left-id', caseName: 'Left', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { 'vieval.case.id': 'canonical' }, projectName: 'p', retryCount: 0, runId: 'left', schemaVersion: 1, scores: { exact: 0 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' }],
      right: [{ attemptId: 'a', caseId: 'right-id', caseName: 'Right', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { 'vieval.case.id': 'canonical' }, projectName: 'p', retryCount: 0, runId: 'right', schemaVersion: 1, scores: { exact: 1 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' }],
    })

    expect(comparison.cases[0]?.caseKey).toBe('canonical')
    expect(comparison.added).toHaveLength(0)
    expect(comparison.removed).toHaveLength(0)
  })

  /**
   * @example
   * it('renders group, per-case, metric, and unmatched details in table output') keeps default CLI output useful.
   */
  it('renders group, per-case, metric, and unmatched details in table output', () => {
    const comparison = buildCaseComparison({
      groupBy: 'benchmark.group',
      left: [
        { attemptId: 'a', caseId: 'improved', caseName: 'Improved', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { 'benchmark.group': 'date', 'prediction': 'wrong' }, projectName: 'p', retryCount: 0, runId: 'left', schemaVersion: 1, scores: { exact: 0 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' },
        { attemptId: 'a', caseId: 'regressed', caseName: 'Regressed', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { 'benchmark.group': 'date' }, projectName: 'p', retryCount: 0, runId: 'left', schemaVersion: 1, scores: { exact: 1 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' },
        { attemptId: 'a', caseId: 'removed', caseName: 'Removed', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: {}, projectName: 'p', retryCount: 0, runId: 'left', schemaVersion: 1, scores: { exact: 1 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' },
      ],
      right: [
        { attemptId: 'a', caseId: 'improved', caseName: 'Improved', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { 'benchmark.group': 'date', 'prediction': 'right' }, projectName: 'p', retryCount: 0, runId: 'right', schemaVersion: 1, scores: { exact: 1 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' },
        { attemptId: 'a', caseId: 'regressed', caseName: 'Regressed', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { 'benchmark.group': 'date' }, projectName: 'p', retryCount: 0, runId: 'right', schemaVersion: 1, scores: { exact: 0 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' },
        { attemptId: 'a', caseId: 'added', caseName: 'Added', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: {}, projectName: 'p', retryCount: 0, runId: 'right', schemaVersion: 1, scores: { exact: 1 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' },
      ],
    })

    const table = formatCaseComparisonTable(comparison)

    expect(table).toContain('benchmark.group=date')
    expect(table).toContain('Top improvements')
    expect(table).toContain('Top regressions')
    expect(table).toContain('changedMetrics=prediction')
    expect(table).toContain('Added cases added')
    expect(table).toContain('Removed cases removed')
  })
})
