import type { CaseNode, MetricsResponse, ScoreDefinition } from '../../src/shared/contract'

import { describe, expect, it } from 'vitest'

import { buildCaseTable, columnDefinitions, derivedMetricName, formatColumnValue, matchesFilters, metricDefinition, metricLabel, separationOf } from './caseMetrics'

function caseNode(index: number, name: string, state: CaseNode['state']): CaseNode {
  const caseId = `${index}:${name}`
  return {
    artifactCount: 0,
    caseId,
    // Durations that do not follow the metrics below, so they stay their own signal.
    durationMs: [5, 1, 4, 2][index]! * 1000,
    evidenceLinkCount: 0,
    identity: caseId,
    index,
    key: `task\u0000${caseId}`,
    logLineCount: 0,
    metricCount: 0,
    name,
    rounds: [],
    scores: { unscored: {}, values: {} },
    startedAt: '2026-10-13T00:00:00.000Z',
    state,
    taskId: 'task',
  }
}

/**
 * A metrics response of the task `task`: `series` as recorded metrics, `scores` as each case's counted score value,
 * with the scores' `score.defined`.
 */
function metrics(
  series: Record<string, [caseId: string, value: unknown, roundIndex?: number][]>,
  scores: Record<string, [caseId: string, value: number][]> = {},
  scoreDefinitions: ScoreDefinition[] = [],
): MetricsResponse {
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
    scoreDefinitions,
    scores: Object.entries(scores).map(([name, points]) => ({
      name,
      points: points.map(([caseId, value]) => ({ caseId, taskId: 'task', value })),
      summary: { mean: null, n: points.length, name, sum: 0, total: points.length, unscored: {} },
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
    // Values most frequent first; states in their usual order whatever their counts.
    expect([...table.valueCounts.gui_only!]).toEqual([['true', 3], ['false', 1]])
    expect([...table.valueCounts.state!.keys()]).toEqual(['passed', 'failed', 'running'])
    expect(table.rows.map(row => row.categories.group)).toEqual(['chrome', 'chrome', 'gimp', 'gimp'])
  })
})

describe('buildCaseTable list metrics', () => {
  // ROOT CAUSE:
  //
  // A metric recorded as a list of numbers per case (the grade of each listener vote, `[1, 1, 0]`) is neither a number
  // nor a string, so the table dropped it and no chart could show how close a case came:
  //
  // if (point.caseId != null && (typeof point.value === 'string' || typeof point.value === 'boolean'))
  //
  // We fixed this by summarizing a list of finite numbers as two numeric axes, its mean and its length.
  /**
   * @example
   * expect(table.rows.map(row => row.numbers['votes#mean'])).toEqual([2 / 3, 1, 0, 1 / 3])
   */
  it('summarizes a list of numbers per case as its mean and length', () => {
    const table = buildCaseTable(cases, metrics({
      notes: cases.map(node => [node.caseId, ['a', 'b']]),
      votes: cases.map((node, index) => [node.caseId, [[1, 0, 1], [1, 1, 1], [0, 0, 0], [0, 1, 0]][index]!]),
    }))

    expect(table.rows.map(row => row.numbers[derivedMetricName('votes', 'mean')])).toEqual([2 / 3, 1, 0, 1 / 3])
    // Every case has three votes: one value, so the length is a constant and gets no axis.
    expect(table.constants).toContainEqual({ name: 'votes#length', value: 3 })
    expect(table.groups.map(group => group.representative)).toContain('votes#mean')
    expect(Object.keys(table.rows[0]!.numbers).some(name => name.startsWith('notes'))).toBe(false)
  })

  /**
   * @example
   * expect(metricLabel('votes#mean', definitions)).toBe('Listener votes · mean')
   */
  it('names a derived metric by the label of its list metric and the summary', () => {
    const definitions = new Map([['votes', { label: 'Listener votes', name: 'votes' }]])

    expect(metricLabel('votes#mean', definitions)).toBe('Listener votes · mean')
    expect(metricLabel('steps', definitions)).toBe('steps')
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
   * expect(table.duplicates).toEqual([{ name: 'domain', of: 'group' }, { name: 'pass', of: 'state' }])
   */
  it('hides categories that split the cases exactly like an earlier one', () => {
    const table = buildCaseTable(cases, metrics({
      domain: cases.map(node => [node.caseId, node.name.split('/')[0]]),
    }, {
      // The running case has no counted value yet.
      pass: cases.slice(0, 3).map(node => [node.caseId, node.state === 'passed' ? 1 : 0]),
    }))

    expect(table.categories).toEqual(['state', 'group'])
    expect(table.duplicates).toEqual([{ name: 'domain', of: 'group' }, { name: 'pass', of: 'state' }])
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
    const table = buildCaseTable(cases, metrics({
      captures: cases.map((node, index) => [node.caseId, [5, 1, 6, 7][index]!]),
      flat: cases.map((node, index) => [node.caseId, index % 2]),
      steps: cases.map((node, index) => [node.caseId, [2, 50, 4, 9][index]!]),
    }, {
      // Three distinct values, so the score is a numeric axis like the metrics.
      natural: cases.map((node, index) => [node.caseId, [1, 0, 0.5, 1][index]!]),
    }))
    const separation = separationOf(table)

    // The one failed case has the most steps, and the fewest captures.
    expect(separation.get('steps')).toEqual({ auc: 1, higherIn: 'failed' })
    expect(separation.get('captures')).toEqual({ auc: 1, higherIn: 'passed' })
    expect(table.groups.map(group => group.representative)).toContain('natural')
    expect(separation.has('natural')).toBe(false)
  })

  // ROOT CAUSE:
  //
  // In a scored eval every case passes (a score of 0 is a result), so there was no failed case to compare against and
  // the ranking was empty; the chart opened on metrics in recording order instead of the ones that lower the score.
  //
  // We fixed this by comparing cases below the mean primary score with the rest when no case failed.
  /**
   * @example
   * expect(separation.get('steps')).toEqual({ auc: 1, higherIn: 'lower-scored' })
   */
  it('ranks against the primary score when every case passed', () => {
    const passed = cases.slice(0, 3).map(node => ({ ...node, state: 'passed' as const }))
    const table = buildCaseTable(passed, metrics({
      steps: passed.map((node, index) => [node.caseId, [2, 50, 4][index]!]),
    }, {
      correct: passed.map(node => [node.caseId, 1]),
      pass: passed.map((node, index) => [node.caseId, [1, 0, 1][index]!]),
    }, [{ name: 'correct' }, { name: 'pass', primary: true }]))

    expect(table.primary).toBe('pass')
    expect(separationOf(table).get('steps')).toEqual({ auc: 1, higherIn: 'lower-scored' })
  })

  /**
   * @example
   * expect(separationOf(table).size).toBe(0)
   */
  it('ranks nothing when every case passed and no score is primary', () => {
    const passed = cases.slice(0, 3).map(node => ({ ...node, state: 'passed' as const }))
    const table = buildCaseTable(passed, metrics({
      steps: passed.map((node, index) => [node.caseId, [2, 50, 4][index]!]),
    }, {
      correct: passed.map((node, index) => [node.caseId, [1, 0, 1][index]!]),
      natural: passed.map((node, index) => [node.caseId, [0, 1, 1][index]!]),
    }))

    expect(table.primary).toBeUndefined()
    expect(separationOf(table).size).toBe(0)
  })
})

describe('buildCaseTable scores', () => {
  /**
   * @example
   * expect(table.scores).toEqual(['pass', 'correct'])
   */
  it('joins the counted score values, the primary score first and before the metrics', () => {
    const table = buildCaseTable(cases, metrics({
      steps: cases.map((node, index) => [node.caseId, [2, 8, 30, 64][index]!]),
    }, {
      correct: cases.map((node, index) => [node.caseId, [1, 0.5, 0, 1][index]!]),
      // The failed case counts 0 whatever it recorded; the running one is not counted yet.
      pass: cases.slice(0, 3).map((node, index) => [node.caseId, [1, 0, 0.5][index]!]),
    }, [{ name: 'correct' }, { name: 'pass', primary: true }]))

    expect(table.primary).toBe('pass')
    expect(table.scores).toEqual(['pass', 'correct'])
    expect(table.rows.map(row => row.numbers.pass)).toEqual([1, 0, 0.5, undefined])
    // Scores lead the axes; the metrics follow in recording order.
    expect(table.groups.map(group => group.representative).slice(0, 2)).toEqual(['pass', 'correct'])
  })

  /**
   * @example
   * expect(table.rows.map(row => row.numbers.pass)).toEqual([1, 0, undefined, undefined])
   */
  it('reads the recorded values of the cases while the metrics are not loaded', () => {
    const recorded = cases.map((node, index): CaseNode => ({
      ...node,
      scores: { unscored: index === 2 ? { pass: 'grader_failed' } : {}, values: index < 2 ? { pass: [1, 0][index]! } : {} },
    }))
    const table = buildCaseTable(recorded, undefined)

    expect(table.rows.map(row => row.numbers.pass)).toEqual([1, 0, undefined, undefined])
    // The only score of the cases is their primary one.
    expect(table.primary).toBe('pass')
  })
})

describe('columnDefinitions', () => {
  /**
   * @example
   * expect(metricLabel('pass', definitions)).toBe('Pass')
   */
  it('reads scores as higher-is-better columns with their formula, shown as percentages', () => {
    const scoreDefinitions: ScoreDefinition[] = [
      { label: 'Written back correctly', name: 'correct' },
      { combine: { inputs: [{ name: 'correct' }, { atLeast: 0.5, name: 'natural' }], kind: 'all' }, label: 'Pass', name: 'pass', primary: true },
    ]
    const definitions = columnDefinitions([{ better: 'lower', name: 'latency', unit: 'ms' }], scoreDefinitions)

    expect(metricLabel('pass', definitions)).toBe('Pass')
    expect(metricDefinition('pass', definitions)?.better).toBe('higher')
    expect(metricDefinition('pass', definitions)?.formula).toBe('all of: Written back correctly, natural ≥ 50%')
    expect(formatColumnValue(0.875, metricDefinition('pass', definitions))).toBe('87.5%')
    expect(formatColumnValue(1234.5, metricDefinition('latency', definitions))).toBe('1.2K ms')
    expect(formatColumnValue(1.23456, undefined)).toBe('1.23')
  })
})
