import type { CaseNode, MetricsResponse } from '../../src/shared/contract'

import { describe, expect, it } from 'vitest'

import { buildCaseTable, matchesFilters, separationOf } from './caseMetrics'

function caseNode(index: number, name: string, state: CaseNode['state']): CaseNode {
  const caseId = `${index}:${name}`
  return {
    artifactCount: 0,
    caseId,
    // Durations that do not follow the metrics below, so they stay their own signal.
    durationMs: [5, 1, 4, 2][index]! * 1000,
    evidenceLinkCount: 0,
    index,
    key: `task\u0000${caseId}`,
    logLineCount: 0,
    metricCount: 0,
    name,
    rounds: [],
    scores: {},
    startedAt: '2026-10-13T00:00:00.000Z',
    state,
    taskId: 'task',
  }
}

function metrics(series: Record<string, [caseId: string, value: unknown, roundIndex?: number][]>): MetricsResponse {
  const point = (name: string, [caseId, value, roundIndex]: [string, unknown, number?], seq: number) => ({ caseId, name, roundIndex, seq, taskId: 'task', time: '2026-10-13T00:00:00.000Z', value })
  const entries = Object.entries(series)
  return {
    definitions: [],
    inference: { failed: 0, requests: 0, responses: 0, totals: {} },
    nonNumeric: entries.filter(([, points]) => typeof points[0]![1] !== 'number').map(([name, points]) => ({ name, values: points.map((item, seq) => point(name, item, seq)) })),
    numeric: entries.filter(([, points]) => typeof points[0]![1] === 'number').map(([name, points]) => ({
      name,
      points: points.map((item, seq) => point(name, item, seq)),
      summary: { avg: 0, count: points.length, max: 0, min: 0, sum: 0 },
    })),
  }
}

const cases = [
  caseNode(0, 'chrome/a', 'passed'),
  caseNode(1, 'chrome/b', 'failed'),
  caseNode(2, 'gimp/c', 'passed'),
  caseNode(3, 'gimp/d', 'running'),
]

describe('buildCaseTable', () => {
  /**
   * @example
   * expect(table.groups.map(group => group.representative)).toEqual(['duration_s', 'input_tokens', 'output_tokens'])
   */
  it('folds metrics that move together into the first one and splits out constants', () => {
    const table = buildCaseTable(cases, metrics({
      cache_write_tokens: cases.map(node => [node.caseId, 0]),
      input_tokens: cases.map((node, index) => [node.caseId, [2, 8, 30, 64][index]! * 1000]),
      output_tokens: cases.map((node, index) => [node.caseId, [500, 100, 900, 50][index]!]),
      steps: cases.map((node, index) => [node.caseId, [2, 8, 30, 64][index]!]),
    }))

    expect(table.constants).toEqual([{ name: 'cache_write_tokens', value: 0 }])
    // `input_tokens` is recorded before `steps`, so it represents the group.
    expect(table.groups.map(group => group.representative)).toEqual(['duration_s', 'input_tokens', 'output_tokens'])
    expect(table.groups[1]!.members.map(member => member.name)).toEqual(['steps'])
  })

  /**
   * @example
   * expect(table.rows[0]!.numbers.steps).toBe(9)
   */
  it('keeps the value of the last round of a retried case', () => {
    const table = buildCaseTable(cases, metrics({
      steps: [[cases[0]!.caseId, 9, 1], [cases[0]!.caseId, 3, 0], [cases[1]!.caseId, 4, 0]],
    }))

    expect(table.rows[0]!.numbers.steps).toBe(9)
    expect(table.rows[1]!.numbers.steps).toBe(4)
    expect(table.rows[2]!.numbers.steps).toBeUndefined()
  })

  /**
   * @example
   * expect(table.categories).toEqual(['state', 'group', 'gui_only', 'harness'])
   */
  it('adds the name prefix, flags, and low-cardinality string metrics as categories', () => {
    const table = buildCaseTable(cases, metrics({
      binary_sha: cases.map(node => [node.caseId, 'same-everywhere']),
      gui_only: cases.map((node, index) => [node.caseId, index < 3]),
      harness: cases.map((node, index) => [node.caseId, index % 2 === 0 ? 'pi' : 'codex']),
    }))

    expect(table.categories).toEqual(['state', 'group', 'gui_only', 'harness'])
    expect(table.rows.map(row => row.categories.gui_only)).toEqual(['true', 'true', 'true', 'false'])
    expect(table.rows.map(row => row.categories.group)).toEqual(['chrome', 'chrome', 'gimp', 'gimp'])
  })
})

describe('buildCaseTable across tasks', () => {
  /**
   * @example
   * expect(table.rows.map(row => row.numbers.steps)).toEqual([3, 9])
   */
  it('keeps the metrics of one case id apart per task', () => {
    // One OSWorld question runs under every matrix combination: same case id, different tasks.
    const inTask = (taskId: string): CaseNode => ({ ...caseNode(0, 'chrome/a', 'passed'), key: `${taskId}\u0000${caseNode(0, 'chrome/a', 'passed').caseId}`, taskId })
    const response = metrics({ steps: [[cases[0]!.caseId, 3]] })
    response.numeric[0]!.points.push({ ...response.numeric[0]!.points[0]!, seq: 9, taskId: 'other', value: 9 })
    const table = buildCaseTable([inTask('task'), inTask('other')], response)

    expect(table.rows.map(row => row.numbers.steps)).toEqual([3, 9])
  })
})

describe('buildCaseTable categories', () => {
  /**
   * @example
   * expect(table.duplicates).toEqual([{ name: 'exact', of: 'state' }, { name: 'domain', of: 'group' }])
   */
  it('hides categories that split the cases exactly like an earlier one', () => {
    const scored = cases.map((node, index) => ({ ...node, scores: index === 3 ? {} : { exact: node.state === 'passed' ? 1 : 0 } }))
    const table = buildCaseTable(scored, metrics({
      domain: cases.map(node => [node.caseId, node.name.split('/')[0]]),
    }))

    expect(table.categories).toEqual(['state', 'group'])
    expect(table.duplicates).toEqual([{ name: 'domain', of: 'group' }, { name: 'exact', of: 'state' }])
    expect(table.groups.map(group => group.representative)).toEqual(['duration_s'])
  })
})

describe('matchesFilters', () => {
  /**
   * @example
   * expect(selected.map(row => row.name)).toEqual(['gimp/c'])
   */
  it('combines brushed ranges, picked categories, and the scatterplot box', () => {
    const table = buildCaseTable(cases, metrics({
      steps: cases.map((node, index) => [node.caseId, [2, 8, 30, 64][index]!]),
    }))
    const selected = table.rows.filter(row => matchesFilters(row, {
      box: { x: 'duration_s', x0: 2, x1: 4, y: 'steps', y0: 0, y1: 100 },
      categories: { state: new Set(['passed']) },
      ranges: { steps: [5, 40] },
    }))

    expect(selected.map(row => row.name)).toEqual(['gimp/c'])
  })
})

describe('separationOf', () => {
  /**
   * @example
   * expect(separation.get('steps')).toEqual({ auc: 1, higherIn: 'failed' })
   */
  it('folds the AUC to 0.5..1, keeps the direction, and leaves scores out', () => {
    const scored = cases.map((node, index) => ({ ...node, scores: { exact: index === 1 ? 0 : 1 } }))
    const table = buildCaseTable(scored, metrics({
      captures: cases.map((node, index) => [node.caseId, [5, 1, 6, 7][index]!]),
      flat: cases.map((node, index) => [node.caseId, index % 2]),
      steps: cases.map((node, index) => [node.caseId, [2, 50, 4, 9][index]!]),
    }))
    const separation = separationOf(table)

    // The one failed case has the most steps, and the fewest captures.
    expect(separation.get('steps')).toEqual({ auc: 1, higherIn: 'failed' })
    expect(separation.get('captures')).toEqual({ auc: 1, higherIn: 'passed' })
    expect(separation.has('exact')).toBe(false)
  })
})
