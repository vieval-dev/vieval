<script setup lang="ts">
import type { CompareAxis, Interval, PairedDelta } from '../comparison'
import type { PointAxisReading } from './ComparePointCard.vue'
import type { HeatFill } from './HeatCell.vue'

import { useVirtualizer } from '@tanstack/vue-virtual'
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import ComparePointCard from './ComparePointCard.vue'
import HeatCell from './HeatCell.vue'
import MarginBar from './MarginBar.vue'
import StateBadge from './StateBadge.vue'

/**
 * Every column on every axis at once, in the compact matrix's anatomy: one row per column, one compact heat cell per
 * score or metric showing the paired difference from the baseline (the baseline's own row shows its values), the best
 * column of each axis outlined, the details of a cell in its hover card, and a margin that counts the axes where the
 * column is better or worse beyond noise. Fills follow the difference (gains in the score hue, losses in the opposite
 * hue, a gap within noise faint), so a table of many scores reads at a glance.
 *
 * Use when the columns have more scores than a plane has axes: a heat table keeps every value exact and comparable,
 * where a 3D plot hides points behind each other and parallel coordinates tangle a handful of close lines.
 */
const props = defineProps<{
  axes: readonly CompareAxis[]
  baseline?: string
  /** Compared columns; `running` marks one whose newest run is still running (its values move as cases settle). */
  columns: readonly { href?: string, id: string, label: string, running?: boolean }[]
  /** Paired difference from the baseline, by axis name then column id. */
  deltas: ReadonlyMap<string, ReadonlyMap<string, PairedDelta>>
  formatDelta: (value: number, axis: CompareAxis) => string
  formatValue: (value: number, axis: CompareAxis) => string
  /** Columns hidden from the charts: faded rows, left out of the color scale so an outlier no longer squeezes it. */
  hidden?: ReadonlySet<string>
  /** Mean of each column, by axis name then column id. */
  intervals: ReadonlyMap<string, ReadonlyMap<string, Interval>>
}>()
const emit = defineEmits<{
  /** Hide the column from the charts (an outlier that squeezes the others' colors), or show it again. */
  hide: [id: string, hide: boolean]
}>()
const isHidden = (id: string) => props.hidden?.has(id) === true
/** The axis the rows are sorted by (the plane's y axis); clicking a header picks it. */
const sortBy = defineModel<string>('sortBy', { required: true })
const { t } = useI18n()

/** The legend's ramp, from the strongest loss through the baseline to the strongest gain, as `HeatCell` fills them (10–50%). */
const LEGEND_RAMP = 'linear-gradient(90deg, color-mix(in oklab, var(--series-1-opposite) 50%, transparent), color-mix(in oklab, var(--series-1-opposite) 10%, transparent) 50%, color-mix(in oklab, var(--series-1) 10%, transparent) 50%, color-mix(in oklab, var(--series-1) 50%, transparent))'

const rows = computed(() => {
  const axis = props.axes.find(item => item.name === sortBy.value)
  const sign = axis?.better === 'lower' ? 1 : -1
  const meanOf = (id: string) => props.intervals.get(sortBy.value)?.get(id)?.mean
  // Best first by the axis's direction; a column without a value on it goes last.
  return props.columns.toSorted((left, right) => {
    const a = meanOf(left.id)
    const b = meanOf(right.id)
    if (a == null)
      return b == null ? 0 : 1
    return b == null ? -1 : sign * (a - b)
  })
})

/** Largest absolute mean difference per axis, so each axis fills on its own scale. */
const reach = computed(() => new Map(props.axes.map(axis => [axis.name, Math.max(0, ...[...props.deltas.get(axis.name)?.values() ?? []].filter(delta => !isHidden(delta.columnId)).map(delta => Math.abs(delta.interval.mean)))])))

/**
 * Fill of a cell (see `HeatCell.vue`): the hue of its difference from the baseline, stronger for a larger gap on its
 * axis's own scale, faint within noise. A hidden column is left unfilled.
 */
function fillOf(axis: CompareAxis, columnId: string): HeatFill | undefined {
  const delta = props.deltas.get(axis.name)?.get(columnId)
  const max = reach.value.get(axis.name) ?? 0
  if (delta == null || isHidden(columnId))
    return undefined
  const verdict = verdictOf(axis, columnId)
  const better = axis.better === 'lower' ? delta.interval.mean < 0 : delta.interval.mean > 0
  return { faint: verdict === 'noise', hue: better ? 'gain' : 'loss', strength: max === 0 ? 0 : Math.abs(delta.interval.mean) / max }
}

/** Whether a column's difference on an axis clears noise, and which way, by the axis's direction. */
function verdictOf(axis: CompareAxis, columnId: string): 'better' | 'noise' | 'worse' | undefined {
  const delta = props.deltas.get(axis.name)?.get(columnId)
  if (delta == null)
    return undefined
  if (delta.interval.low <= 0 && delta.interval.high >= 0)
    return 'noise'
  return (axis.better === 'lower' ? delta.interval.high < 0 : delta.interval.low > 0) ? 'better' : 'worse'
}

/**
 * The best column on each axis by its direction (hidden columns aside), outlined as the compact matrix outlines the best
 * cell of a row.
 */
const bestOf = computed(() => new Map(props.axes.map((axis) => {
  const sign = axis.better === 'lower' ? -1 : 1
  const candidates = props.columns.filter(column => !isHidden(column.id)).flatMap((column) => {
    const mean = props.intervals.get(axis.name)?.get(column.id)?.mean
    return mean == null ? [] : [{ id: column.id, score: sign * mean }]
  })
  return [axis.name, candidates.reduce<undefined | { id: string, score: number }>((best, item) => (best == null || item.score > best.score ? item : best), undefined)?.id]
})))

/** The single-axis reading a cell's hover card shows, in the plane's column card. */
function readingOf(axis: CompareAxis, columnId: string): PointAxisReading[] {
  const value = props.intervals.get(axis.name)?.get(columnId)
  return value == null
    ? []
    : [{ axis, delta: props.deltas.get(axis.name)?.get(columnId), formatDelta: number => props.formatDelta(number, axis), formatValue: number => props.formatValue(number, axis), value }]
}

/**
 * The margin of a row, as the compact matrix ends each row in a bar of its mean: averaging different metrics would mean
 * nothing, so it counts the axes where the column is better or worse than the baseline beyond noise.
 */
function tallyOf(columnId: string): { better: number, worse: number } {
  const verdicts = props.axes.map(axis => verdictOf(axis, columnId))
  return { better: verdicts.filter(verdict => verdict === 'better').length, worse: verdicts.filter(verdict => verdict === 'worse').length }
}
/**
 * Rows past which only the visible ones are rendered (`@tanstack/vue-virtual`, as the task page's case list does). Below
 * it every row is in the table and the rows stretch to fill the card's height; above it rows keep their compact height.
 */
const VIRTUAL_ROWS = 40
/** Height of a compact row: a 36 px heat cell and the 2 px spacing around it. */
const ROW_PX = 38
const scroller = useTemplateRef<HTMLElement>('scroller')
const virtual = computed(() => rows.value.length > VIRTUAL_ROWS)
const virtualizer = useVirtualizer(computed(() => ({
  count: rows.value.length,
  enabled: virtual.value,
  estimateSize: () => ROW_PX,
  getScrollElement: () => scroller.value ?? null,
  overscan: 8,
})))
/** The rows to render, with the space above and below them that keeps the scroll height of the rows left out. */
const visible = computed(() => {
  if (!virtual.value)
    return { after: 0, before: 0, rows: rows.value }
  const items = virtualizer.value.getVirtualItems()
  const before = items[0]?.start ?? 0
  const after = Math.max(0, virtualizer.value.getTotalSize() - (items.at(-1)?.end ?? 0))
  return { after, before, rows: items.map(item => rows.value[item.index]!) }
})
const labelOf = (columnId: string) => props.columns.find(column => column.id === columnId)?.label ?? columnId
</script>

<template>
  <!-- Fills the card: the legend, then the table's scroll box taking the rest of the height. -->
  <div :class="['flex flex-col h-full min-h-0']">
    <!-- A diverging ramp like the cell fills: the opposite hue for worse, the score hue for better, both fading toward the baseline. -->
    <div v-if="props.baseline" :class="['flex items-center gap-x-4 gap-y-1.5 flex-wrap px-1 pb-2 text-xs muted']" data-testid="compare-score-legend">
      <span :class="['inline-flex items-center gap-2']">
        <span>{{ t('compare.chart.legend.worse') }}</span>
        <span :class="['relative block h-2.5 w-40 rounded-sm']" :style="{ background: LEGEND_RAMP }" aria-hidden="true">
          <span :class="['absolute inset-y-[-2px] left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-neutral-500/60']" />
        </span>
        <span>{{ t('compare.chart.legend.better') }}</span>
      </span>
      <span :class="['inline-flex items-center gap-1.5']"><span :class="['size-3 rounded-sm outline-2 -outline-offset-2 outline-dashed outline-neutral-400/70 dark:outline-neutral-500/70']" />{{ t('compare.chart.legend.baseline') }}</span>
      <span>{{ t('compare.chart.legend.direction') }}</span>
    </div>
    <!--
    Scrolls both ways once the table outgrows the card (many scores across, many columns down), with the header row and
    the name column pinned. The table takes the full width, the name and margin columns only what they need, so the
    score columns share the rest.
  -->
    <div ref="scroller" :class="['flex-1 min-h-0 max-h-[70vh] overflow-auto']" data-testid="compare-score-table" :data-virtual="virtual || undefined">
      <table :class="['w-full border-separate border-spacing-0.5 text-sm', !virtual && 'h-full']">
        <thead>
          <tr>
            <th :class="['th sticky left-0 top-0 z-3 w-px bg-white dark:bg-neutral-900 text-left']" />
            <th v-for="axis in props.axes" :key="axis.name" :class="['th sticky top-0 z-2 bg-white dark:bg-neutral-900 text-xs font-normal whitespace-nowrap text-center!']">
              <button type="button" :class="['inline-flex items-center gap-0.5 hover:text-primary-600 dark:hover:text-primary-300', axis.name === sortBy && 'font-semibold text-neutral-900 dark:text-neutral-100']" :title="t('compare.chart.sortBy', { axis: axis.label })" @click="sortBy = axis.name">
                {{ axis.label }}<span v-if="axis.name === sortBy" class="i-mingcute-arrow-down-line" aria-hidden="true" />
              </button>
            </th>
            <th :class="['th sticky top-0 z-2 w-px bg-white dark:bg-neutral-900 text-xs font-normal whitespace-nowrap pl-4!']">
              {{ t('compare.chart.tally') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="visible.before > 0" aria-hidden="true" :style="{ height: `${visible.before}px` }" />
          <tr
            v-for="column in visible.rows" :key="column.id"
            :class="['group transition-opacity duration-200', isHidden(column.id) && 'opacity-40']" :data-hidden="isHidden(column.id) || undefined"
            :style="virtual ? { height: `${ROW_PX}px` } : undefined"
          >
            <th scope="row" :class="['sticky left-0 z-1 bg-white dark:bg-neutral-900 pr-1 text-xs font-normal text-left whitespace-nowrap max-w-52']" :title="column.label">
              <span :class="['flex items-center gap-1 min-w-0']">
                <StateBadge v-if="column.running" state="running" icon-only />
                <span :class="['truncate']"><a v-if="column.href" :href="column.href" :class="['link']">{{ column.label }}</a><span v-else>{{ column.label }}</span></span>
                <span v-if="column.id === props.baseline" :class="['muted shrink-0']">· {{ t('compare.chart.baselineTag') }}</span>
                <!-- Hiding an outlier lets the others spread over the color scale; the baseline cannot be hidden. -->
                <button
                  v-else type="button" :class="['icon-btn size-6! text-sm! ml-auto focus-visible:opacity-100', isHidden(column.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100']"
                  :aria-label="isHidden(column.id) ? t('compare.chart.show', { column: column.label }) : t('compare.chart.card.hide')"
                  :title="isHidden(column.id) ? t('compare.chart.show', { column: column.label }) : t('compare.chart.card.hide')"
                  data-testid="compare-score-hide" @click="emit('hide', column.id, !isHidden(column.id))"
                >
                  <span :class="[isHidden(column.id) ? 'i-mingcute-eye-line' : 'i-mingcute-eye-close-line']" aria-hidden="true" />
                </button>
              </span>
            </th>
            <!-- NOTICE: `h-px` gives the cell a definite height, so the heat cell's `h-full` resolves to the row's height (a
               percentage height inside a table cell of `auto` height is ignored), as in `MatrixTable.vue`. -->
            <td v-for="axis in props.axes" :key="axis.name" :class="['h-px']">
              <HeatCell
                v-if="props.intervals.get(axis.name)?.get(column.id)"
                fit
                :text="column.id === props.baseline || !props.deltas.get(axis.name)?.get(column.id)
                  ? props.formatValue(props.intervals.get(axis.name)!.get(column.id)!.mean, axis)
                  : props.formatDelta(props.deltas.get(axis.name)!.get(column.id)!.interval.mean, axis)"
                :fill="fillOf(axis, column.id)" :is-base="column.id === props.baseline"
                :best="!isHidden(column.id) && bestOf.get(axis.name) === column.id"
                test-id="compare-score-cell"
              >
                <template #detail>
                  <div :class="['w-72 max-w-[calc(100vw-2rem)] p-3']">
                    <ComparePointCard :label="labelOf(column.id)" :is-baseline="column.id === props.baseline" :pinned="false" :baseline-label="props.baseline ? labelOf(props.baseline) : undefined" :readings="readingOf(axis, column.id)" />
                  </div>
                </template>
              </HeatCell>
              <HeatCell v-else fit empty text="—" />
            </td>
            <!-- The margin: axes better and worse than the baseline beyond noise, as a bar around zero. -->
            <td :class="['w-px pl-4 pr-1']">
              <span v-if="column.id !== props.baseline" :class="['flex items-center gap-2 text-xs tabular-nums muted whitespace-nowrap']" data-testid="compare-score-tally">
                <MarginBar :value="tallyOf(column.id).better - tallyOf(column.id).worse" :scale="props.axes.length" diverging />{{ t('compare.chart.tallyValue', { better: tallyOf(column.id).better, worse: tallyOf(column.id).worse }) }}
              </span>
            </td>
          </tr>
          <tr v-if="visible.after > 0" aria-hidden="true" :style="{ height: `${visible.after}px` }" />
        </tbody>
      </table>
    </div>
  </div>
</template>
