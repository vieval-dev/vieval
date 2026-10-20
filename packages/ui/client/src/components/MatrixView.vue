<script setup lang="ts">
import type { MatrixCell, MatrixResponse } from '../../../src/shared/contract'

import { useQuery } from '@pinia/colada'
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ScoreBar from './ScoreBar.vue'
import ScoreCard from './ScoreCard.vue'
import Sparkline from './Sparkline.vue'
import StateView from './StateView.vue'

import { api } from '../api'
import { useCatalog } from '../composables/useCatalog'
import { formatCount, formatScore, shortTaskId } from '../format'
import { attemptLabel, formatShortDateTime } from '../labels'
import { href } from '../router'
import { headlineOf, headlineView } from '../scores'

/**
 * Matrix of a project or experiment (`GET /api/matrix`): one grid per eval entry, rows along the run axis with the
 * most values (for example `model`), columns for the combinations of the other axes (for example `repeat`). A cell
 * is the newest run that covered that combination fully (see `MatrixCell.latest`), with the trend of every run.
 *
 * Columns of a configuration the project moved away from (every cell `superseded`, for example an eval axis dropped
 * since) are folded until asked for, so the table opens on what the newest runs measure.
 */
const props = defineProps<{ experiment?: string, project: string, workspace: string }>()
const { t } = useI18n()

const matrix = useQuery({
  key: () => ['matrix', { experiment: props.experiment ?? null, project: props.project, workspace: props.workspace }],
  query: () => api.matrix({ experiment: props.experiment, project: props.project, workspace: props.workspace }),
})

// The catalog polls every run; when a run of this scope advanced, its cells (scores, counts, state) are re-read.
const catalog = useCatalog()
const scopeRuns = computed(() => catalog.runsIn({ experiment: props.experiment, project: props.project, workspace: props.workspace }))
watch(() => scopeRuns.value.map(run => `${run.runKey}:${run.lastSeq}`).join(','), () => void matrix.refetch())
/** Values of one cell along every axis, `run.` and `eval.` prefixed so equal axis names cannot collide. */
function coordinates(cell: MatrixCell): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(cell.run).map(([axis, value]) => [`run.${axis}`, value])),
    ...Object.fromEntries(Object.entries(cell.eval).map(([axis, value]) => [`eval.${axis}`, value])),
  }
}

/** The catalog entry of a cell's newest run: its event sequence drives the progress of a running cell. */
function runOf(cell: MatrixCell) {
  return scopeRuns.value.find(run => run.runKey === cell.latest.runKey)
}
const axisName = (key: string) => key.replace(/^(?:run|eval)\./, '')

interface Grid {
  columns: { key: string, label: string, superseded: boolean }[]
  entryId: string
  name: string
  rowAxis: string | undefined
  /** One row per value of `rowAxis`; `cells` line up with `columns` (`undefined`: combination never ran). */
  rows: { cells: (MatrixCell | undefined)[], key: string, label: string }[]
  /** Axis values every column has (for example `listener gpt-6-luna`), said once above the table instead of per column. */
  shared: string
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
  // With several columns, an axis with one value in every cell says nothing about a column; it moves above the table.
  // The other axes name a column by the values it has; an axis a column lacks (it ran before the axis was added, or
  // after it was dropped) is left out instead of shown as `asr —`.
  const multiColumn = new Set(cells.map(columnKey)).size > 1
  const sharedAxes = multiColumn ? columnAxes.filter(key => cells.every(cell => coordinates(cell)[key] != null && coordinates(cell)[key] === coordinates(cells[0]!)[key])) : []
  const varyingAxes = columnAxes.filter(key => !sharedAxes.includes(key))
  const columnLabel = (cell: MatrixCell) => {
    const present = varyingAxes.filter(key => coordinates(cell)[key] != null)
    if (present.length > 0)
      return present.map(key => `${axisName(key)} ${coordinates(cell)[key]}`).join(' · ')
    return varyingAxes.length > 0 ? t('matrix.view.without', { axes: varyingAxes.map(axisName).join(', ') }) : t('matrix.view.all')
  }

  const columns = [...new Set(cells.map(columnKey))].map((key) => {
    const columnCells = cells.filter(cell => columnKey(cell) === key)
    return { key, label: columnLabel(columnCells[0]!), superseded: columnCells.every(cell => cell.superseded) }
  })
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
    label: rowAxis == null ? t('matrix.view.all') : value,
  }))
  return {
    columns,
    entryId,
    name: shortTaskId(entryId).split('/').at(-1) ?? entryId,
    rowAxis: rowAxis == null ? undefined : axisName(rowAxis),
    rows,
    shared: sharedAxes.map(key => `${axisName(key)} ${coordinates(cells[0]!)[key]}`).join(' · '),
  }
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

const showSuperseded = shallowRef(false)
/** Labels of the folded columns across the grids (one label per configuration, however many entries ran it). */
const supersededLabels = computed(() => new Set(grids.value.flatMap(grid => grid.columns.filter(column => column.superseded).map(column => column.label))))
const visibleGrids = computed(() => grids.value.map((grid) => {
  if (showSuperseded.value)
    return grid
  const kept = grid.columns.flatMap((column, index) => (column.superseded ? [] : [index]))
  return { ...grid, columns: kept.map(index => grid.columns[index]!), rows: grid.rows.map(row => ({ ...row, cells: kept.map(index => row.cells[index]) })) }
}))

/** Label of a cell's headline (its primary score, or the passed cases), for the trend and the tooltips. */
function headlineLabel(cell: MatrixCell): string {
  return headlineView(headlineOf(cell.latest.scoring), matrix.data.value?.scoreDefinitions ?? []).label
}
/**
 * Whether a cell is read by its score: every case of its run got a result and none failed an assertion, so the case
 * counts are all green and say nothing; how the scores spread does.
 */
function isScored(cell: MatrixCell): boolean {
  const { counts, scoring, state } = cell.latest
  return scoring.primary != null && counts.failed === 0 && state !== 'running' && state !== 'queued'
}
/** Mean of the primary score of the cell's run, `null` without one. */
function latestScore(cell: MatrixCell): null | number {
  const { primary, scores } = cell.latest.scoring
  return scores.find(summary => summary.name === primary)?.mean ?? null
}
/** When a point of a cell's history started: its run's start time, else the attempt label. */
function pointTime(point: MatrixCell['history'][number]): string {
  return point.startedAt == null ? attemptLabel(point.attemptId) : formatShortDateTime(new Date(point.startedAt))
}

/** Tooltip of one history point: when, how much it measured, its score, and its completion rate. */
function pointTitle(cell: MatrixCell, point: MatrixCell['history'][number]): string {
  return t('matrix.view.pointTitle', {
    completion: formatScore(point.completion),
    coverage: t(`matrix.view.coverage.${point.coverage}`),
    measured: formatCount(point.counts.passed + point.counts.failed),
    score: headlineLabel(cell),
    time: pointTime(point),
    total: formatCount(cell.caseCount),
    value: formatScore(point.score),
  })
}

/**
 * Change of the primary score from the previous full run, in percentage points; `undefined` unless the cell's run and
 * an earlier run both covered the cell fully (a partial run or one without a result is no baseline).
 */
function scoreDelta(cell: MatrixCell): number | undefined {
  const latest = latestScore(cell)
  if (cell.latest.coverage !== 'full' || latest == null)
    return undefined
  const index = cell.history.findIndex(point => point.runKey === cell.latest.runKey)
  const previous = cell.history.slice(0, Math.max(0, index)).findLast(point => point.coverage === 'full' && point.score != null)
  return previous == null ? undefined : (latest - previous.score!) * 100
}
</script>

<template>
  <StateView :error="matrix.error.value" :loading="matrix.isPending.value" :empty="grids.length === 0" :empty-text="t('matrix.view.empty')" :empty-hint="t('matrix.view.emptyHint')" skeleton="matrix" @retry="matrix.refetch()">
    <p :class="['flex flex-wrap items-center gap-x-3 gap-y-1 text-xs muted mb-3']">
      <span>{{ t('matrix.view.intro', { n: formatCount(matrix.data.value?.runCount ?? 0) }, matrix.data.value?.runCount ?? 0) }}</span>
      <span :class="['inline-flex items-center gap-1']"><svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="2.5" fill="var(--series-1)" /></svg>{{ t('matrix.view.legendFull') }}</span>
      <span :class="['inline-flex items-center gap-1']"><svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="2.5" fill="none" stroke="var(--series-1)" stroke-width="1.25" stroke-dasharray="1.5 1.2" /></svg>{{ t('matrix.view.legendPartial') }}</span>
      <span :class="['inline-flex items-center gap-1']"><svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="2.5" fill="none" stroke="var(--mark-errored)" stroke-width="1.25" /></svg>{{ t('matrix.view.legendNone') }}</span>
      <button v-if="supersededLabels.size > 0" type="button" :class="['btn text-xs px-1.5! py-0.5! ml-auto']" :title="[...supersededLabels].join('\n')" data-testid="matrix-toggle-superseded" @click="showSuperseded = !showSuperseded">
        <span :class="[showSuperseded ? 'i-mingcute-eye-close-line' : 'i-mingcute-history-line']" aria-hidden="true" />
        {{ t(showSuperseded ? 'matrix.view.hideSuperseded' : 'matrix.view.showSuperseded', { n: formatCount(supersededLabels.size) }, supersededLabels.size) }}
      </button>
    </p>
    <section v-for="grid in visibleGrids" :key="grid.entryId" :class="['card mb-4 overflow-x-auto']" :data-testid="`matrix-${grid.entryId}`">
      <h2 :class="['card-title']" :title="shortTaskId(grid.entryId)">
        <span class="i-mingcute-layout-grid-line" aria-hidden="true" />{{ grid.name }}
        <span v-if="grid.shared" :class="['text-xs font-normal muted']">{{ grid.shared }}</span>
      </h2>
      <table :class="['border-separate border-spacing-2']">
        <thead>
          <tr>
            <th :class="['th']">
              {{ grid.rowAxis ?? '' }}
            </th>
            <th v-for="column in grid.columns" :key="column.key" :class="['th text-center', column.superseded && 'opacity-60']" :title="column.superseded ? t('matrix.view.superseded') : undefined">
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
              <ScoreCard
                v-if="cell"
                :class="['w-44 md:w-56', cell.superseded && 'opacity-60']"
                compact
                :href="href({ name: 'task', runKey: cell.latest.runKey, taskId: cell.latest.taskId })"
                :headline="headlineOf(cell.latest.scoring)"
                :definitions="matrix.data.value?.scoreDefinitions ?? []"
                :state="isScored(cell) && cell.latest.state === 'passed' ? undefined : cell.latest.state"
                :counts="isScored(cell) ? undefined : { ...cell.latest.counts, total: Math.max(cell.latest.counts.total, cell.latest.caseTotal ?? 0) }"
                :run="runOf(cell)"
                data-testid="matrix-cell"
              >
                <template #score>
                  <span
                    v-if="scoreDelta(cell) !== undefined && Math.abs(scoreDelta(cell)!) >= 0.05"
                    :class="['inline-flex items-center text-xs font-medium tabular-nums', scoreDelta(cell)! > 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400']"
                    :title="t('matrix.view.deltaTitle', { delta: `${scoreDelta(cell)! > 0 ? '+' : ''}${scoreDelta(cell)!.toFixed(1)}` })"
                    data-testid="matrix-cell-delta"
                  >
                    <span :class="[scoreDelta(cell)! > 0 ? 'i-mingcute-arrow-up-line' : 'i-mingcute-arrow-down-line']" aria-hidden="true" />{{ Math.abs(scoreDelta(cell)!).toFixed(1) }}
                  </span>
                </template>
                <template v-if="isScored(cell)" #bar>
                  <ScoreBar :class="['w-full']" :scores="cell.latest.caseScores" />
                </template>
                <span :class="['flex items-center gap-1.5 min-w-0']" :title="`${attemptLabel(cell.latest.attemptId)} · ${cell.latest.runKey}`">
                  <span :class="['truncate']">{{ cell.latest.startedAt ? formatShortDateTime(new Date(cell.latest.startedAt)) : attemptLabel(cell.latest.attemptId) }} · {{ t('matrix.view.caseCount', { n: formatCount(cell.latest.counts.total) }, cell.latest.counts.total) }} · {{ t('matrix.view.runCount', { n: formatCount(cell.history.length) }, cell.history.length) }}</span>
                  <Sparkline
                    :class="['ml-auto']" :values="cell.history.map(point => point.score)" :coverage="cell.history.map(point => point.coverage)" :titles="cell.history.map(point => pointTitle(cell, point))"
                    :label="t('matrix.view.sparkline', { n: formatCount(cell.history.length), score: headlineLabel(cell) }, cell.history.length)" :width="48" :height="16"
                  />
                </span>
                <span v-if="cell.latest.coverage !== 'full' && cell.latest.state !== 'running' && cell.latest.state !== 'queued'" :class="['flex items-center gap-1.5 [color:var(--ink-errored)]']" data-testid="matrix-cell-partial">
                  <span class="i-mingcute-alert-octagon-line" aria-hidden="true" />{{ t('matrix.view.partial', { measured: formatCount(cell.latest.counts.passed + cell.latest.counts.failed), total: formatCount(cell.caseCount) }) }}
                </span>
              </ScoreCard>
              <span v-else :class="['flex items-center justify-center w-44 md:w-56 h-24 rounded-xl text-xs muted border border-dashed border-neutral-300/60 dark:border-neutral-700/40']">{{ t('matrix.view.notRun') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </StateView>
</template>
