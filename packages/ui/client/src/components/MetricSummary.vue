<script setup lang="ts">
import type { MetricDefinition } from '../../../src/shared/contract'

import { computed } from 'vue'

import { localize } from '../localize'

/**
 * What a metric is and how its values spread: label, name, description, unit and direction, and a small
 * distribution (a histogram for numbers, a stacked bar for categories), with the value of one case marked.
 *
 * Use as the body of a hover card ({@link MetricInfo}) or of a chart's floating tooltip.
 */
const props = defineProps<{
  /** Value of the case being looked at, marked on the distribution. */
  // NOTICE: no `boolean` here: Vue casts an absent prop whose type includes Boolean to `false`, which would
  // mark a value on cards that have no current case. Callers pass flags as strings.
  current?: number | string
  definition?: MetricDefinition
  name: string
  /** Every recorded value of the metric in scope (one per case); `undefined` entries are cases without it. */
  values: readonly unknown[]
}>()

const label = computed(() => localize(props.definition?.label))
const description = computed(() => localize(props.definition?.description))
const unit = computed(() => props.definition?.unit)

/** Histogram bins of numeric values; most metrics have a long tail, so a handful of bins reads best. */
const BINS = 16
/** Category values past this many share one "other" segment. */
const TOP_CATEGORIES = 6

const numbers = computed(() => props.values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)))
const numeric = computed(() => numbers.value.length > 0 && numbers.value.length >= props.values.filter(value => value != null).length / 2)

const histogram = computed(() => {
  const sorted = numbers.value.toSorted((a, b) => a - b)
  if (sorted.length === 0)
    return undefined
  const min = sorted[0]!
  const max = sorted.at(-1)!
  const width = (max - min) / BINS || 1
  const counts = Array.from<number>({ length: BINS }).fill(0)
  for (const value of sorted)
    counts[Math.min(BINS - 1, Math.floor((value - min) / width))]! += 1
  const at = (value: number) => (max === min ? 0.5 : (value - min) / (max - min))
  return {
    counts,
    current: typeof props.current === 'number' ? at(props.current) : undefined,
    max,
    median: sorted[Math.floor(sorted.length / 2)]!,
    min,
    peak: Math.max(...counts),
  }
})

const categories = computed(() => {
  const counts = new Map<string, number>()
  for (const value of props.values) {
    if (value != null)
      counts.set(String(value), (counts.get(String(value)) ?? 0) + 1)
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
  const ranked = [...counts].sort((a, b) => b[1] - a[1])
  const shown = ranked.slice(0, TOP_CATEGORIES).map(([value, count], index) => ({ color: `var(--series-${index + 1})`, count, value }))
  const rest = ranked.slice(TOP_CATEGORIES).reduce((sum, [, count]) => sum + count, 0)
  return { segments: rest > 0 ? [...shown, { color: 'var(--chart-text)', count: rest, value: `${ranked.length - TOP_CATEGORIES} more` }] : shown, total }
})

function format(value: number): string {
  const text = Math.abs(value) >= 1000 ? Intl.NumberFormat(undefined, { maximumFractionDigits: 1, notation: 'compact' }).format(value) : String(Math.round(value * 100) / 100)
  return unit.value == null ? text : `${text} ${unit.value}`
}
</script>

<template>
  <div :class="['grid gap-1.5 w-64 text-xs']" data-testid="metric-summary">
    <div>
      <div :class="['text-sm font-semibold leading-snug']">
        {{ label ?? props.name }}
      </div>
      <div v-if="label" :class="['mono text-[11px] opacity-70 break-all']">
        {{ props.name }}
      </div>
    </div>
    <p v-if="description" :class="['m-0 leading-snug opacity-90']">
      {{ description }}
    </p>
    <div v-if="unit || props.definition?.better" :class="['flex flex-wrap gap-x-3 gap-y-0.5 opacity-80']">
      <span v-if="unit">unit · {{ unit }}</span>
      <span v-if="props.definition?.better" :class="['inline-flex items-center gap-0.5']">
        <span :class="[props.definition.better === 'higher' ? 'i-mingcute-arrow-up-line' : 'i-mingcute-arrow-down-line']" aria-hidden="true" />{{ props.definition.better }} is better
      </span>
    </div>

    <figure v-if="numeric && histogram" :class="['m-0 grid gap-0.5']" :aria-label="`Distribution of ${props.values.length} values`">
      <svg viewBox="0 0 256 36" :class="['w-full h-9']" role="img" :aria-label="`Histogram from ${format(histogram.min)} to ${format(histogram.max)}`">
        <rect
          v-for="(count, index) in histogram.counts" :key="index"
          :x="index * 16 + 1" :width="14" :y="34 - (count / histogram.peak) * 32" :height="Math.max(count > 0 ? 1 : 0, (count / histogram.peak) * 32)"
          rx="1.5" fill="var(--series-1)" :fill-opacity="0.75"
        />
        <line v-if="histogram.current !== undefined" :x1="histogram.current * 254 + 1" :x2="histogram.current * 254 + 1" y1="0" y2="36" stroke="currentColor" stroke-width="2" />
      </svg>
      <figcaption :class="['flex justify-between mono text-[10px] opacity-80']">
        <span>{{ format(histogram.min) }}</span><span>median {{ format(histogram.median) }}</span><span>{{ format(histogram.max) }}</span>
      </figcaption>
      <div v-if="props.current !== undefined" :class="['mono text-[10px]']">
        this case: {{ typeof props.current === 'number' ? format(props.current) : props.current }}
      </div>
    </figure>

    <figure v-else-if="categories.total > 0" :class="['m-0 grid gap-1']">
      <div :class="['flex h-2 rounded-sm overflow-hidden gap-px']">
        <span v-for="segment in categories.segments" :key="segment.value" :style="{ background: segment.color, width: `${(segment.count / categories.total) * 100}%` }" />
      </div>
      <ul :class="['m-0 p-0 list-none grid gap-0.5']">
        <li v-for="segment in categories.segments" :key="segment.value" :class="['flex items-center gap-1.5', String(props.current) === segment.value && 'font-semibold']">
          <span :class="['inline-block size-2 rounded-sm shrink-0']" :style="{ background: segment.color }" />
          <span :class="['truncate']">{{ segment.value }}</span>
          <span :class="['ml-auto mono opacity-80']">{{ segment.count }}</span>
        </li>
      </ul>
    </figure>
    <div :class="['opacity-70']">
      {{ props.values.filter(value => value != null).length }} value(s)
    </div>
  </div>
</template>
