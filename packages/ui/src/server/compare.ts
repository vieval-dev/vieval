import type { CellCoverage, ComparedRun, ComparisonCell, ComparisonResponse, MatrixCell, MatrixResponse, RunListItem, TaskNode } from '../shared/contract'
import type { RunHandle } from './store'

import { axisValues, buildTaskNodes, compareNatural } from '../shared/reduce'
import { toRunListItem } from './store'

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
 * - each run with the task nodes it was listed with (built once per run by the caller)
 *
 * Returns:
 * - cells ordered by entry, then run row and eval row in natural order; `history` is every run with a task in the
 *   cell, oldest first, each with its coverage; `latest` is the newest run that covered the cell fully or is still
 *   running it, else the newest run. A run that settled every case it planned but over other cases than that run (a
 *   smoke or limited run, another case set) is `other`, not `full`: its score is not comparable. Tasks without a
 *   parsable matrix are skipped.
 *   Tasks of one run that share a cell (several inference executors) keep the last one in queue order.
 */
export function buildMatrix(runs: readonly { item: RunListItem, tasks: readonly TaskNode[] }[]): MatrixResponse {
  const oldestFirst = [...runs].sort((left, right) => (left.item.startedAt ?? '').localeCompare(right.item.startedAt ?? ''))
  // Runs of each cell, oldest first, with the cases each one ran; whether a run is `full` depends on the cases of the
  // cell's other runs, so it is settled after every run was read.
  const cells = new Map<string, { entryId: string, eval: Record<string, string>, evalRowId: string, run: Record<string, string>, runRowId: string, runs: CellRun[] }>()
  const runRows: Record<string, string>[] = []
  const evalRows: Record<string, string>[] = []
  for (const { item, tasks } of oldestFirst) {
    for (const task of tasks) {
      if (task.matrix == null || task.entryId == null) {
        continue
      }
      runRows.push(task.matrix.run)
      evalRows.push(task.matrix.eval)
      const result: MatrixCell['latest'] = {
        attemptId: item.attemptId,
        caseScores: task.cases.map(node => node.scores.exact ?? null),
        caseTotal: task.caseTotal,
        counts: task.caseCounts,
        coverage: coverageOf(task),
        exact: task.scores.exact,
        experimentId: item.experimentId,
        judge: task.scores.judge,
        runKey: item.runKey,
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
      history: settled.map(run => ({ attemptId: run.attemptId, counts: run.counts, coverage: run.coverage, exact: run.exact, runKey: run.runKey, startedAt: run.startedAt, state: run.state })),
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

function buildComparison(view: ComparisonResponse['view'], columns: readonly Column[], now: number): ComparisonResponse {
  const rows = new Map<string, Record<string, ComparisonCell>>()
  const outputColumns: ComparisonResponse['columns'] = []
  for (const column of columns) {
    const runs: ComparedRun[] = column.handles.map((handle) => {
      const item = toRunListItem(handle, now)
      return {
        attemptId: item.attemptId,
        counts: item.counts,
        durationMs: item.startedAt != null && item.endedAt != null ? Date.parse(item.endedAt) - Date.parse(item.startedAt) : undefined,
        exactAverage: item.exactAverage,
        experimentId: item.experimentId,
        hybridAverage: item.hybridAverage,
        judgeAverage: item.judgeAverage,
        runKey: item.runKey,
        startedAt: item.startedAt,
        state: item.state,
      }
    })
    outputColumns.push({ id: column.id, label: column.label, runs })
    // Older runs first, so a newer run overwrites the cells of the same case.
    for (const handle of column.handles) {
      for (const task of buildTaskNodes(handle.reducer(), () => 0)) {
        for (const node of task.cases) {
          const cells = rows.get(node.name) ?? {}
          cells[column.id] = { exact: node.scores.exact, judge: node.scores.judge, roundCount: node.rounds.length, state: node.state }
          rows.set(node.name, cells)
        }
      }
    }
  }
  const outputRows = [...rows].sort((left, right) => left[0].localeCompare(right[0])).map(([caseName, cells]) => {
    const values = Object.values(cells)
    const states = new Set(values.map(cell => cell.state))
    const scores = new Set(values.map(cell => cell.exact ?? (cell.state === 'passed' ? 1 : 0)))
    return { caseName, cells, changed: values.length > 1 && (states.size > 1 || scores.size > 1) }
  })
  return {
    columns: outputColumns,
    rows: outputRows,
    summary: { changed: outputRows.filter(row => row.changed).length, rows: outputRows.length },
    view,
  }
}

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
  const item = toRunListItem(handle, now)
  return item.workspaceId === filter.workspace && (item.projectSegment === filter.project || item.projectIds.includes(filter.project))
}

function sortByStart(list: readonly RunHandle[], now: number): RunHandle[] {
  // `toRunListItem` rebuilds every task node of a run; compute each start time once, not once per comparison.
  const startedAt = new Map(list.map(handle => [handle, toRunListItem(handle, now).startedAt ?? '']))
  return [...list].sort((left, right) => startedAt.get(left)!.localeCompare(startedAt.get(right)!))
}
