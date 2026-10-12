<script setup lang="ts">
import type { MatrixCell, MatrixResponse } from '../../../src/shared/contract'

import { computed } from 'vue'

import CountsBar from './CountsBar.vue'
import Sparkline from './Sparkline.vue'
import StateBadge from './StateBadge.vue'
import StateView from './StateView.vue'

import { api } from '../api'
import { useResource } from '../composables/useResource'
import { formatScore, shortTaskId } from '../format'
import { attemptLabel } from '../labels'
import { href } from '../router'

/**
 * Matrix of a project or experiment (`GET /api/matrix`): one grid per eval entry, rows along the run axis with the
 * most values (for example `model`), columns for the combinations of the other axes (for example `repeat`). A cell
 * is the newest run of that combination, with the trend of every run before it.
 */
const props = defineProps<{ experiment?: string, project: string, workspace: string }>()

const matrix = useResource(() => ({ experiment: props.experiment, project: props.project, workspace: props.workspace }), scope => api.matrix(scope))

/** Values of one cell along every axis, `run.` and `eval.` prefixed so equal axis names cannot collide. */
function coordinates(cell: MatrixCell): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(cell.run).map(([axis, value]) => [`run.${axis}`, value])),
    ...Object.fromEntries(Object.entries(cell.eval).map(([axis, value]) => [`eval.${axis}`, value])),
  }
}
const axisName = (key: string) => key.replace(/^(?:run|eval)\./, '')

interface Grid {
  columns: { key: string, label: string }[]
  entryId: string
  name: string
  rowAxis: string | undefined
  /** One row per value of `rowAxis`; `cells` line up with `columns` (`undefined`: combination never ran). */
  rows: { cells: (MatrixCell | undefined)[], key: string, label: string }[]
}

function buildGrid(entryId: string, cells: MatrixCell[], response: MatrixResponse): Grid {
  // Axis values in the order the API sorted them.
  const order = new Map(response.axes.map(axis => [`${axis.kind}.${axis.name}`, axis.values]))
  const keys = [...new Set(cells.flatMap(cell => Object.keys(coordinates(cell))))]
  const distinct = (key: string) => new Set(cells.map(cell => coordinates(cell)[key] ?? '')).size
  // Rows along the run axis with the most values; every other axis forms the columns.
  const rowAxis = keys.filter(key => key.startsWith('run.')).toSorted((a, b) => distinct(b) - distinct(a))[0]
  // Single-valued axes stay in the column label (for example `model gpt-5.5`), so a lone column still says what it is.
  const columnAxes = keys.filter(key => key !== rowAxis)
  const sortValues = (key: string, values: string[]) => {
    const known = order.get(key) ?? []
    return values.toSorted((a, b) => known.indexOf(a) - known.indexOf(b))
  }
  const columnKey = (cell: MatrixCell) => columnAxes.map(key => `${axisName(key)} ${coordinates(cell)[key] ?? '—'}`).join(' · ')
  const rowKey = (cell: MatrixCell) => (rowAxis == null ? '' : coordinates(cell)[rowAxis] ?? '—')

  const columns = [...new Set(cells.map(columnKey))].map(key => ({ key, label: key === '' ? 'all' : key }))
  // Column order follows the axis order of the API (numeric for `repeat`), not the order cells arrived in.
  columns.sort((a, b) => {
    const cellA = cells.find(cell => columnKey(cell) === a.key)!
    const cellB = cells.find(cell => columnKey(cell) === b.key)!
    for (const key of columnAxes) {
      const known = order.get(key) ?? []
      const difference = known.indexOf(coordinates(cellA)[key] ?? '') - known.indexOf(coordinates(cellB)[key] ?? '')
      if (difference !== 0)
        return difference
    }
    return 0
  })
  const rowValues = rowAxis == null ? [''] : sortValues(rowAxis, [...new Set(cells.map(rowKey))])
  const rows = rowValues.map(value => ({
    cells: columns.map(column => cells.find(cell => rowKey(cell) === value && columnKey(cell) === column.key)),
    key: value,
    label: rowAxis == null ? 'all' : value,
  }))
  return { columns, entryId, name: shortTaskId(entryId).split('/').at(-1) ?? entryId, rowAxis: rowAxis == null ? undefined : axisName(rowAxis), rows }
}

const grids = computed<Grid[]>(() => {
  const response = matrix.data.value
  if (response == null)
    return []
  const byEntry = new Map<string, MatrixCell[]>()
  for (const cell of response.cells) {
    const list = byEntry.get(cell.entryId)
    if (list == null)
      byEntry.set(cell.entryId, [cell])
    else
      list.push(cell)
  }
  return [...byEntry.entries()].map(([entryId, cells]) => buildGrid(entryId, cells, response))
})
/**
 * Change of the exact score from the run before the newest one, in percentage points; `undefined` when the cell has
 * fewer than two scored runs.
 */
function scoreDelta(cell: MatrixCell): number | undefined {
  const scored = cell.history.map(point => point.exact).filter((exact): exact is number => exact != null)
  if (scored.length < 2)
    return undefined
  return (scored.at(-1)! - scored.at(-2)!) * 100
}
</script>

<template>
  <StateView :error="matrix.error.value" :loading="matrix.loading.value" :empty="grids.length === 0" empty-text="No matrix rows" empty-hint="Runs without tasks have nothing to show here." @retry="matrix.reload">
    <p :class="['text-xs muted mb-3']">
      Newest run of every combination across {{ matrix.data.value?.runCount }} run(s); the line shows the exact score of each run before it.
    </p>
    <section v-for="grid in grids" :key="grid.entryId" :class="['card mb-4 overflow-x-auto']" :data-testid="`matrix-${grid.entryId}`">
      <h2 :class="['card-title']" :title="shortTaskId(grid.entryId)">
        <span class="i-mingcute-layout-grid-line" aria-hidden="true" />{{ grid.name }}
      </h2>
      <table :class="['border-separate border-spacing-2']">
        <thead>
          <tr>
            <th :class="['th']">
              {{ grid.rowAxis ?? '' }}
            </th>
            <th v-for="column in grid.columns" :key="column.key" :class="['th text-center']">
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in grid.rows" :key="row.key">
            <th :class="['th text-sm text-neutral-800 dark:text-neutral-200 font-medium align-middle']" scope="row">
              {{ row.label }}
            </th>
            <td v-for="(cell, index) in row.cells" :key="grid.columns[index]!.key" :class="['align-top']">
              <a
                v-if="cell"
                :href="href({ name: 'task', runKey: cell.latest.runKey, taskId: cell.latest.taskId })"
                :class="['flex flex-col w-56 rounded-xl p-3.5 transition-colors', 'bg-neutral-500/5 hover:bg-primary-500/8']"
                :title="`${attemptLabel(cell.latest.attemptId)} · ${cell.latest.runKey}`"
                data-testid="matrix-cell"
              >
                <span :class="['flex items-start gap-2']">
                  <span :class="['flex items-baseline gap-1.5']">
                    <span :class="['text-2xl font-semibold tabular-nums leading-none']">{{ formatScore(cell.latest.exact) }}</span>
                    <span
                      v-if="scoreDelta(cell) !== undefined && Math.abs(scoreDelta(cell)!) >= 0.05"
                      :class="['inline-flex items-center text-xs font-medium tabular-nums', scoreDelta(cell)! > 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400']"
                      :title="`${scoreDelta(cell)! > 0 ? '+' : ''}${scoreDelta(cell)!.toFixed(1)} points from the run before`"
                      data-testid="matrix-cell-delta"
                    >
                      <span :class="[scoreDelta(cell)! > 0 ? 'i-mingcute-arrow-up-line' : 'i-mingcute-arrow-down-line']" aria-hidden="true" />{{ Math.abs(scoreDelta(cell)!).toFixed(1) }}
                    </span>
                  </span>
                  <Sparkline :class="['ml-auto']" :values="cell.history.map(point => point.exact)" :label="`exact score of ${cell.history.length} runs`" :width="56" />
                </span>
                <span :class="['flex items-center gap-1.5 mt-1.5 text-xs muted min-w-0']">
                  <StateBadge :state="cell.latest.state" icon-only />
                  <span :class="['truncate']">{{ attemptLabel(cell.latest.attemptId) }} · {{ cell.history.length }} run(s)</span>
                </span>
                <CountsBar :class="['mt-2']" :counts="cell.latest.counts" labels="hover" />
              </a>
              <span v-else :class="['flex items-center justify-center w-56 h-24 rounded-xl text-xs muted border border-dashed border-neutral-300/60 dark:border-neutral-700/40']">not run</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </StateView>
</template>
