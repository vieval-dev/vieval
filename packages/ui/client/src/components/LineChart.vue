<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue'

import { useElementWidth } from '../composables/useElementWidth'
import { extent } from '../extent'

/** One point; `x` is a number (time in ms or an index). */
export interface LinePoint { label: string, x: number, y: number }

/**
 * Single-series line chart with markers and a crosshair tooltip.
 *
 * Use for one numeric metric over time (metric points, gauge data points). One series per chart: several metrics
 * become small multiples, never a second y-axis.
 */
const props = withDefaults(defineProps<{
  format?: (value: number) => string
  height?: number
  /** Name of the series (the chart title names it; no legend). */
  name: string
  points: LinePoint[]
}>(), {
  format: (value: number) => (Math.abs(value) >= 1000 ? value.toFixed(0) : String(Math.round(value * 1000) / 1000)),
  height: 120,
})

const root = useTemplateRef<HTMLElement>('root')
const width = useElementWidth(root, 480)
const pad = { bottom: 16, left: 44, right: 8, top: 8 }
const bounds = computed(() => {
  const x = extent(props.points.map(point => point.x))
  const y = extent(props.points.map(point => point.y))
  const minY = Math.min(0, y.min)
  const maxY = Math.max(y.max, minY + 1e-9)
  return { maxX: x.max, maxY, minX: x.min, minY }
})
function sx(x: number) {
  const { maxX, minX } = bounds.value
  return pad.left + (maxX === minX ? 0.5 : (x - minX) / (maxX - minX)) * (width.value - pad.left - pad.right)
}
function sy(y: number) {
  const { maxY, minY } = bounds.value
  return pad.top + (1 - (y - minY) / (maxY - minY)) * (props.height - pad.top - pad.bottom)
}
/** Points in x order: data can arrive out of order (gauges of concurrent cases), and a line must not run backwards. */
const sorted = computed(() => props.points.toSorted((a, b) => a.x - b.x))
const path = computed(() => sorted.value.map((point, index) => `${index === 0 ? 'M' : 'L'}${sx(point.x).toFixed(1)},${sy(point.y).toFixed(1)}`).join(' '))
const hover = shallowRef<LinePoint>()
const tooltipStyle = computed(() => {
  if (hover.value == null)
    return {}
  const x = sx(hover.value.x)
  const left = x <= width.value / 2
  return {
    maxWidth: `${Math.max(80, (left ? width.value - x : x) - 12)}px`,
    top: '14px',
    ...(left ? { left: `${x + 8}px` } : { right: `${width.value - x + 8}px` }),
  }
})

function onMove(event: MouseEvent): void {
  const svg = event.currentTarget as SVGSVGElement
  const box = svg.getBoundingClientRect()
  const x = ((event.clientX - box.left) / box.width) * width.value
  let best: LinePoint | undefined
  for (const point of props.points) {
    if (best == null || Math.abs(sx(point.x) - x) < Math.abs(sx(best.x) - x))
      best = point
  }
  hover.value = best
}
</script>

<template>
  <figure ref="root" :class="['relative w-full']" data-testid="line-chart">
    <figcaption :class="['text-xs font-medium mb-0.5']">
      {{ props.name }}
    </figcaption>
    <svg :viewBox="`0 0 ${width} ${props.height}`" :class="['w-full h-auto']" role="img" :aria-label="`Line chart of ${props.name}`" @mousemove="onMove" @mouseleave="hover = undefined">
      <line v-for="fraction in [0, 0.5, 1]" :key="fraction" :x1="pad.left" :x2="width - pad.right" :y1="sy(bounds.minY + (bounds.maxY - bounds.minY) * fraction)" :y2="sy(bounds.minY + (bounds.maxY - bounds.minY) * fraction)" stroke="var(--chart-grid)" />
      <text v-for="fraction in [0, 1]" :key="`l${fraction}`" :x="pad.left - 4" :y="sy(bounds.minY + (bounds.maxY - bounds.minY) * fraction) + 3" font-size="9" text-anchor="end" fill="var(--chart-text)">{{ props.format(bounds.minY + (bounds.maxY - bounds.minY) * fraction) }}</text>
      <path :d="path" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" />
      <circle v-for="(point, index) in props.points.length <= 80 ? props.points : []" :key="index" :cx="sx(point.x)" :cy="sy(point.y)" r="3" fill="var(--series-1)" stroke="var(--chart-surface, white)" stroke-width="1" />
      <g v-if="hover">
        <line :x1="sx(hover.x)" :x2="sx(hover.x)" :y1="pad.top" :y2="props.height - pad.bottom" stroke="var(--chart-text)" stroke-dasharray="2 2" />
        <circle :cx="sx(hover.x)" :cy="sy(hover.y)" r="4.5" fill="var(--series-1)" stroke="white" stroke-width="2" />
      </g>
    </svg>
    <!--
      `z-10`: charts sit side by side as positioned siblings, and a later sibling would otherwise paint over this
      tooltip. Past the middle of the chart the tooltip opens to the left; either way it is at most as wide as the room
      on that side, so a long label is cut instead of covering the neighbor or the sidebar.
    -->
    <div
      v-if="hover" role="tooltip"
      :class="['tooltip absolute z-10 pointer-events-none truncate']"
      :style="tooltipStyle"
    >
      {{ hover.label }}: <b>{{ props.format(hover.y) }}</b>
    </div>
  </figure>
</template>
