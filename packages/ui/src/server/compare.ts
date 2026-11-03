import type { CellCoverage, ComparedRun, ComparisonCell, ComparisonResponse, MatrixCell, MatrixResponse, MetricDefinition, RunListItem, ScoreDefinition, ScoreGraders, TaskNode } from '../shared/contract'
import type { ReducedCase } from '../shared/reduce'
import type { RunHandle } from './store'

import { addScoreGrader, axisValues, buildTaskNodes, compareNatural, countedScores, countingDefinitions, pickScoreDefinitions } from '../shared/reduce'
import { toRunListItem } from './store'

/** One case of one task of a column, before the rows are split and pooled. */
interface CaseEntry {
  caseName: string
  cell: ComparisonCell
  /** Matrix values of the task (`{ task: displayName }` without a matrix). */
  values: Record<string, string>
}

/** One run of a matrix cell: its result, and the cases it ran (by `CaseNode.identity`). */
interface CellRun {
  cases: ReadonlySet<string>
  result: MatrixCell['latest']
}

interface Column {
  handles: RunHandle[]
  id: string
  label: string
}

/**
 * Matrix overview of the runs in scope: one cell per eval entry × run-matrix row × eval-matrix row.
 *
 * Use when:
 * - `GET /api/matrix` shows how every matrix combination did, across experiments and attempts
 *
 * Expects:
 * - each run with the task nodes it was listed with (built once per run by the caller), and its score definitions
 *
 * Returns:
 * - cells ordered by entry, then run row and eval row in natural order; `history` is every run with a task in the
 *   cell, oldest first, each with its coverage; `latest` is the newest run that covered the cell fully or is still
 *   running it, else the newest run. A run that settled every case it planned but over other cases than that run (a
 *   smoke or limited run, another case set) is `other`, not `full`: its score is not comparable. Tasks without a
 *   parsable matrix are skipped.
 *   Tasks of one run that share a cell (several inference executors) keep the last one in queue order.
 *   Each run is scored by its task's primary score (`score`, and `caseScores` per case by the rule of `scoreCases`),
 *   with its completion rate next to it.
 */
export function buildMatrix(runs: readonly { item: RunListItem, scoreDefinitions: ReadonlyMap<string, ScoreDefinition>, tasks: readonly TaskNode[] }[]): MatrixResponse {
  const oldestFirst = [...runs].sort((left, right) => (left.item.startedAt ?? '').localeCompare(right.item.startedAt ?? ''))
  // Runs of each cell, oldest first, with the cases each one ran; whether a run is `full` depends on the cases of the
  // cell's other runs, so it is settled after every run was read.
  const cells = new Map<string, { entryId: string, eval: Record<string, string>, evalRowId: string, run: Record<string, string>, runRowId: string, runs: CellRun[] }>()
  const runRows: Record<string, string>[] = []
  const evalRows: Record<string, string>[] = []
  // Newest definition of each score, since runs are read oldest first.
  const definitions = new Map<string, ScoreDefinition>()
  for (const { item, scoreDefinitions, tasks } of oldestFirst) {
    for (const [name, definition] of scoreDefinitions) {
      definitions.set(name, definition)
    }
    for (const task of tasks) {
      if (task.matrix == null || task.entryId == null) {
        continue
      }
      runRows.push(task.matrix.run)
      evalRows.push(task.matrix.eval)
      const primary = task.scoring.primary
      const taskDefinitions = countingDefinitions(task.scoring, scoreDefinitions)
      const result: MatrixCell['latest'] = {
        attemptId: item.attemptId,
        caseScores: task.cases.map((node) => {
          const round = node.rounds.at(-1)
          return primary == null || round == null ? null : countedScores(round, taskDefinitions)[primary] ?? null
        }),
        caseTotal: task.caseTotal,
        counts: task.caseCounts,
        coverage: coverageOf(task),
        experimentId: item.experimentId,
        runKey: item.runKey,
        scoring: task.scoring,
        startedAt: item.startedAt,
        state: task.state,
        taskId: task.id,
      }
      const cellRun = { cases: new Set(task.cases.map(node => node.identity)), result }
      // NUL cannot appear in decoded ids, so the joined key is unambiguous.
      const key = [task.entryId, task.matrix.runRowId, task.matrix.evalRowId].join('\0')
      const cell = cells.get(key)
      if (cell == null) {
        cells.set(key, { entryId: task.entryId, eval: task.matrix.eval, evalRowId: task.matrix.evalRowId, run: task.matrix.run, runRowId: task.matrix.runRowId, runs: [cellRun] })
        continue
      }
      // Runs are visited oldest first; a second task of the same run replaces its entry.
      if (cell.runs.at(-1)?.result.runKey === item.runKey) {
        cell.runs[cell.runs.length - 1] = cellRun
      }
      else {
        cell.runs.push(cellRun)
      }
    }
  }

  // Newest start of any run of each entry × run row: a cell whose runs all started before it is a configuration the
  // project moved away from (its eval axes changed since).
  const rowKey = (cell: { entryId: string, runRowId: string }) => [cell.entryId, cell.runRowId].join('\0')
  const newestOf = (list: readonly CellRun[]) => list.reduce((max, run) => ((run.result.startedAt ?? '') > max ? run.result.startedAt ?? '' : max), '')
  const rowNewest = new Map<string, string>()
  for (const cell of cells.values()) {
    const newest = newestOf(cell.runs)
    if (newest > (rowNewest.get(rowKey(cell)) ?? ''))
      rowNewest.set(rowKey(cell), newest)
  }

  const output = [...cells.values()].map(({ runs: cellRuns, ...cell }): MatrixCell => {
    // The cases the cell is scored over: those of the newest run that settled every case it planned, unless another
    // run covered more of the same cases (then it was a smoke or limited run). Runs over other cases, a subset or
    // another case set, keep their score in the history but are neither the headline nor a baseline.
    const reference = cellRuns.findLast(run => run.result.coverage === 'full' && !cellRuns.some(other => isStrictSubset(run.cases, other.cases)))
    const settled = cellRuns.map(({ cases, result }) => ({
      ...result,
      coverage: result.coverage === 'full' && (reference == null || !isSameSet(cases, reference.cases)) ? 'other' as const : result.coverage,
    }))
    // The headline is the newest full or running run; a partial run or one over other cases only stands in while
    // there is none.
    const latest = settled.findLast(run => run.coverage === 'full' || run.state === 'running' || run.state === 'queued') ?? settled.at(-1)!
    return {
      ...cell,
      caseCount: reference?.cases.size ?? Math.max(latest.counts.total, latest.caseTotal ?? 0),
      history: settled.map(run => ({
        attemptId: run.attemptId,
        completion: run.scoring.completion.mean,
        counts: run.counts,
        coverage: run.coverage,
        runKey: run.runKey,
        score: primaryMean(run.scoring),
        startedAt: run.startedAt,
        state: run.state,
      })),
      latest,
      superseded: newestOf(cellRuns) < (rowNewest.get(rowKey(cell)) ?? ''),
    }
  })
  return {
    axes: [
      ...Object.entries(axisValues(runRows)).map(([name, values]) => ({ kind: 'run' as const, name, values })),
      ...Object.entries(axisValues(evalRows)).map(([name, values]) => ({ kind: 'eval' as const, name, values })),
    ],
    cells: output.sort((left, right) =>
      left.entryId.localeCompare(right.entryId)
      || compareNatural(left.runRowId, right.runRowId)
      || compareNatural(left.evalRowId, right.evalRowId)),
    runCount: runs.length,
    scoreDefinitions: pickScoreDefinitions(definitions, output.flatMap(cell => cell.latest.scoring.scores.map(score => score.name))),
  }
}

/**
 * Case-level comparison of the runs (attempt labels) of one experiment, oldest first.
 */
export function compareAttempts(handles: readonly RunHandle[], filter: { experiment: string, project: string, workspace: string }, now: number): ComparisonResponse {
  const selected = sortByStart(handles.filter(handle => matches(handle, filter, now) && toRunListItem(handle, now).experimentId === filter.experiment), now)
  const columns = selected.map((handle) => {
    const item = toRunListItem(handle, now)
    return { handles: [handle], id: handle.runKey, label: `${item.attemptId} (${item.runId})` }
  })
  return buildComparison('attempts', columns, now)
}

/**
 * Case-level comparison of experiments: one column per experiment of a workspace/project, using the latest run
 * of each experiment (by start time).
 */
export function compareExperiments(handles: readonly RunHandle[], filter: { project: string, workspace: string }, now: number): ComparisonResponse {
  const selected = handles.filter(handle => matches(handle, filter, now))
  const byExperiment = Map.groupBy(selected, handle => toRunListItem(handle, now).experimentId)
  const columns = [...byExperiment].sort((left, right) => left[0].localeCompare(right[0])).map(([experimentId, list]) => ({
    handles: sortByStart(list, now),
    id: experimentId,
    label: experimentId,
  }))
  return buildComparison('experiments', columns, now)
}

/**
 * Case-level comparison of explicitly chosen runs, in the given order.
 */
export function compareRuns(handles: readonly RunHandle[], now: number): ComparisonResponse {
  return buildComparison('runs', handles.map((handle) => {
    const item = toRunListItem(handle, now)
    return { handles: [handle], id: handle.runKey, label: `${item.experimentId} / ${item.attemptId}` }
  }), now)
}

/**
 * Case rows of the columns; a row is `changed` when its state differs between columns, or, when every scored task
 * shares one primary score, the value the case counts with in it (a failed case counts 0).
 *
 * A row is one case name and variant. When a column ran a case of one name in several tasks (matrix rows such as
 * `context=none` and `context=home-assistant`), the rows are split by the matrix axes that tell those tasks apart and
 * that every column has, so the columns stay paired case by case. Tasks that differ only in an axis some column lacks
 * (`prompt` run by one workspace alone) are averaged into one cell, as the matrix view averages axes.
 */
function buildComparison(view: ComparisonResponse['view'], columns: readonly Column[], now: number): ComparisonResponse {
  const outputColumns: ComparisonResponse['columns'] = []
  const definitions = new Map<string, ScoreDefinition>()
  const metricDefinitions = new Map<string, MetricDefinition>()
  const primaries = new Set<string>()
  // Per column: one entry per case name and task configuration; a newer run replaces the entry of an older one.
  const entriesByColumn = new Map<string, Map<string, CaseEntry>>()
  for (const column of columns) {
    const runs: ComparedRun[] = column.handles.map((handle) => {
      const item = toRunListItem(handle, now)
      return {
        attemptId: item.attemptId,
        counts: item.counts,
        durationMs: item.startedAt != null && item.endedAt != null ? Date.parse(item.endedAt) - Date.parse(item.startedAt) : undefined,
        experimentId: item.experimentId,
        headline: item.headline,
        project: item.projectSegment,
        runKey: item.runKey,
        startedAt: item.startedAt,
        state: item.state,
        workspaceId: item.workspaceId,
      }
    })
    const scoreGraders: ScoreGraders = {}
    outputColumns.push({ id: column.id, label: column.label, runs, scoreGraders })
    const entries = new Map<string, CaseEntry>()
    entriesByColumn.set(column.id, entries)
    // Older runs first, so a newer run overwrites the cells of the same case.
    for (const handle of column.handles) {
      const reducer = handle.reducer()
      for (const [name, definition] of reducer.scoreDefinitions) {
        definitions.set(name, definition)
      }
      for (const task of buildTaskNodes(reducer, () => 0)) {
        for (const [name, graders] of Object.entries(task.scoreGraders)) {
          graders.forEach(grader => addScoreGrader(scoreGraders, name, grader))
        }
        if (task.scoring.primary != null) {
          primaries.add(task.scoring.primary)
        }
        const taskDefinitions = countingDefinitions(task.scoring, reducer.tasks.get(task.id)?.scoreDefinitions ?? new Map())
        // A task without a matrix is told apart from the others of its run by its name.
        const values = task.matrix == null ? { task: task.displayName } : { ...task.matrix.run, ...task.matrix.eval }
        const configuration = Object.entries(values).sort(([left], [right]) => compareNatural(left, right)).map(([key, value]) => `${key}=${value}`).join('&')
        for (const node of task.cases) {
          const round = node.rounds.at(-1)
          const metrics = numericMetrics(reducer.cases.get(node.key), round?.roundIndex)
          for (const name of Object.keys(metrics)) {
            const definition = reducer.metricDefinitions.get(name)
            if (definition != null)
              metricDefinitions.set(name, definition)
          }
          // NUL cannot appear in decoded names, so the joined key is unambiguous.
          entries.set([node.name, configuration].join('\0'), {
            caseName: node.name,
            cell: {
              counted: round == null ? {} : countedScores(round, taskDefinitions),
              ...(node.durationMs == null ? {} : { durationMs: node.durationMs }),
              metrics,
              roundCount: node.rounds.length,
              scores: node.scores,
              state: node.state,
            },
            values,
          })
        }
      }
    }
  }

  const keys = rowAxes([...entriesByColumn.values()].map(entries => [...entries.values()]))
  // Per case name and variant: the cells of each column, pooled below.
  const rows = new Map<string, { caseName: string, cells: Map<string, ComparisonCell[]>, variant?: string }>()
  for (const [columnId, entries] of entriesByColumn) {
    for (const entry of entries.values()) {
      const variant = keys.length === 0 ? undefined : keys.map(key => `${key}=${entry.values[key] ?? ''}`).join(', ')
      const rowKey = [entry.caseName, variant ?? ''].join('\0')
      const row = rows.get(rowKey) ?? { caseName: entry.caseName, cells: new Map(), ...(variant == null ? {} : { variant }) }
      row.cells.set(columnId, [...row.cells.get(columnId) ?? [], entry.cell])
      rows.set(rowKey, row)
    }
  }
  const primary = primaries.size === 1 ? [...primaries][0] : undefined
  const outputRows = [...rows.values()]
    .sort((left, right) => left.caseName.localeCompare(right.caseName) || compareNatural(left.variant ?? '', right.variant ?? ''))
    .map(({ cells: pooledCells, ...row }) => {
      const cells = Object.fromEntries([...pooledCells].map(([columnId, list]) => [columnId, poolCells(list)]))
      const values = Object.values(cells)
      const states = new Set(values.map(cell => cell.state))
      const scores = new Set(values.map(cell => primary == null ? null : cell.counted[primary] ?? null))
      return { ...row, cells, changed: values.length > 1 && (states.size > 1 || scores.size > 1) }
    })
  return {
    columns: outputColumns,
    metricDefinitions: [...metricDefinitions.values()],
    ...(primary == null ? {} : { primary }),
    rows: outputRows,
    scoreDefinitions: [...definitions.values()],
    summary: { changed: outputRows.filter(row => row.changed).length, rows: outputRows.length },
    view,
  }
}

/**
 * Matrix axes the comparison rows are split by: the axes that tell apart two tasks of one column that ran a case of
 * the same name, kept only when every case of every column has the axis. An axis only some columns run cannot pair
 * the columns, so it is averaged inside the columns that have it.
 */
function rowAxes(columns: readonly (readonly CaseEntry[])[]): string[] {
  const differing = new Set<string>()
  for (const entries of columns) {
    const byName = new Map<string, CaseEntry[]>()
    for (const entry of entries) {
      byName.set(entry.caseName, [...byName.get(entry.caseName) ?? [], entry])
    }
    for (const list of byName.values()) {
      for (const key of new Set(list.flatMap(entry => Object.keys(entry.values)))) {
        if (new Set(list.map(entry => entry.values[key])).size > 1)
          differing.add(key)
      }
    }
  }
  return [...differing].filter(key => columns.every(entries => entries.every(entry => key in entry.values))).sort(compareNatural)
}

/** States of pooled cells, the one that most needs attention first: a pooled cell shows the worst of its cases. */
const STATE_SEVERITY: readonly ComparisonCell['state'][] = ['errored', 'timeout', 'failed', 'unfinished', 'running', 'requeued', 'skipped', 'passed']

/**
 * How much of its task a run measured (see `cellCoverageSchema`): cases with a result are `passed` and `failed`;
 * every expected case must have settled for `full`. Whether a full run ran the cell's cases or `other` ones depends on
 * the cell's other runs, so {@link buildMatrix} decides that.
 */
function coverageOf(task: TaskNode): CellCoverage {
  const { errored, failed, passed, skipped, timeout, total } = task.caseCounts
  if (passed + failed === 0) {
    return 'none'
  }
  const expected = Math.max(total, task.caseTotal ?? 0)
  return passed + failed + errored + skipped + timeout >= expected ? 'full' : 'partial'
}

function isSameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every(key => right.has(key))
}

function isStrictSubset(inner: ReadonlySet<string>, outer: ReadonlySet<string>): boolean {
  return inner.size < outer.size && [...inner].every(key => outer.has(key))
}

function matches(handle: RunHandle, filter: { project: string, workspace: string }, now: number): boolean {
  // A run written by an older vieval cannot be read, so it is no column.
  if (handle.unsupportedVersion() != null) {
    return false
  }
  const item = toRunListItem(handle, now)
  return item.workspaceId === filter.workspace && (item.projectSegment === filter.project || item.projectIds.includes(filter.project))
}

/** Last finite number each metric recorded for the case in the given round (or without a round). */
function numericMetrics(reduced: ReducedCase | undefined, roundIndex: number | undefined): Record<string, number> {
  const values: Record<string, number> = {}
  for (const entry of reduced?.metrics ?? []) {
    if (entry.roundIndex != null && roundIndex != null && entry.roundIndex !== roundIndex)
      continue
    if (typeof entry.value === 'number' && Number.isFinite(entry.value))
      values[entry.name] = entry.value
  }
  return values
}

/**
 * One cell from the cells of tasks averaged into it: the mean of every score, metric, and duration over the cells that
 * have it, and the worst state.
 */
function poolCells(cells: readonly ComparisonCell[]): ComparisonCell {
  if (cells.length === 1)
    return cells[0]!
  const mean = (records: readonly Record<string, number>[]) => {
    const sums = new Map<string, { n: number, sum: number }>()
    for (const record of records) {
      for (const [name, value] of Object.entries(record)) {
        const current = sums.get(name) ?? { n: 0, sum: 0 }
        sums.set(name, { n: current.n + 1, sum: current.sum + value })
      }
    }
    return Object.fromEntries([...sums].map(([name, { n, sum }]) => [name, sum / n]))
  }
  const durations = cells.flatMap(cell => cell.durationMs == null ? [] : [cell.durationMs])
  return {
    counted: mean(cells.map(cell => cell.counted)),
    ...(durations.length === 0 ? {} : { durationMs: durations.reduce((sum, value) => sum + value, 0) / durations.length }),
    metrics: mean(cells.map(cell => cell.metrics)),
    pooled: cells.length,
    roundCount: Math.max(...cells.map(cell => cell.roundCount)),
    scores: { unscored: Object.assign({}, ...cells.map(cell => cell.scores.unscored)), values: mean(cells.map(cell => cell.scores.values)) },
    state: STATE_SEVERITY.find(state => cells.some(cell => cell.state === state)) ?? cells[0]!.state,
  }
}

function primaryMean(scoring: TaskNode['scoring']): null | number {
  return scoring.scores.find(score => score.name === scoring.primary)?.mean ?? null
}

function sortByStart(list: readonly RunHandle[], now: number): RunHandle[] {
  // `toRunListItem` rebuilds every task node of a run; compute each start time once, not once per comparison.
  const startedAt = new Map(list.map(handle => [handle, toRunListItem(handle, now).startedAt ?? '']))
  return [...list].sort((left, right) => startedAt.get(left)!.localeCompare(startedAt.get(right)!))
}
