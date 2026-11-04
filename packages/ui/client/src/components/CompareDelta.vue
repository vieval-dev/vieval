<script setup lang="ts">
import type { CompareAxis, Interval, PairedDelta } from '../comparison'

import { scaleLinear } from 'd3'
import { computed, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { caseOffset } from '../caseMetrics'
import { useElementWidth } from '../composables/useElementWidth'

/** One column against the baseline. */
export interface DeltaRow {
  delta: PairedDelta
  /** Hidden from the charts: the row stays (so the chart keeps its height) but fades, and the scale ignores it. */
  hidden?: boolean
  href?: string
  label: string
  /** The column's newest run is still running: a spinning ring beside its name. */
  running?: boolean
  /** The column's own mean on the axis, shown next to its difference. */
  value: Interval
}

/**
 * Each column against the baseline, paired by case (an estimation plot): every case's difference as a faint dot, the
 * mean difference as a dot on its 95% confidence interval, and a zero line that the baseline's own row sits on. It
 * answers "how much better, and could it be noise" in one look: an interval clear of zero is a real gap; one across
 * zero is not, however far the mean moved.
 *
 * Use for comparing many columns, or columns with many cases or runs, against one reference. Gains are drawn in the
 * score hue and losses in the opposite hue (as the compact matrix draws differences); a gap within noise is gray. The numbers sit
 * in a column on the right instead of a tooltip, so reading one row never covers the others.
 */
const props = defineProps<{
  axis: CompareAxis
  /** The reference row, drawn first on the zero line with its own mean. */
  baseline: { href?: string, label: string, running?: boolean, value: Interval }
  /** Case name of each row key, for the case dots' tooltips. */
  caseLabels: ReadonlyMap<string, string>
  formatDelta: (value: number) => string
  formatValue: (value: number) => string
  rows: readonly DeltaRow[]
}>()

const { t } = useI18n()
const root = useTemplateRef<HTMLElement>('root')
const width = useElementWidth(root, 640)
const rowHeight = 30
const labelWidth = computed(() => Math.min(180, Math.round(width.value * 0.2)))
/**
 * How much of the numbers the right column shows: `full` "70.4%  −4.1 pt [−15.2, +7.0]  2↑ 3↓ 1=" on wide charts,
 * `short` without the interval (the hover labels give its ends) on mid-sized ones, `delta` alone on phones.
 */
const summary = computed<'delta' | 'full' | 'short'>(() => (width.value >= 860 ? 'full' : width.value >= 560 ? 'short' : 'delta'))
const summaryWidth = computed(() => ({ delta: 64, full: 290, short: 170 })[summary.value])
const plotLeft = computed(() => labelWidth.value + 12)
const plotRight = computed(() => width.value - summaryWidth.value - 16)
const height = computed(() => (props.rows.length + 1) * rowHeight + 30)

// NOTICE: one tick per ~70 px keeps tick labels such as "+20.0 pt" apart on phones.
const ticks = computed(() => Math.max(2, Math.min(6, Math.floor((plotRight.value - plotLeft.value) / 70))))
/** Symmetric around zero, so gains and losses of the same size look the same size. */
const scale = computed(() => {
  const reach = Math.max(1e-9, ...props.rows.filter(row => !row.hidden).flatMap(row => [Math.abs(row.delta.interval.low), Math.abs(row.delta.interval.high), ...row.delta.differences.map(difference => Math.abs(difference.value))]))
  // Clamped: a hidden outlier left out of the domain stays pinned at the edge instead of running off the chart.
  // NOTICE: the domain is rounded for a fixed 6 ticks, not for the ticks this width shows: rounding for fewer ticks
  // widened it (±40 pt became ±60 pt on a phone), so one difference looked smaller on a narrow screen. Only the tick
  // labels thin out with the width.
  return scaleLinear([-reach * 1.05, reach * 1.05], [plotLeft.value, plotRight.value]).nice(6).clamp(true)
})

/** Whether the interval is clear of zero, and if so whether the column is better by the axis's direction. */
function verdictOf(delta: PairedDelta): 'better' | 'noise' | 'worse' {
  const { high, low } = delta.interval
  if (low <= 0 && high >= 0)
    return 'noise'
  const up = low > 0
  return (props.axis.better === 'lower' ? !up : up) ? 'better' : 'worse'
}
const COLORS = { better: 'var(--series-1)', noise: 'var(--chart-text)', worse: 'var(--series-1-opposite)' } as const
const truncate = (label: string) => (label.length > labelWidth.value / 6.5 ? `${label.slice(0, Math.floor(labelWidth.value / 6.5) - 1)}…` : label)

/** The row under the pointer, drawn on a tinted band; the case dot under it gets a one-line tooltip above it. */
const hoveredRow = shallowRef<number>()
const hoveredCase = shallowRef<{ text: string, x: number, y: number }>()
function hoverCase(key: string, value: number, x: number, y: number): void {
  hoveredCase.value = { text: `${props.caseLabels.get(key) ?? key}: ${props.formatDelta(value)}`, x, y }
}
</script>

<template>
  <figure ref="root" :class="['relative w-full']" data-testid="compare-delta">
    <svg :viewBox="`0 0 ${width} ${height}`" :class="['w-full h-auto select-none']" role="img" :aria-label="t('compare.chart.deltaAria', { axis: props.axis.label })" @mouseleave="hoveredRow = undefined; hoveredCase = undefined">
      <rect v-if="hoveredRow != null" x="0" :y="(hoveredRow + 1) * rowHeight" :width="width" :height="rowHeight" rx="6" fill="var(--chart-grid)" opacity="0.45" />
      <line v-for="tick in scale.ticks(ticks)" :key="tick" :x1="scale(tick)" :x2="scale(tick)" y1="0" :y2="height - 22" :stroke="tick === 0 ? 'var(--chart-text)' : 'var(--chart-grid)'" :stroke-width="tick === 0 ? 1.5 : 1" :opacity="tick === 0 ? 0.6 : 1" />
      <text v-for="tick in scale.ticks(ticks)" :key="`t${tick}`" :x="scale(tick)" :y="height - 8" font-size="10" text-anchor="middle" fill="var(--chart-text)">{{ tick === 0 ? '0' : props.formatDelta(tick) }}</text>

      <!-- The baseline: a hollow dot on the zero line, with its own mean and interval on the right. -->
      <g data-testid="compare-delta-baseline">
        <a :href="props.baseline.href">
          <text :x="labelWidth" :y="rowHeight / 2 + 4" font-size="11" text-anchor="end" fill="var(--chart-text)" font-weight="600">{{ truncate(props.baseline.label) }}<title>{{ props.baseline.label }}</title></text>
        </a>
        <!-- Still running: a spinning ring between the name and the plot, as the run state badges spin. -->
        <circle v-if="props.baseline.running" :cx="labelWidth + 6" :cy="rowHeight / 2" r="3.5" fill="none" stroke="var(--mark-running)" stroke-width="1.5" stroke-dasharray="14 8" :class="['animate-spin origin-center [transform-box:fill-box]']" data-testid="compare-delta-running" />
        <circle :cx="scale(0)" :cy="rowHeight / 2" r="5" fill="var(--chart-surface)" stroke="var(--chart-text)" stroke-width="2" />
        <text :x="width - summaryWidth" :y="rowHeight / 2 + 4" font-size="11" fill="var(--chart-text)">
          <tspan font-weight="600">{{ props.formatValue(props.baseline.value.mean) }}</tspan>
          <tspan v-if="summary !== 'delta'" dx="6" opacity="0.7">{{ summary === 'short' ? t('compare.chart.baselineTag') : t('compare.chart.baselineRow', { high: props.formatValue(props.baseline.value.high), low: props.formatValue(props.baseline.value.low) }) }}</tspan>
        </text>
      </g>

      <g v-for="(row, index) in props.rows" :key="row.delta.columnId" :transform="`translate(0, ${(index + 1) * rowHeight})`" :opacity="row.hidden ? 0.35 : 1" :class="['transition-opacity duration-200']" @mouseenter="hoveredRow = index">
        <rect x="0" :width="width" :height="rowHeight" fill="transparent" />
        <a :href="row.href">
          <text :x="labelWidth" :y="rowHeight / 2 + 4" font-size="11" text-anchor="end" fill="var(--chart-text)" :class="[row.href && 'underline']">{{ truncate(row.label) }}<title>{{ row.label }}</title></text>
        </a>
        <!-- Still running: a spinning ring between the name and the plot, as the run state badges spin. -->
        <circle v-if="row.running" :cx="labelWidth + 6" :cy="rowHeight / 2" r="3.5" fill="none" stroke="var(--mark-running)" stroke-width="1.5" stroke-dasharray="14 8" :class="['animate-spin origin-center [transform-box:fill-box]']" data-testid="compare-delta-running" />
        <!-- Every case's difference, spread vertically by a stable offset so equal differences stay countable. -->
        <circle
          v-for="difference in row.delta.differences" :key="difference.key"
          :cx="scale(difference.value)" :cy="rowHeight / 2 + caseOffset(difference.key) * 14" r="2.5"
          :fill="COLORS[verdictOf(row.delta)]" opacity="0.35"
          @mouseenter="hoverCase(difference.key, difference.value, scale(difference.value), (index + 1) * rowHeight + rowHeight / 2 + caseOffset(difference.key) * 14)"
          @mouseleave="hoveredCase = undefined"
        />
        <!-- The interval thickens under the pointer, as the case-count bars of the cards do, under its value labels. -->
        <rect
          :x="scale(row.delta.interval.low)" :y="rowHeight / 2 - (hoveredRow === index ? 3.5 : 2)" :width="Math.max(2, scale(row.delta.interval.high) - scale(row.delta.interval.low))"
          :height="hoveredRow === index ? 7 : 4" :rx="hoveredRow === index ? 3.5 : 2"
          :fill="COLORS[verdictOf(row.delta)]" :opacity="verdictOf(row.delta) === 'noise' ? 0.45 : 0.8" pointer-events="none"
        />
        <circle :cx="scale(row.delta.interval.mean)" :cy="rowHeight / 2" r="5" :fill="COLORS[verdictOf(row.delta)]" stroke="var(--chart-surface)" stroke-width="2" pointer-events="none" />
        <text :x="width - summaryWidth" :y="rowHeight / 2 + 4" font-size="11" fill="var(--chart-text)">
          <title>{{ t('compare.chart.winsLosses', { losses: row.delta.losses, n: row.delta.interval.n, ties: row.delta.ties, wins: row.delta.wins }) }} · {{ t(`compare.chart.verdict.${verdictOf(row.delta)}`) }}</title>
          <template v-if="summary !== 'delta'">
            <tspan>{{ props.formatValue(row.value.mean) }}</tspan>
            <tspan dx="6" font-weight="600" :fill="verdictOf(row.delta) === 'noise' ? 'var(--chart-text)' : COLORS[verdictOf(row.delta)]">{{ props.formatDelta(row.delta.interval.mean) }}</tspan>
            <tspan v-if="summary === 'full'" dx="4" opacity="0.7">[{{ props.formatDelta(row.delta.interval.low) }}, {{ props.formatDelta(row.delta.interval.high) }}]</tspan>
            <tspan dx="6" opacity="0.7">{{ t('compare.chart.winsLossesShort', { losses: row.delta.losses, ties: row.delta.ties, wins: row.delta.wins }) }}</tspan>
          </template>
          <tspan v-else font-weight="600">{{ props.formatDelta(row.delta.interval.mean) }}</tspan>
        </text>
      </g>
    </svg>
    <!--
      Values of the hovered interval, floating over the chart like the case-count bars' hover labels (`CountsBar.vue`):
      the mean above the bar, the two ends of the 95% interval below it, so a narrow interval keeps them apart. Each
      label has its own backdrop to stay readable over the dots and lines it covers.
    -->
    <div
      v-for="(row, index) in props.rows" :key="`labels-${row.delta.columnId}`"
      :class="['absolute inset-0 pointer-events-none transition-all duration-200', hoveredRow === index && hoveredCase == null ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1']"
      aria-hidden="true" data-testid="compare-delta-values"
    >
      <span
        v-for="mark in [
          { key: 'mean', value: row.delta.interval.mean, top: (index + 1) * rowHeight + rowHeight / 2 - 22, strong: true },
          { key: 'low', value: row.delta.interval.low, top: (index + 1) * rowHeight + rowHeight / 2 + 6, strong: false },
          { key: 'high', value: row.delta.interval.high, top: (index + 1) * rowHeight + rowHeight / 2 + 6, strong: false },
        ]" :key="mark.key"
        :class="['absolute -translate-x-1/2 rounded px-1 text-xs tabular-nums whitespace-nowrap bg-neutral-100 dark:bg-neutral-800', mark.strong ? 'font-semibold' : 'muted']"
        :style="{ left: `${(scale(mark.value) / width) * 100}%`, top: `${mark.top}px`, color: mark.strong && verdictOf(row.delta) !== 'noise' ? COLORS[verdictOf(row.delta)] : undefined }"
      >{{ mark.key === 'mean' ? t('compare.chart.meanValue', { value: props.formatDelta(mark.value) }) : props.formatDelta(mark.value) }}</span>
    </div>
    <div
      v-if="hoveredCase" role="tooltip"
      :class="['tooltip absolute pointer-events-none whitespace-nowrap']"
      :style="{ left: `${(hoveredCase.x / width) * 100}%`, top: `${hoveredCase.y}px`, transform: 'translate(-50%, calc(-100% - 8px))' }"
    >
      {{ hoveredCase.text }}
    </div>
  </figure>
</template>
