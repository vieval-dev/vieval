import type { CellCoverage, ComparedRun, ComparisonCell, ComparisonResponse, MatrixCell, MatrixResponse, RunListItem, TaskNode } from '../shared/contract'
import type { RunHandle } from './store'

import { axisValues, buildTaskNodes, compareNatural } from '../shared/reduce'
import { toRunListItem } from './store'

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
 *   running it, else the newest run. Tasks without a parsable matrix are skipped. Tasks of one run that share a cell
 *   (several inference executors) keep the last one in queue order.
 */
export function buildMatrix(runs: readonly { item: RunListItem, tasks: readonly TaskNode[] }[]): MatrixResponse {
  const oldestFirst = [...runs].sort((left, right) => (left.item.startedAt ?? '').localeCompare(right.item.startedAt ?? ''))
  const cells = new Map<string, MatrixCell>()
  // Whether the cell's `latest` is a headline run (full or running); a partial run only fills an empty headline.
  const headline = new Map<string, boolean>()
  const runRows: Record<string, string>[] = []
  const evalRows: Record<string, string>[] = []
  for (const { item, tasks } of oldestFirst) {
    for (const task of tasks) {
      if (task.matrix == null || task.entryId == null) {
        continue
      }
      runRows.push(task.matrix.run)
      evalRows.push(task.matrix.eval)
      const coverage = coverageOf(task)
      const point = { attemptId: item.attemptId, counts: task.caseCounts, coverage, exact: task.scores.exact, runKey: item.runKey, startedAt: item.startedAt, state: task.state }
      const latest: MatrixCell['latest'] = {
        attemptId: item.attemptId,
        caseTotal: task.caseTotal,
        counts: task.caseCounts,
        coverage,
        exact: task.scores.exact,
        experimentId: item.experimentId,
        judge: task.scores.judge,
        runKey: item.runKey,
        startedAt: item.startedAt,
        state: task.state,
        taskId: task.id,
      }
      const isHeadline = coverage === 'full' || task.state === 'running' || task.state === 'queued'
      // NUL cannot appear in decoded ids, so the joined key is unambiguous.
      const key = [task.entryId, task.matrix.runRowId, task.matrix.evalRowId].join('\0')
      const cell = cells.get(key)
      if (cell == null) {
        cells.set(key, { entryId: task.entryId, eval: task.matrix.eval, evalRowId: task.matrix.evalRowId, history: [point], latest, run: task.matrix.run, runRowId: task.matrix.runRowId })
        headline.set(key, isHeadline)
        continue
      }
      // Runs are visited oldest first; a second task of the same run replaces its point (and its headline).
      const sameRun = cell.history.at(-1)?.runKey === item.runKey
      if (sameRun) {
        cell.history[cell.history.length - 1] = point
      }
      else {
        cell.history.push(point)
      }
      if (isHeadline || sameRun || headline.get(key) !== true) {
        cell.latest = latest
        headline.set(key, isHeadline)
      }
    }
  }
  return {
    axes: [
      ...Object.entries(axisValues(runRows)).map(([name, values]) => ({ kind: 'run' as const, name, values })),
      ...Object.entries(axisValues(evalRows)).map(([name, values]) => ({ kind: 'eval' as const, name, values })),
    ],
    cells: [...cells.values()].sort((left, right) =>
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
 * every expected case must have settled for `full`.
 */
function coverageOf(task: TaskNode): CellCoverage {
  const { errored, failed, passed, skipped, timeout, total } = task.caseCounts
  if (passed + failed === 0) {
    return 'none'
  }
  const expected = Math.max(total, task.caseTotal ?? 0)
  return passed + failed + errored + skipped + timeout >= expected ? 'full' : 'partial'
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
