import type { CaseRecord } from './report-records'

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildCaseComparison, formatCaseComparisonTable, resolveComparedScore } from './report-case-compare'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

/**
 * Creates one current case record; `overrides` replace its fields.
 */
function recordOf(overrides: Partial<CaseRecord>): CaseRecord {
  return {
    attemptId: 'a',
    caseId: 'case',
    caseName: 'Case',
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
 * Writes a minimal `run-summary.json` whose one project has a `score` headline over `primary`, or no headline.
 */
async function writeRunSummary(directory: string, primary: string | undefined): Promise<void> {
  await mkdir(directory, { recursive: true })
  const score = { mean: 1, n: 1, name: primary, sum: 1, total: 1, unscored: {} }
  const completion = { mean: 1, n: 1, name: 'completion', sum: 1, total: 1, unscored: {} }
  await writeFile(join(directory, 'run-summary.json'), JSON.stringify({
    headline: null,
    projects: [{ headline: primary == null ? null : { completion, headline: { kind: 'score', score } }, name: 'p' }],
    schemaVersion: 2,
  }), 'utf-8')
}

/**
 * @example
 * describe('buildCaseComparison', () => {})
 */
describe('buildCaseComparison', () => {
  /**
   * @example
   * it('reports matched case deltas of the named score and changed metrics', () => {})
   */
  it('reports matched case deltas of the named score and changed metrics', () => {
    const comparison = buildCaseComparison({
      caseKey: 'benchmark.case.id',
      left: [recordOf({ caseId: 'left-1', metrics: { 'benchmark.case.id': 'case-a', 'prediction': 'wrong' }, runId: 'left', scores: { correct: 0, natural: 1 } })],
      right: [recordOf({ caseId: 'right-1', metrics: { 'benchmark.case.id': 'case-a', 'prediction': 'right' }, runId: 'right', scores: { correct: 1, natural: 1 } })],
      score: 'correct',
    })

    /**
     * @example
     * expect(comparison.cases[0]?.delta).toEqual({ left: 0, right: 1, score: 1 })
     */
    expect(comparison.score).toBe('correct')
    expect(comparison.overall).toEqual({ delta: 1, leftAverage: 0, rightAverage: 1 })
    expect(comparison.cases[0]?.caseKey).toBe('case-a')
    expect(comparison.cases[0]?.delta).toEqual({ left: 0, right: 1, score: 1 })
    expect(comparison.cases[0]?.metricsChanged.prediction).toEqual({ left: 'wrong', right: 'right' })
    expect(comparison.topImprovements[0]?.caseKey).toBe('case-a')
    expect(comparison.topRegressions).toHaveLength(0)
  })

  /**
   * @example
   * it('leaves a case without a counted value on one side out of deltas instead of counting it as 0', () => {})
   */
  it('leaves a case without a counted value on one side out of deltas instead of counting it as 0', () => {
    const comparison = buildCaseComparison({
      groupBy: 'taskId',
      left: [recordOf({ caseName: 'unscored', scores: {}, unscored: { correct: 'grader_failed' } }), recordOf({ caseName: 'counted', scores: { correct: 1 } })],
      right: [recordOf({ caseName: 'unscored', scores: { correct: 1 } }), recordOf({ caseName: 'counted', scores: { correct: 0 } })],
      score: 'correct',
    })

    /**
     * @example
     * expect(comparison.cases.find(row => row.caseKey === 't::unscored')?.delta).toEqual({ left: null, right: 1, score: null })
     */
    expect(comparison.cases.find(row => row.caseKey === 't::unscored')?.delta).toEqual({ left: null, right: 1, score: null })
    expect(comparison.topImprovements).toHaveLength(0)
    expect(comparison.topRegressions.map(row => row.caseKey)).toEqual(['t::counted'])
    expect(comparison.overall).toEqual({ delta: -0.5, leftAverage: 1, rightAverage: 0.5 })
    expect(comparison.groups?.['taskId=t']).toEqual({ count: 2, delta: -1, leftAverage: 1, rightAverage: 0 })
  })

  // ROOT CAUSE:
  //
  // Without `--case-key` or a `benchmark.case.id` metric, cases were matched by `caseId` (`<index>:<name>`), which
  // is unique only within one task. A run with several tasks or matrix rows has the same case ids in each of
  // them, so the comparison threw "duplicate case key" for any multi-task run.
  //
  // We fixed this by falling back to the task id plus the case name.
  /**
   * @example
   * it('matches same-named cases of different tasks separately by default', () => {})
   */
  it('matches same-named cases of different tasks separately by default', () => {
    const record = (runId: string, taskId: string, correct: number) => recordOf({ caseId: '0:case #1', caseName: 'case #1', runId, scores: { correct }, taskId })

    const comparison = buildCaseComparison({
      left: [record('left', 'zh::default::run=tts%3Dnone::eval=default', 0), record('left', 'en::default::run=tts%3Dnone::eval=default', 1)],
      right: [record('right', 'zh::default::run=tts%3Dnone::eval=default', 1), record('right', 'en::default::run=tts%3Dnone::eval=default', 1)],
      score: 'correct',
    })

    /**
     * @example
     * expect(comparison.cases[1]?.delta.score).toBe(1)
     */
    expect(comparison.cases.map(row => row.caseKey)).toEqual([
      'en::default::run=tts%3Dnone::eval=default::case #1',
      'zh::default::run=tts%3Dnone::eval=default::case #1',
    ])
    expect(comparison.cases[1]?.delta.score).toBe(1)
  })

  /**
   * @example
   * it('reports added and removed cases', () => {})
   */
  it('reports added and removed cases', () => {
    const comparison = buildCaseComparison({
      left: [recordOf({ caseId: 'removed', caseName: 'Removed', scores: { correct: 1 } })],
      right: [recordOf({ caseId: 'added', caseName: 'Added', scores: { correct: 0 } })],
      score: 'correct',
    })

    /**
     * @example
     * expect(comparison.added).toHaveLength(1)
     */
    expect(comparison.added).toHaveLength(1)
    expect(comparison.removed).toHaveLength(1)
  })

  /**
   * @example
   * it('does not silently fall back when an explicit case key is missing', () => {})
   */
  it('does not silently fall back when an explicit case key is missing', () => {
    /**
     * @example
     * expect(() => buildCaseComparison({ caseKey: 'benchmark.case.id', ... })).toThrow('Missing explicit case key')
     */
    expect(() => buildCaseComparison({
      caseKey: 'benchmark.case.id',
      left: [recordOf({ caseId: 'same', caseName: 'Left' })],
      right: [recordOf({ caseId: 'same', caseName: 'Right' })],
      score: 'correct',
    })).toThrow('Missing explicit case key "benchmark.case.id" for case "same".')
  })

  /**
   * @example
   * it('throws for duplicate case keys on either side', () => {})
   */
  it('throws for duplicate case keys on either side', () => {
    const duplicates = [
      recordOf({ caseId: 'first', metrics: { 'benchmark.case.id': 'same' } }),
      recordOf({ caseId: 'second', metrics: { 'benchmark.case.id': 'same' } }),
    ]

    /**
     * @example
     * expect(() => buildCaseComparison({ left: duplicates, right: [], score: 'correct' })).toThrow('Duplicate case key "same" in left report.')
     */
    expect(() => buildCaseComparison({ left: duplicates, right: [], score: 'correct' })).toThrow('Duplicate case key "same" in left report.')
    expect(() => buildCaseComparison({ left: [], right: duplicates, score: 'correct' })).toThrow('Duplicate case key "same" in right report.')
  })

  /**
   * @example
   * it('falls back to vieval.case.id before the task id and case name', () => {})
   */
  it('falls back to vieval.case.id before the task id and case name', () => {
    const comparison = buildCaseComparison({
      left: [recordOf({ caseId: 'left-id', caseName: 'Left', metrics: { 'vieval.case.id': 'canonical' } })],
      right: [recordOf({ caseId: 'right-id', caseName: 'Right', metrics: { 'vieval.case.id': 'canonical' } })],
      score: 'correct',
    })

    /**
     * @example
     * expect(comparison.cases[0]?.caseKey).toBe('canonical')
     */
    expect(comparison.cases[0]?.caseKey).toBe('canonical')
    expect(comparison.added).toHaveLength(0)
    expect(comparison.removed).toHaveLength(0)
  })

  /**
   * @example
   * it('renders the score, group, per-case, metric, and unmatched details in table output', () => {})
   */
  it('renders the score, group, per-case, metric, and unmatched details in table output', () => {
    const comparison = buildCaseComparison({
      groupBy: 'benchmark.group',
      left: [
        recordOf({ caseId: 'improved', caseName: 'Improved', metrics: { 'benchmark.group': 'date', 'prediction': 'wrong' }, scores: { correct: 0 } }),
        recordOf({ caseId: 'regressed', caseName: 'Regressed', metrics: { 'benchmark.group': 'date' }, scores: { correct: 1 } }),
        recordOf({ caseId: 'removed', caseName: 'Removed', scores: { correct: 1 } }),
      ],
      right: [
        recordOf({ caseId: 'improved', caseName: 'Improved', metrics: { 'benchmark.group': 'date', 'prediction': 'right' }, scores: { correct: 1 } }),
        recordOf({ caseId: 'regressed', caseName: 'Regressed', metrics: { 'benchmark.group': 'date' }, scores: {} }),
        recordOf({ caseId: 'added', caseName: 'Added', scores: { correct: 1 } }),
      ],
      score: 'correct',
    })

    const table = formatCaseComparisonTable(comparison)

    /**
     * @example
     * expect(table).toContain('Score     correct')
     */
    expect(table).toContain('Score     correct')
    expect(table).toContain('benchmark.group=date')
    expect(table).toContain('Top improvements')
    expect(table).toContain('t::Regressed  delta=- changedMetrics=none')
    expect(table).toContain('changedMetrics=prediction')
    expect(table).toContain('Added cases t::Added')
    expect(table).toContain('Removed cases t::Removed')
  })
})

/**
 * @example
 * describe('resolveComparedScore', () => {})
 */
describe('resolveComparedScore', () => {
  /**
   * @example
   * it('uses the primary score of the run summaries', async () => {})
   */
  it('uses the primary score of the run summaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vieval-compare-score-'))
    temporaryDirectories.push(root)
    await writeRunSummary(join(root, 'left'), 'pass')
    await writeRunSummary(join(root, 'right'), 'pass')

    /**
     * @example
     * expect(await resolveComparedScore([left, right], records)).toBe('pass')
     */
    expect(await resolveComparedScore([join(root, 'left'), join(root, 'right')], [recordOf({ scores: { correct: 1, pass: 1 } })])).toBe('pass')
  })

  /**
   * @example
   * it('falls back to the only score, and asks for --score when neither decides', async () => {})
   */
  it('falls back to the only score, and asks for --score when neither decides', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vieval-compare-score-'))
    temporaryDirectories.push(root)
    await writeRunSummary(join(root, 'left'), 'pass')
    await writeRunSummary(join(root, 'right'), 'correct')
    await writeRunSummary(join(root, 'none'), undefined)

    /**
     * @example
     * await expect(resolveComparedScore([left, right], records)).rejects.toThrow('Pass --score <name>')
     */
    expect(await resolveComparedScore([join(root, 'none')], [recordOf({ scores: { correct: 1 } })])).toBe('correct')
    await expect(resolveComparedScore([join(root, 'left'), join(root, 'right')], [recordOf({ scores: { correct: 1, pass: 1 } })]))
      .rejects
      .toThrow('Pass --score <name>: the reports have different primary scores (correct, pass). Scores in the reports: correct, pass.')
  })

  /**
   * @example
   * it('rejects a run summary written by an older vieval', async () => {})
   */
  it('rejects a run summary written by an older vieval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vieval-compare-score-'))
    temporaryDirectories.push(root)
    await writeFile(join(root, 'run-summary.json'), JSON.stringify({ projects: [], schemaVersion: 1 }), 'utf-8')

    /**
     * @example
     * await expect(resolveComparedScore([root], [])).rejects.toThrow('This report was written by an older vieval. Run it again.')
     */
    await expect(resolveComparedScore([root], [])).rejects.toThrow('This report was written by an older vieval. Run it again.')
  })
})
