import type { CaseRecord } from './report-records'

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildReportCasesOutput, readCaseRecordsFromReport } from './report-cases'
import { encodeJsonl } from './report-records'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

/**
 * Creates one current case record; `overrides` replace its fields.
 */
function recordOf(overrides: Partial<CaseRecord>): CaseRecord {
  return {
    attemptId: 'a',
    caseId: '1',
    caseName: 'One',
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
 * describe('report cases', () => {})
 */
describe('report cases', () => {
  /**
   * @example
   * it('reads and filters cases by metric and score equality', async () => {})
   */
  it('reads and filters cases by metric and score equality', async () => {
    const reportPath = await createTemporaryDirectory('vieval-report-cases-')
    await writeFile(join(reportPath, 'cases.jsonl'), encodeJsonl([
      recordOf({ caseId: '1', metrics: { 'benchmark.locomo.category': 1 }, scores: { 'locomo.correct': 1 } }),
      recordOf({ caseId: '2', caseName: 'Two', metrics: { 'benchmark.locomo.category': 2 }, scores: { 'locomo.correct': 0 } }),
    ]), 'utf-8')

    const records = await readCaseRecordsFromReport(reportPath)

    /**
     * @example
     * expect(buildReportCasesOutput(records, { format: 'json', where: ['benchmark.locomo.category=2'] }).records.map(record => record.caseId)).toEqual(['2'])
     */
    expect(buildReportCasesOutput(records, { format: 'json', where: ['benchmark.locomo.category=2'] }).records.map(record => record.caseId)).toEqual(['2'])
    expect(buildReportCasesOutput(records, { format: 'json', where: ['scores.locomo.correct=1'] }).records.map(record => record.caseId)).toEqual(['1'])
  })

  /**
   * @example
   * it('groups cases by a metric key into score summaries by name', () => {})
   */
  it('groups cases by a metric key into score summaries by name', () => {
    const output = buildReportCasesOutput([
      recordOf({ caseId: '1', metrics: { 'benchmark.locomo.category': 2 }, scores: { 'locomo.correct': 1 } }),
      recordOf({ caseId: '2', metrics: { 'benchmark.locomo.category': 2 }, scores: {}, unscored: { 'locomo.correct': 'grader_failed' } }),
      recordOf({ caseId: '3', metrics: { 'benchmark.locomo.category': 2 }, scores: { 'locomo.correct': 0 }, state: 'failed' }),
    ], { format: 'json', groupBy: 'benchmark.locomo.category' })

    /**
     * @example
     * expect(output.groups?.['benchmark.locomo.category=2']?.scores['locomo.correct']).toEqual({ mean: 0.5, n: 2, ... })
     */
    expect(output.groups?.['benchmark.locomo.category=2']?.count).toBe(3)
    expect(output.groups?.['benchmark.locomo.category=2']?.scores['locomo.correct']).toEqual({
      mean: 0.5,
      n: 2,
      name: 'locomo.correct',
      sum: 1,
      total: 3,
      unscored: { grader_failed: 1 },
    })
  })

  /**
   * @example
   * it('reads cases from direct jsonl files and multi-report roots', async () => {})
   */
  it('reads cases from direct jsonl files and multi-report roots', async () => {
    const reportRoot = await createTemporaryDirectory('vieval-report-cases-')
    const leftRun = join(reportRoot, 'workspace', 'project', 'experiment', 'attempt-a', 'run-a')
    const rightRun = join(reportRoot, 'workspace', 'project', 'experiment', 'attempt-b', 'run-b')
    await mkdir(leftRun, { recursive: true })
    await mkdir(rightRun, { recursive: true })
    await writeFile(join(leftRun, 'cases.jsonl'), encodeJsonl([recordOf({ caseId: 'left', runId: 'left-run' })]), 'utf-8')
    await writeFile(join(rightRun, 'cases.jsonl'), encodeJsonl([recordOf({ caseId: 'right', runId: 'right-run', state: 'failed' })]), 'utf-8')

    const directRecords = await readCaseRecordsFromReport(join(leftRun, 'cases.jsonl'))
    const rootRecords = await readCaseRecordsFromReport(reportRoot)

    /**
     * @example
     * expect(rootRecords.map(record => record.caseId)).toEqual(['left', 'right'])
     */
    expect(directRecords.map(record => record.caseId)).toEqual(['left'])
    expect(rootRecords.map(record => record.caseId)).toEqual(['left', 'right'])
  })

  /**
   * @example
   * it('throws for malformed jsonl, older records, and missing case files', async () => {})
   */
  it('throws for malformed jsonl, older records, and missing case files', async () => {
    const reportRoot = await createTemporaryDirectory('vieval-report-cases-invalid-')
    const malformedRun = join(reportRoot, 'malformed')
    const olderRun = join(reportRoot, 'older')
    const emptyRoot = join(reportRoot, 'empty')
    await mkdir(malformedRun, { recursive: true })
    await mkdir(olderRun, { recursive: true })
    await mkdir(emptyRoot, { recursive: true })
    await writeFile(join(malformedRun, 'cases.jsonl'), '{"caseId":\n', 'utf-8')
    await writeFile(join(olderRun, 'cases.jsonl'), `${JSON.stringify({ ...recordOf({}), schemaVersion: 1, scores: { exact: 1 } })}\n`, 'utf-8')

    /**
     * @example
     * await expect(readCaseRecordsFromReport(olderRun)).rejects.toThrow('This report was written by an older vieval. Run it again.')
     */
    await expect(readCaseRecordsFromReport(malformedRun)).rejects.toThrow('Invalid cases.jsonl line 1')
    await expect(readCaseRecordsFromReport(olderRun)).rejects.toThrow('This report was written by an older vieval. Run it again.')
    await expect(readCaseRecordsFromReport(emptyRoot)).rejects.toThrow('No cases.jsonl files found')
  })

  /**
   * @example
   * it('throws for invalid where selectors', () => {})
   */
  it('throws for invalid where selectors', () => {
    /**
     * @example
     * expect(() => buildReportCasesOutput([], { format: 'json', where: ['benchmark.locomo.category'] })).toThrow('Invalid selector')
     */
    expect(() => buildReportCasesOutput([], { format: 'json', where: ['benchmark.locomo.category'] })).toThrow('Invalid selector "benchmark.locomo.category". Expected "key=value".')
  })
})
