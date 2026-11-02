<script setup lang="ts">
import type { ScoreDefinition } from '../../../src/shared/contract'
import type { Baseline, CellComparison, MatrixAxis, MatrixGrid } from '../matrixGrid'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import MarginBar from './MarginBar.vue'
import MatrixCellCard from './MatrixCellCard.vue'
import MatrixHeatCell from './MatrixHeatCell.vue'

import { bestRowsFirst, compareToBaseline, isSettled, meanOf } from '../matrixGrid'

/**
 * One entry's grid as a table: the row axes down the side and the column axes across the top, one header level per
 * axis (outer groups spanning their inner values), both frozen while the table scrolls. Groups are set apart by space
 * and outer header values by a tinted band, not by hairlines. Each row and column ends in
 * a margin bar of its mean, the main effect of that value, so which row or column runs high reads without a chart.
 *
 * Cells are compact (a filled number that opens its card on hover) or cards; with a baseline, every cell shows its
 * difference from its baseline cell (the baseline's values on the baseline axes, its own on the others).
 */
const props = defineProps<{
  axes: readonly MatrixAxis[]
  baseline?: Baseline
  definitions: readonly ScoreDefinition[]
  grid: MatrixGrid
  /** Width of the scroll box: the row header stays frozen only while it takes at most half of it (not on a phone). */
  room: number
  /** Rows sorted best first (outer groups by their mean, rows inside by theirs). */
  sort: boolean
  textWidth: (text: string) => number
  view: 'cards' | 'compact'
}>()
const { t } = useI18n()

/** Height of one header row, so the header levels stack while they stick. */
const HEADER_ROW_PX = 28

const nameOf = (key: string) => props.axes.find(axis => axis.key === key)?.name ?? key
const valueLabel = (value: string | undefined) => (value == null || value === '' ? '—' : value)
const averagedNames = computed(() => props.grid.layout.averaged.map(nameOf))
const layout = computed(() => props.grid.layout)
const dense = computed(() => props.view === 'compact' && props.grid.columns.length > 14)

/** The baseline's values on axes laid out in this grid (an entry without those axes has nothing to compare). */
const baseline = computed(() => {
  const laidOut = new Set([...layout.value.rows, ...layout.value.columns])
  return Object.fromEntries(Object.entries(props.baseline ?? {}).filter(([key]) => laidOut.has(key)))
})
const comparisons = computed(() => (Object.keys(baseline.value).length === 0 ? undefined : compareToBaseline(props.grid, baseline.value)))
const baselineLabel = computed(() => Object.entries(baseline.value).map(([key, value]) => `${nameOf(key)} = ${valueLabel(value)}`).join(' · '))
function comparisonAt(row: number, column: number): CellComparison | undefined {
  const comparison = comparisons.value?.[row]?.[column]
  return comparison === 'base' ? undefined : comparison
}
/** A cell's values on the laid-out axes (rows, then columns), for its hover details. */
function coordinatesAt(row: number, column: number): { name: string, value: string }[] {
  const coordinates = { ...props.grid.rows[row], ...props.grid.columns[column] }
  return [...layout.value.rows, ...layout.value.columns].map(key => ({ name: nameOf(key), value: valueLabel(coordinates[key]) }))
}
const isBaseAt = (row: number, column: number) => comparisons.value?.[row]?.[column] === 'base'
/** What a cell contributes to the color scale and the means: its difference with a baseline, else its score. */
function valueAt(row: number, column: number): null | number {
  if (comparisons.value != null)
    return comparisonAt(row, column)?.delta ?? null
  const cell = props.grid.cells[row]?.[column]
  return isSettled(cell) ? cell.value : null
}
const values = computed(() => props.grid.rows.map((_, row) => props.grid.columns.map((_, column) => valueAt(row, column))))
const scale = computed(() => {
  const all = values.value.flat().filter((value): value is number => value != null)
  return { high: Math.max(...all), low: Math.min(...all), spread: Math.max(...all.map(Math.abs)) }
})
function strengthAt(row: number, column: number): number | undefined {
  const value = values.value[row]![column]
  if (value == null)
    return undefined
  if (comparisons.value != null)
    return Math.abs(value) / (scale.value.spread || 1)
  return scale.value.high > scale.value.low ? (value - scale.value.low) / (scale.value.high - scale.value.low) : 0.5
}
const rowMeans = computed(() => values.value.map(row => meanOf(row.filter((value): value is number => value != null))))
const columnMeans = computed(() => props.grid.columns.map((_, column) => meanOf(values.value.map(row => row[column]).filter((value): value is number => value != null))))
const marginScale = computed(() => Math.max(...[...rowMeans.value, ...columnMeans.value].filter((value): value is number => value != null).map(Math.abs)))
/** Best settled cell of each row, without a baseline (with one, the differences speak for themselves). */
const bestOfRow = computed(() => values.value.map((row) => {
  if (comparisons.value != null)
    return -1
  return row.reduce<number>((best, value, index) => (value != null && (best < 0 || value > row[best]!) ? index : best), -1)
}))
const order = computed(() => (props.sort ? bestRowsFirst(props.grid, rowMeans.value) : props.grid.rows.map((_, index) => index)))

/** Header levels, outermost first: each value spans the combinations of the axes inside it. */
const headerLevels = computed(() => layout.value.columns.map((key, level) => {
  const span = props.grid.columns.length / layout.value.columns.slice(0, level + 1).reduce((count, inner) => count * (props.axes.find(axis => axis.key === inner)?.values.length ?? 1), 1)
  const cells: { first: number, label: string, span: number, value: string }[] = []
  for (let index = 0; index < props.grid.columns.length; index += span)
    cells.push({ first: index, label: valueLabel(props.grid.columns[index]![key]), span, value: props.grid.columns[index]![key] ?? '' })
  return { cells, key }
}))
/** A column that starts a new outer group gets a divider (only with more than one column axis). */
function startsGroup(column: number): boolean {
  if (column === 0 || layout.value.columns.length < 2)
    return false
  const outer = layout.value.columns.slice(0, -1)
  return outer.some(key => props.grid.columns[column]![key] !== props.grid.columns[column - 1]![key])
}
/** Widths of the row header's columns, one per row axis, so the values line up under their axis names. */
const rowHeaderColumns = computed(() => layout.value.rows.map(key => Math.ceil(Math.max(
  props.textWidth(nameOf(key)),
  ...(props.axes.find(axis => axis.key === key)?.values ?? []).map(value => props.textWidth(valueLabel(value)) * 14 / 12),
)) + 16))
const stickyRows = computed(() => rowHeaderColumns.value.reduce((total, width) => total + width, 24) <= props.room / 2)
const rowHeaderTemplate = computed(() => rowHeaderColumns.value.map(width => `${width}px`).join(' ') || 'auto')
/** Values shown in a row's header: an outer value only where it changes, so groups read as blocks. */
function rowLabels(position: number): string[] {
  const row = props.grid.rows[order.value[position]!]!
  const previous = position > 0 ? props.grid.rows[order.value[position - 1]!] : undefined
  return layout.value.rows.map((key, index) => {
    const changed = previous == null || layout.value.rows.slice(0, index + 1).some(outer => previous[outer] !== row[outer])
    return index === layout.value.rows.length - 1 || changed ? valueLabel(row[key]) : ''
  })
}
function startsRowGroup(position: number): boolean {
  const outer = layout.value.rows[0]
  if (position === 0 || outer == null || layout.value.rows.length < 2)
    return false
  return props.grid.rows[order.value[position]!]![outer] !== props.grid.rows[order.value[position - 1]!]![outer]
}
const isBaseValue = (key: string, value: string | undefined) => key in baseline.value && baseline.value[key] === value
function formatMean(value: null | number) {
  if (value == null)
    return '—'
  const points = value * 100
  return comparisons.value == null ? points.toFixed(1) : `${points > 0 ? '+' : points < 0 ? '−' : '±'}${Math.abs(points).toFixed(1)}`
}
/** A column whose values match the baseline on every baseline axis laid out across the top: its cells are the base. */
function isBaseColumn(column: Record<string, string>): boolean {
  const across = Object.entries(baseline.value).filter(([key]) => layout.value.columns.includes(key))
  return across.length > 0 && Object.keys(baseline.value).every(key => layout.value.columns.includes(key)) && across.every(([key, value]) => column[key] === value)
}
const cardClass = (best: boolean) => ['w-44 md:w-56 h-full', best && 'outline outline-2 outline-primary-500/50 rounded-xl']
</script>

<template>
  <table :class="['border-separate border-spacing-0']" data-testid="matrix-table">
    <thead>
      <tr v-for="(level, depth) in headerLevels" :key="level.key">
        <th
          :class="['sticky z-3 bg-white dark:bg-neutral-900 px-3 align-bottom', stickyRows && 'left-0']"
          :style="{ top: `${depth * HEADER_ROW_PX}px`, height: `${HEADER_ROW_PX}px` }"
        >
          <span v-if="depth === headerLevels.length - 1" :class="['grid text-left text-xs font-normal muted']" :style="{ gridTemplateColumns: rowHeaderTemplate }">
            <span v-for="key in layout.rows" :key="key" :class="['truncate']">{{ nameOf(key) }}</span>
          </span>
        </th>
        <th :class="['sticky z-2 bg-white dark:bg-neutral-900 pr-2 text-right text-xs font-normal muted whitespace-nowrap']" :style="{ top: `${depth * HEADER_ROW_PX}px` }">
          {{ nameOf(level.key) }}
        </th>
        <th
          v-for="cell in level.cells" :key="cell.first"
          :colspan="cell.span"
          :class="[
            'th sticky z-2 bg-white dark:bg-neutral-900 text-center! px-0.5! py-0.5!',
            startsGroup(cell.first) && 'pl-3!',
            isBaseValue(level.key, cell.value) && 'text-neutral-900! dark:text-neutral-100! underline decoration-dotted underline-offset-3',
          ]"
          :style="{ top: `${depth * HEADER_ROW_PX}px` }"
          :title="isBaseValue(level.key, cell.value) ? t('matrix.baseline.tag') : undefined"
        >
          <span :class="['block rounded-md py-0.5', depth < headerLevels.length - 1 && 'bg-neutral-500/10']">{{ cell.label }}</span>
        </th>
        <th :class="['th sticky z-2 bg-white dark:bg-neutral-900 pl-5!']" :style="{ top: `${depth * HEADER_ROW_PX}px` }">
          <template v-if="depth === headerLevels.length - 1">
            {{ comparisons ? t('matrix.margin.meanDelta') : t('matrix.margin.mean') }}
          </template>
        </th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="(rowIndex, position) in order" :key="rowIndex">
        <th
          scope="row"
          :class="[
            'z-1 bg-white dark:bg-neutral-900 px-3 text-left font-normal align-middle', stickyRows && 'sticky left-0',
            startsRowGroup(position) && 'pt-4',
          ]"
        >
          <span :class="['grid items-center text-sm']" :style="{ gridTemplateColumns: rowHeaderTemplate }">
            <span
              v-for="(label, index) in rowLabels(position)" :key="index"
              :class="[
                'truncate',
                index === 0 ? 'font-medium text-neutral-800 dark:text-neutral-200' : 'muted',
                isBaseValue(layout.rows[index]!, grid.rows[rowIndex]![layout.rows[index]!]) && label && 'underline decoration-dotted underline-offset-3',
              ]"
            >{{ label }}</span>
          </span>
        </th>
        <td />
        <td
          v-for="(cell, column) in grid.cells[rowIndex]" :key="column"
          :class="[
            // NOTICE: `h-px` gives the cell a definite height, so the card's `h-full` resolves to the row's height (a
            // percentage height inside a table cell of `auto` height is ignored). The row still grows to its tallest card.
            props.view === 'compact' ? 'p-0.5' : 'p-1 align-top h-px',
            startsGroup(column) && 'pl-3!',
            startsRowGroup(position) && 'pt-4!',
          ]"
        >
          <template v-if="cell">
            <MatrixHeatCell
              v-if="props.view === 'compact'"
              :cell="cell" :comparison="comparisonAt(rowIndex, column)" :is-base="isBaseAt(rowIndex, column)"
              :strength="strengthAt(rowIndex, column)" :best="bestOfRow[rowIndex] === column" :dense="dense"
              :coordinates="coordinatesAt(rowIndex, column)" :baseline-label="baselineLabel"
              :definitions="props.definitions" :averaged-names="averagedNames"
            />
            <MatrixCellCard
              v-else
              :class="cardClass(bestOfRow[rowIndex] === column)"
              :cell="cell" :comparison="comparisonAt(rowIndex, column)"
              :definitions="props.definitions" :averaged-names="averagedNames"
            />
          </template>
          <span
            v-else
            :class="[
              'flex items-center justify-center text-xs text-neutral-400 dark:text-neutral-600',
              props.view === 'compact' ? (dense ? 'w-10 h-7 rounded-md' : 'w-15 h-9 rounded-md') : 'w-44 md:w-56 h-24 rounded-xl bg-neutral-500/6',
            ]"
            :title="t('matrix.view.notRun')"
          >{{ props.view === 'compact' ? '—' : t('matrix.view.notRun') }}</span>
        </td>
        <td :class="['pl-5 pr-2', startsRowGroup(position) && 'pt-4']">
          <span v-if="rowMeans[rowIndex] != null" :class="['flex items-center gap-2 text-xs tabular-nums muted whitespace-nowrap']" data-testid="matrix-row-mean">
            <MarginBar :value="rowMeans[rowIndex]!" :scale="marginScale" :diverging="comparisons != null" />{{ formatMean(rowMeans[rowIndex]!) }}
          </span>
        </td>
      </tr>
    </tbody>
    <tfoot>
      <tr>
        <th :class="[stickyRows && 'sticky left-0', 'z-1 bg-white dark:bg-neutral-900 px-3 pt-4 pb-2 text-left text-xs font-medium muted align-bottom']">
          {{ comparisons ? t('matrix.margin.meanDelta') : t('matrix.margin.mean') }}
        </th>
        <td />
        <td
          v-for="(column, index) in grid.columns" :key="index"
          :class="['pt-4 pb-2 align-bottom', startsGroup(index) && 'pl-3']"
          data-testid="matrix-column-mean"
        >
          <span :class="['flex flex-col items-center gap-1 text-xs tabular-nums muted']">
            <template v-if="comparisons && isBaseColumn(column)">{{ t('matrix.baseline.tag') }}</template>
            <template v-else-if="columnMeans[index] != null">
              <MarginBar vertical :value="columnMeans[index]!" :scale="marginScale" :diverging="comparisons != null" />{{ formatMean(columnMeans[index]!) }}
            </template>
          </span>
        </td>
        <td />
      </tr>
    </tfoot>
  </table>
</template>
