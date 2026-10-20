<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue'

import { useElementWidth } from '../composables/useElementWidth'

/** One category of the chart; `values[i]` belongs to `series[i]`. */
export interface BarDatum {
  href?: string
  label: string
  values: Array<null | number>
}

/**
 * Horizontal grouped bar chart on one axis (from 0 to `max`).
 *
 * Use for magnitudes per category: scores per task, matrix row, round, experiment, or run. Bars start at the
 * baseline, groups are separated by a surface gap, every bar has a hover tooltip, and values are labeled at the
 * bar end so identity never depends on color alone.
 */
const props = withDefaults(defineProps<{
  data: BarDatum[]
  format?: (value: number) => string
  max?: number
  /** Series names; a legend is shown for two or more. */
  series: string[]
}>(), {
  format: (value: number) => `${(value * 100).toFixed(1)}%`,
  max: 1,
})

const barHeight = 10
const gap = 2
const groupGap = 10
const root = useTemplateRef<HTMLElement>('root')
const width = useElementWidth(root, 640)
const labelWidth = computed(() => Math.min(260, Math.round(width.value * 0.3)))
const plotWidth = computed(() => width.value - labelWidth.value - 70)

/** Series with at least one value; an all-empty series (e.g. a score only the tasks of another eval record) is dropped. */
const shown = computed(() => props.series.map((name, index) => ({ index, name })).filter(({ index }) => props.data.some(datum => datum.values[index] != null)))
const rows = computed(() => {
  let y = 4
  return props.data.map((datum) => {
    const top = y
    y += Math.max(1, shown.value.length) * (barHeight + gap) - gap + groupGap
    return { ...datum, top, values: shown.value.map(({ index }) => datum.values[index] ?? null) }
  })
})
const height = computed(() => (rows.value.at(-1)?.top ?? 0) + Math.max(1, shown.value.length) * (barHeight + gap) + 10)
const scale = (value: number) => Math.max(0, Math.min(1, value / props.max)) * plotWidth.value

const hover = shallowRef<{ text: string, x: number, y: number }>()
const colors = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)']
</script>

<template>
  <figure ref="root" :class="['relative w-full']" data-testid="bar-chart">
    <div v-if="shown.length > 1" :class="['flex gap-3 text-xs muted mb-1']">
      <span v-for="(item, position) in shown" :key="item.name" :class="['inline-flex items-center gap-1']">
        <span :class="['inline-block w-2.5 h-2.5 rounded-sm']" :style="{ background: colors[position] }" />{{ item.name }}
      </span>
    </div>
    <svg :viewBox="`0 0 ${width} ${height}`" :class="['w-full h-auto']" role="img" :aria-label="`Bar chart of ${shown.map(series => series.name).join(', ')}`" @mouseleave="hover = undefined">
      <g :transform="`translate(${labelWidth}, 0)`">
        <line v-for="tick in [0, 0.25, 0.5, 0.75, 1]" :key="tick" :x1="tick * plotWidth" :x2="tick * plotWidth" y1="0" :y2="height - 6" stroke="var(--chart-grid)" stroke-width="1" />
        <text v-for="tick in [0, 0.5, 1]" :key="`t${tick}`" :x="tick * plotWidth" :y="height" font-size="9" fill="var(--chart-text)" text-anchor="middle">{{ props.format(tick * props.max) }}</text>
      </g>
      <g v-for="row in rows" :key="row.label">
        <a :href="row.href">
          <text :x="labelWidth - 8" :y="row.top + (row.values.length * (barHeight + gap)) / 2 + 3" font-size="11" text-anchor="end" fill="var(--chart-text)" :class="[row.href && 'underline']">{{ row.label.length > labelWidth / 6.5 ? `${row.label.slice(0, Math.floor(labelWidth / 6.5) - 1)}…` : row.label }}<title>{{ row.label }}</title></text>
        </a>
        <g v-for="(value, index) in row.values" :key="index" :transform="`translate(${labelWidth}, ${row.top + index * (barHeight + gap)})`">
          <rect :width="plotWidth" :height="barHeight" fill="transparent" @mousemove="hover = { text: `${row.label} · ${shown[index]?.name}: ${value == null ? 'no data' : props.format(value)}`, x: labelWidth + scale(value ?? 0), y: row.top + index * (barHeight + gap) }" />
          <rect v-if="value != null" :width="Math.max(2, scale(value))" :height="barHeight" rx="3" :fill="colors[index]" pointer-events="none" />
          <text :x="(value == null ? 0 : scale(value)) + 4" :y="barHeight - 1" font-size="10" fill="var(--chart-text)" pointer-events="none">{{ value == null ? 'no data' : props.format(value) }}</text>
        </g>
      </g>
    </svg>
    <div
      v-if="hover" role="tooltip"
      :class="['tooltip absolute pointer-events-none whitespace-nowrap']"
      :style="{ left: `${(hover.x / width) * 100}%`, top: `${hover.y}px`, transform: 'translate(8px, -4px)' }"
    >
      {{ hover.text }}
    </div>
  </figure>
</template>
