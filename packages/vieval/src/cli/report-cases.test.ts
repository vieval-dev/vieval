import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildReportCasesOutput, readCaseRecordsFromReport } from './report-cases'

/**
 * @example
 * describe('report cases') verifies local case artifact inspection.
 */
describe('report cases', () => {
  /**
   * @example
   * it('reads and filters cases by metric equality') checks dataframe-like filtering from CLI args.
   */
  it('reads and filters cases by metric equality', async ({ task }) => {
    const dir = task.name.replaceAll(' ', '-')
    const reportPath = join(process.cwd(), '.tmp', dir)
    await mkdir(reportPath, { recursive: true })
    await writeFile(join(reportPath, 'cases.jsonl'), [
      JSON.stringify({ attemptId: 'a', caseId: '1', caseName: 'One', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { 'benchmark.locomo.category': 1 }, projectName: 'p', retryCount: 0, runId: 'r', schemaVersion: 1, scores: { exact: 1 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' }),
      JSON.stringify({ attemptId: 'a', caseId: '2', caseName: 'Two', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { 'benchmark.locomo.category': 2 }, projectName: 'p', retryCount: 0, runId: 'r', schemaVersion: 1, scores: { exact: 0 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' }),
    ].join('\n').concat('\n'), 'utf-8')

    const records = await readCaseRecordsFromReport(reportPath)
    const output = buildReportCasesOutput(records, { format: 'json', where: ['benchmark.locomo.category=2'] })

    expect(output.records).toHaveLength(1)
    expect(output.records[0]?.caseId).toBe('2')
  })

  /**
   * @example
   * it('groups cases by a metric key') verifies generic benchmark facet summaries.
   */
  it('groups cases by a metric key', () => {
    const output = buildReportCasesOutput([
      { attemptId: 'a', caseId: '1', caseName: 'One', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { 'benchmark.locomo.category': 2 }, projectName: 'p', retryCount: 0, runId: 'r', schemaVersion: 1, scores: { exact: 1 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' },
      { attemptId: 'a', caseId: '2', caseName: 'Two', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: { 'benchmark.locomo.category': 2 }, projectName: 'p', retryCount: 0, runId: 'r', schemaVersion: 1, scores: { exact: 0 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' },
    ], { format: 'json', groupBy: 'benchmark.locomo.category' })

    expect(output.groups?.['benchmark.locomo.category=2']?.count).toBe(2)
    expect(output.groups?.['benchmark.locomo.category=2']?.scores.exact.average).toBe(0.5)
  })

  /**
   * @example
   * it('reads cases from direct jsonl files and multi-report roots') covers non-default report path shapes.
   */
  it('reads cases from direct jsonl files and multi-report roots', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'vieval-report-cases-'))
    const leftRun = join(reportRoot, 'workspace', 'project', 'experiment', 'attempt-a', 'run-a')
    const rightRun = join(reportRoot, 'workspace', 'project', 'experiment', 'attempt-b', 'run-b')
    await mkdir(leftRun, { recursive: true })
    await mkdir(rightRun, { recursive: true })
    await writeFile(join(leftRun, 'cases.jsonl'), `${JSON.stringify({ attemptId: 'a', caseId: 'left', caseName: 'Left', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: {}, projectName: 'p', retryCount: 0, runId: 'left-run', schemaVersion: 1, scores: { exact: 1 }, startedAt: 's', state: 'passed', taskId: 't', workspaceId: 'w' })}\n`, 'utf-8')
    await writeFile(join(rightRun, 'cases.jsonl'), `${JSON.stringify({ attemptId: 'b', caseId: 'right', caseName: 'Right', durationMs: 1, endedAt: 'e', experimentId: 'e', metrics: {}, projectName: 'p', retryCount: 0, runId: 'right-run', schemaVersion: 1, scores: { exact: 0 }, startedAt: 's', state: 'failed', taskId: 't', workspaceId: 'w' })}\n`, 'utf-8')

    const directRecords = await readCaseRecordsFromReport(join(leftRun, 'cases.jsonl'))
    const rootRecords = await readCaseRecordsFromReport(reportRoot)

    expect(directRecords.map(record => record.caseId)).toEqual(['left'])
    expect(rootRecords.map(record => record.caseId)).toEqual(['left', 'right'])
  })

  /**
   * @example
   * it('throws for malformed jsonl and missing case files') verifies bad report inputs fail loudly.
   */
  it('throws for malformed jsonl and missing case files', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'vieval-report-cases-invalid-'))
    const malformedRun = join(reportRoot, 'malformed')
    const emptyRoot = join(reportRoot, 'empty')
    await mkdir(malformedRun, { recursive: true })
    await mkdir(emptyRoot, { recursive: true })
    await writeFile(join(malformedRun, 'cases.jsonl'), '{"caseId":\n', 'utf-8')

    await expect(readCaseRecordsFromReport(malformedRun)).rejects.toThrow('Invalid cases.jsonl line 1')
    await expect(readCaseRecordsFromReport(emptyRoot)).rejects.toThrow('No cases.jsonl files found')
  })

  /**
   * @example
   * it('throws for invalid where selectors') verifies CLI selectors are not silently ignored.
   */
  it('throws for invalid where selectors', () => {
    expect(() => buildReportCasesOutput([], { format: 'json', where: ['benchmark.locomo.category'] })).toThrow('Invalid selector "benchmark.locomo.category". Expected "key=value".')
  })
})
