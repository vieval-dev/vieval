import type { CaseScoring, MatrixCell, MatrixResponse, ScoreSummary } from '../../src/shared/contract'

import { headlineOf, headlineValue } from './scores'

/**
 * Cases a cell has settled out of the cases it should have: the ring of a card always, and the mark of an incomplete
 * compact cell (`GridCell.completion`).
 */
export interface CellCompletion {
  /** Cases that ended without a result (`errored`, `timeout`). */
  errored: number
  /** Cases the cell should have: the entry's usual case count, times the averaged repeats. */
  expected: number
  /** Cases with a wrong result (a failed assertion), part of `scored`. */
  failed: number
  running: boolean
  /** Cases with a result (passed or failed). */
  scored: number
}

/** One shown cell: a matrix cell, or the pool of the cells that differ only in averaged axes. */
export interface GridCell {
  /** Primary score of every case of every member, for the spread under the mean. */
  caseScores: (null | number)[]
  /** Present when the cell is incomplete; such a cell stays out of the best mark, the means, and the color scale. */
  completion?: CellCompletion
  /** Matrix cells behind this one, in axis order: one, or one per averaged value that ran. */
  members: MatrixCell[]
  /** Cases settled out of the cases expected, complete or not: the ring of the cell's card. */
  progress: CellCompletion
  /** Scores of the members pooled (sums and counts added), so the headline reads the same as one run's. */
  scoring: CaseScoring
  /** Standard error of `value` from the spread of the case scores; `null` with fewer than two cases. */
  se: null | number
  /** Headline value (primary score mean, or the passed share without one); `null` without a result. */
  value: null | number
}

/**
 * One axis of an entry's matrix: a run-matrix or eval-matrix axis with the values its cells have, in API order.
 * A cell without the axis (it ran before the axis was added, or after it was dropped) has the value `''`.
 */
export interface MatrixAxis {
  /** `run.<name>` or `eval.<name>`, so equal names of the two kinds cannot collide. */
  key: string
  name: string
  values: string[]
}

/** A grid of one entry laid out by a {@link MatrixLayout}. */
export interface MatrixGrid {
  /** `cells[row][column]`; `undefined` where the combination never ran. */
  cells: (GridCell | undefined)[][]
  columns: Record<string, string>[]
  layout: MatrixLayout
  rows: Record<string, string>[]
}

/** Where the varying axes of a grid go; every axis key is in exactly one list. */
export interface MatrixLayout {
  /** Axes pooled into one cell (repeats such as `seed`); the cell shows the pooled score of every value. */
  averaged: string[]
  /** Axes across the top, outermost header level first. */
  columns: string[]
  /** Axes down the side, outermost group first. */
  rows: string[]
}

/** Axes whose name says they repeat one configuration; they are averaged by default instead of laid out. */
const REPEAT_AXIS = /^(?:attempt|repeat|replicate|run|sample|seed|trial)s?$/

/**
 * The configuration cells are compared to, as a value for some axes (axis key → value). An axis left out keeps the
 * cell's own value: `{ 'run.method': 'text' }` compares every cell to its `text` twin, and a value for every axis
 * compares every cell to one fixed configuration.
 */
export type Baseline = Readonly<Record<string, string>>

/** A cell measured against its baseline cell (the cell with the baseline's values and its own for the other axes). */
export interface CellComparison {
  base: GridCell
  /** Whether the gap is beyond noise ({@link differs}). */
  clear: boolean
  /** `value - base.value`. */
  delta: number
}

/** Sizes the layout chooser needs, in pixels. */
export interface LayoutSpace {
  /** Width of the table's scroll box. */
  available: number
  /** Width of one cell. */
  cellWidth: number
  /** Width of a column's header text (an axis value). */
  textWidth: (text: string) => number
}

/**
 * Mean headline of every value of every axis over an entry's settled cells: the main effect of each value, as the
 * table's margins show it, before any averaging or layout.
 *
 * Use when:
 * - a picker of axes or values says how each one scores (the baseline and average menus)
 *
 * Returns:
 * - axis key → value → mean; `null` for a value without a settled cell
 */
export function axisMeans(cells: readonly MatrixCell[], axes: readonly MatrixAxis[]): Map<string, Map<string, null | number>> {
  const typical = typicalCaseCount(cells)
  const settled = cells
    .map(cell => ({ coordinates: cellCoordinates(cell), grid: gridCell([cell], typical, 1) }))
    .filter((item): item is { coordinates: Record<string, string>, grid: GridCell & { value: number } } => isSettled(item.grid))
  return new Map(axes.map(axis => [axis.key, new Map(axis.values.map(value => [
    value,
    meanOf(settled.filter(item => (item.coordinates[axis.key] ?? '') === value).map(item => item.grid.value)),
  ]))]))
}

/**
 * Row order that puts the best rows first: outer row groups by their mean, rows inside a group by theirs. Rows
 * without a value go last.
 */
export function bestRowsFirst(grid: MatrixGrid, rowValues: readonly (null | number)[]): number[] {
  const outer = grid.layout.rows[0]
  const order = grid.rows.map((_, index) => index)
  const groupMean = new Map<string, null | number>()
  if (outer != null && grid.layout.rows.length > 1) {
    for (const value of new Set(grid.rows.map(row => row[outer] ?? '')))
      groupMean.set(value, meanOf(order.filter(index => grid.rows[index]![outer] === value).map(index => rowValues[index]).filter(value => value != null)))
  }
  const rank = (value: null | number | undefined) => value ?? Number.NEGATIVE_INFINITY
  return order.toSorted((a, b) => {
    const group = outer == null || grid.layout.rows.length < 2 ? 0 : rank(groupMean.get(grid.rows[b]![outer]!)) - rank(groupMean.get(grid.rows[a]![outer]!))
    return group || rank(rowValues[b]) - rank(rowValues[a]) || a - b
  })
}

/**
 * Lays an entry's cells out as a grid.
 *
 * Use when:
 * - the matrix view shows one entry, after its layout is chosen
 *
 * Expects:
 * - `layout` covers every varying axis of `axes`; cells whose coordinates miss an axis sit at its `''` value
 *
 * Returns:
 * - rows and columns as every combination of their axes' values (empty combinations stay as gaps, so the grid keeps
 *   its structure); a cell pools the cells that differ only in averaged axes
 */
export function buildGrid(cells: readonly MatrixCell[], axes: readonly MatrixAxis[], layout: MatrixLayout): MatrixGrid {
  const byKey = new Map(axes.map(axis => [axis.key, axis]))
  const combinations = (keys: readonly string[]) => keys.reduce<Record<string, string>[]>(
    (list, key) => list.flatMap(combination => byKey.get(key)!.values.map(value => ({ ...combination, [key]: value }))),
    [{}],
  )
  const laidOut = [...layout.rows, ...layout.columns]
  const slot = (coordinates: Record<string, string>) => laidOut.map(key => coordinates[key] ?? '').join('\u0000')
  const groups = new Map<string, MatrixCell[]>()
  for (const cell of cells) {
    const key = slot(cellCoordinates(cell))
    groups.set(key, [...(groups.get(key) ?? []), cell])
  }
  const expectedMembers = layout.averaged.reduce((count, key) => count * (byKey.get(key)?.values.length ?? 1), 1)
  const typical = typicalCaseCount(cells)
  const rows = combinations(layout.rows)
  const columns = combinations(layout.columns)
  return {
    cells: rows.map(row => columns.map((column) => {
      const members = groups.get(slot({ ...row, ...column }))
      return members == null ? undefined : gridCell(members, typical, expectedMembers)
    })),
    columns,
    layout,
    rows,
  }
}

/** Values of one cell along every axis, `run.` and `eval.` prefixed. */
export function cellCoordinates(cell: MatrixCell): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(cell.run).map(([axis, value]) => [`run.${axis}`, value])),
    ...Object.fromEntries(Object.entries(cell.eval).map(([axis, value]) => [`eval.${axis}`, value])),
  }
}

/**
 * Lays the axes out so the columns fill one screen width and the rows run long: vertical scrolling is cheap,
 * horizontal scrolling loses the row labels.
 *
 * Use when:
 * - a grid is shown with an automatic layout, for its cell size and the room it has
 *
 * Expects:
 * - `averaged` keys are left out of the layout
 *
 * Returns:
 * - whether the chosen layout fits the width, and the layout: among the column sets that fit, the one nearest 1.2 rows
 *   per column (a little taller than square); without one
 *   that fits (a phone), the narrowest. Header levels go from the axis with the fewest values outward, row
 *   groups from the one with the most.
 */
export function chooseLayout(axes: readonly MatrixAxis[], averaged: readonly string[], space: LayoutSpace): { fits: boolean, layout: MatrixLayout } {
  const free = axes.filter(axis => !averaged.includes(axis.key))
  const product = (list: readonly MatrixAxis[]) => list.reduce((count, axis) => count * axis.values.length, 1)
  const labelOf = (value: string) => value === '' ? '—' : value
  const widest = (axis: MatrixAxis) => Math.max(...axis.values.map(value => space.textWidth(labelOf(value))))
  // NOTICE: the row header is about as wide as its widest value plus the cell padding; 24 px matches the `th` padding.
  const rowWidth = (list: readonly MatrixAxis[]) => list.reduce((width, axis) => width + widest(axis) + 24, 0)
  let best: undefined | { columns: MatrixAxis[], fits: boolean, rows: MatrixAxis[], score: number }
  // Every split of the axes into rows and columns (both may not be empty unless there is a single axis).
  for (let mask = 1; mask < 2 ** free.length; mask++) {
    const columns = free.filter((_, index) => mask & (2 ** index))
    const rows = free.filter((_, index) => !(mask & (2 ** index)))
    if (rows.length === 0 && free.length > 1)
      continue
    const inner = columns.toSorted((a, b) => a.values.length - b.values.length).at(-1)!
    const columnWidth = Math.max(space.cellWidth, widest(inner) + 12)
    const used = product(columns) * columnWidth + rowWidth(rows)
    const fits = used <= space.available
    // Between equally shaped layouts, the narrower one wins: long labels (model names) then go down the side, where
    // they cost one header column instead of widening every column.
    const score = fits ? 1000 - Math.abs(Math.log(product(rows) / product(columns)) - Math.log(1.2)) * 100 - used / space.available * 20 : -used
    if (best == null || score > best.score)
      best = { columns, fits, rows, score }
  }
  return {
    // No axis to lay out (one cell, or everything averaged) fits anywhere.
    fits: best?.fits ?? true,
    layout: {
      averaged: [...averaged],
      columns: (best?.columns ?? free).toSorted((a, b) => a.values.length - b.values.length).map(axis => axis.key),
      rows: (best?.rows ?? []).toSorted((a, b) => b.values.length - a.values.length).map(axis => axis.key),
    },
  }
}

/**
 * Compares every cell of a grid to its baseline cell: the cell with the baseline's values on the baseline axes and the
 * cell's own values on the others.
 *
 * Use when:
 * - the reader picks a baseline (`method = text`, or `method = text` and `view = online`) to see what every other
 *   value changes
 *
 * Expects:
 * - `baseline` names axes laid out in the grid; other axes are ignored
 *
 * Returns:
 * - `'base'` for the baseline's own cells; a comparison when both cells settled; `undefined` otherwise (no pair)
 */
export function compareToBaseline(grid: MatrixGrid, baseline: Baseline): ('base' | CellComparison | undefined)[][] {
  const keyOf = (coordinates: Record<string, string>) => [...grid.layout.rows, ...grid.layout.columns].map(key => coordinates[key] ?? '').join('\u0000')
  const index = new Map<string, GridCell | undefined>()
  grid.rows.forEach((row, r) => grid.columns.forEach((column, c) => index.set(keyOf({ ...row, ...column }), grid.cells[r]![c])))
  const laidOut = new Set([...grid.layout.rows, ...grid.layout.columns])
  const fixed = Object.fromEntries(Object.entries(baseline).filter(([key]) => laidOut.has(key)))
  return grid.rows.map((row, r) => grid.columns.map((column, c) => {
    const coordinates = { ...row, ...column }
    if (Object.entries(fixed).every(([key, value]) => coordinates[key] === value))
      return 'base'
    const cell = grid.cells[r]![c]
    const base = index.get(keyOf({ ...coordinates, ...fixed }))
    if (!isSettled(cell) || !isSettled(base))
      return undefined
    return { base, clear: differs(cell, base), delta: cell.value - base.value }
  }))
}

/** Axes averaged by default: the varying axes named like a repeat (`seed`, `repeat`, …). */
export function defaultAveraged(axes: readonly MatrixAxis[]): string[] {
  return axes.filter(axis => REPEAT_AXIS.test(axis.name)).map(axis => axis.key)
}

/**
 * Whether two cells' headlines differ beyond noise: their gap exceeds 1.96 standard errors of the difference (about
 * 95 %, a two-sided z test).
 *
 * NOTICE:
 * The test treats the two cells as independent samples. Cells of one entry usually ran the same cases, where a paired
 * test (per-case differences) is much tighter; it needs case identities, which `GET /api/matrix` does not send yet.
 * Removal condition: the matrix API reports paired statistics, and this compares through them.
 */
export function differs(a: GridCell, b: GridCell): boolean {
  if (a.value == null || b.value == null || a.se == null || b.se == null)
    return false
  const se = Math.sqrt(a.se ** 2 + b.se ** 2)
  return se === 0 ? a.value !== b.value : Math.abs(a.value - b.value) > 1.96 * se
}

/**
 * Whether a cell counts toward the best mark, the means, and the color scale: every case it should have ended (with a
 * result or without one) and nothing still runs. A cell with errored cases still counts; its ring says how many.
 */
export function isSettled(cell: GridCell | undefined): cell is GridCell & { value: number } {
  if (cell == null || cell.value == null)
    return false
  const completion = cell.completion
  return completion == null || (!completion.running && completion.scored + completion.errored >= completion.expected)
}

/**
 * Axes of an entry's cells split into the ones that vary and the ones every cell shares.
 *
 * Use when:
 * - a grid is built for one entry: varying axes are laid out, shared ones are said once above the table
 *
 * Returns:
 * - `varying` in API axis order with values in API order; `shared` as `{ name, value }` for the title
 */
export function matrixAxes(cells: readonly MatrixCell[], response: Pick<MatrixResponse, 'axes'>): { shared: { name: string, value: string }[], varying: MatrixAxis[] } {
  const order = response.axes.map(axis => ({ key: `${axis.kind}.${axis.name}`, name: axis.name, values: axis.values }))
  const coordinates = cells.map(cellCoordinates)
  const shared: { name: string, value: string }[] = []
  const varying: MatrixAxis[] = []
  for (const axis of order) {
    const seen = new Set(coordinates.map(coordinate => coordinate[axis.key] ?? ''))
    if (seen.size === 1 && seen.has(''))
      continue
    const values = [...axis.values.filter(value => seen.has(value)), ...(seen.has('') ? [''] : [])]
    if (values.length === 1)
      shared.push({ name: axis.name, value: values[0]! })
    else
      varying.push({ key: axis.key, name: axis.name, values })
  }
  return { shared, varying }
}

/** Mean of the values, `null` for none. */
export function meanOf(values: readonly number[]): null | number {
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length
}

/** The usual case count of an entry's cells (the most common `caseCount`): what a complete cell has. */
export function typicalCaseCount(cells: readonly MatrixCell[]): number {
  const counts = new Map<number, number>()
  for (const cell of cells)
    counts.set(cell.caseCount, (counts.get(cell.caseCount) ?? 0) + 1)
  return [...counts.entries()].toSorted((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0
}

function gridCell(members: MatrixCell[], typical: number, expectedMembers: number): GridCell {
  const scoring = members.length === 1 ? members[0]!.latest.scoring : poolScoring(members.map(member => member.latest.scoring))
  const caseScores = members.flatMap(member => member.latest.caseScores)
  const value = headlineValue(headlineOf(scoring))
  const { incomplete, progress } = progressOf(members, typical, expectedMembers)
  return { caseScores, completion: incomplete ? progress : undefined, members, progress, scoring, se: standardError(caseScores, value, scoring), value }
}

/** Adds up score summaries of the same names (`mean` recomputed from the sums). */
function poolScoring(list: readonly CaseScoring[]): CaseScoring {
  const pool = (summaries: ScoreSummary[]): ScoreSummary => {
    const n = summaries.reduce((total, summary) => total + summary.n, 0)
    const sum = summaries.reduce((total, summary) => total + summary.sum, 0)
    const unscored: Record<string, number> = {}
    for (const summary of summaries) {
      for (const [reason, count] of Object.entries(summary.unscored))
        unscored[reason] = (unscored[reason] ?? 0) + count
    }
    return { mean: n === 0 ? null : sum / n, n, name: summaries[0]!.name, sum, total: summaries.reduce((total, summary) => total + summary.total, 0), unscored }
  }
  const names = [...new Set(list.flatMap(scoring => scoring.scores.map(summary => summary.name)))]
  return {
    completion: pool(list.map(scoring => scoring.completion)),
    passed: pool(list.map(scoring => scoring.passed)),
    primary: list[0]!.primary,
    scores: names.map(name => pool(list.flatMap(scoring => scoring.scores.filter(summary => summary.name === name)))),
  }
}

/**
 * Progress of a cell against what a complete cell of its entry has, and whether it falls short. A rerun of one case
 * therefore reads as 1 of 60 instead of 1 of 1, and an averaged cell missing one repeat as 2 of 3 repeats' cases.
 */
function progressOf(members: readonly MatrixCell[], typical: number, expectedMembers: number): { incomplete: boolean, progress: CellCompletion } {
  const sum = (pick: (member: MatrixCell) => number) => members.reduce((total, member) => total + pick(member), 0)
  const failed = sum(member => member.latest.counts.failed)
  const scored = sum(member => member.latest.counts.passed) + failed
  const errored = sum(member => member.latest.counts.errored + member.latest.counts.timeout)
  const expected = Math.max(typical * expectedMembers, sum(member => Math.max(member.caseCount, member.latest.caseTotal ?? 0)))
  const running = members.some(member => member.latest.state === 'running' || member.latest.state === 'queued')
  const partial = members.some(member => member.latest.coverage === 'partial' || member.latest.coverage === 'none')
  return { incomplete: scored < expected || running || partial, progress: { errored, expected, failed, running, scored } }
}

/**
 * Standard error of a cell's headline: the sample standard deviation of its case scores over √n. Without case scores
 * (a headline of passed cases), the binomial error of the passed share.
 */
function standardError(caseScores: readonly (null | number)[], value: null | number, scoring: CaseScoring): null | number {
  const values = caseScores.filter((score): score is number => score != null && Number.isFinite(score))
  if (values.length >= 2) {
    const mean = values.reduce((total, score) => total + score, 0) / values.length
    const variance = values.reduce((total, score) => total + (score - mean) ** 2, 0) / (values.length - 1)
    return Math.sqrt(variance / values.length)
  }
  const n = scoring.passed.n
  return value == null || scoring.primary != null || n < 2 ? null : Math.sqrt(value * (1 - value) / n)
}
