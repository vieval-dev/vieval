<script setup lang="ts">
import type { CaseCounts } from '../../../src/shared/contract'

import { computed } from 'vue'

import { formatCount } from '../format'

/**
 * Proportions of passed / failed / running / other cases as one thin stacked bar.
 *
 * `labels`:
 * - `inline` (lists and tables): the counts follow the bar as text; from 10 000 on in compact notation (`1M`, the
 *   exact number is the tooltip), and the text wraps below the bar when both do not fit side by side.
 * - `below` (cards and summaries): the bar spans the full width and the counts sit under it, so the bar keeps its
 *   length on narrow screens.
 * - `hover` (cards): no text; hovering or focusing the bar thickens it and shows each segment's count right above
 *   that segment, so a card stays a big number and a bar.
 */
const props = withDefaults(defineProps<{
  counts: CaseCounts
  /** @default 'inline' */
  labels?: 'below' | 'hover' | 'inline'
  /** Inline labels only. @default true */
  showText?: boolean
}>(), { labels: 'inline', showText: true })

const parts = computed(() => {
  const { failed, passed, running, skipped, timeout, total } = props.counts
  const other = Math.max(0, total - passed - failed - running - timeout - skipped) + skipped
  const sum = Math.max(1, total)
  return [
    { class: 'bg-green-600 dark:bg-green-500', label: 'passed', text: 'text-green-700 dark:text-green-400', value: passed },
    { class: 'bg-red-600 dark:bg-red-500', label: 'failed', text: 'text-red-700 dark:text-red-400', value: failed + timeout },
    { class: 'bg-blue-500 vv-pulse', label: 'running', text: 'text-blue-700 dark:text-blue-400', value: running },
    { class: 'bg-neutral-400 dark:bg-neutral-600', label: 'other', text: 'muted', value: other },
  ].filter(part => part.value > 0).map(part => ({ ...part, width: `${(part.value / sum) * 100}%` }))
})
const failed = computed(() => props.counts.failed + props.counts.timeout)
const summary = computed(() => parts.value.map(part => `${part.value} ${part.label}`).join(', '))
</script>

<template>
  <!-- Hover labels: a label row with the same segment widths sits above the bar; the bar clips its own segments for
       the round ends, so the labels cannot live inside them. -->
  <div
    v-if="props.labels === 'hover'"
    :class="['group relative pt-5 outline-none']"
    tabindex="0"
    role="img"
    :aria-label="summary"
    :title="summary"
    data-testid="counts-bar-hover"
  >
    <div :class="['absolute inset-x-0 top-0 flex gap-[2px]', 'opacity-0 translate-y-1 transition-all duration-200', 'group-hover:(opacity-100 translate-y-0) group-focus-visible:(opacity-100 translate-y-0)']" aria-hidden="true">
      <span v-for="part in parts" :key="part.label" :class="['min-w-1.5 text-center text-xs font-semibold tabular-nums whitespace-nowrap', part.text]" :style="{ width: part.width }" data-testid="counts-segment-label">
        {{ formatCount(part.value) }}
      </span>
    </div>
    <div :class="['flex h-1.5 gap-[2px] overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800', 'transition-[height] duration-200 group-hover:h-2.5 group-focus-visible:h-2.5']" data-testid="counts-bar">
      <div v-for="part in parts" :key="part.label" :class="[part.class, 'h-full rounded-full min-w-1.5']" :style="{ width: part.width }" />
    </div>
  </div>
  <div v-else :class="['min-w-0', props.labels === 'below' ? 'flex flex-col gap-1.5' : 'flex flex-wrap items-center gap-x-2 gap-y-1']">
    <div :class="['flex h-1.5 gap-[2px] overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800', props.labels === 'below' ? 'w-full' : 'grow basis-24 min-w-24']" role="img" :aria-label="summary" data-testid="counts-bar">
      <div v-for="part in parts" :key="part.label" :class="[part.class, 'h-full rounded-full min-w-1.5']" :style="{ width: part.width }" :title="`${part.value} ${part.label}`" />
    </div>
    <span
      v-if="props.showText"
      :class="['inline-flex items-center gap-1 shrink-0', 'mono text-xs muted whitespace-nowrap', props.labels === 'below' && 'self-start']"
      :title="`${props.counts.passed} passed · ${failed} failed${props.counts.running ? ` · ${props.counts.running} running` : ''} · ${props.counts.total} total`"
      data-testid="counts-text"
    >
      <span :class="['inline-flex items-center gap-0.5', 'text-green-700 dark:text-green-400']">{{ formatCount(props.counts.passed) }}<span class="i-mingcute-check-line" aria-label="passed" /></span>
      <span :class="['inline-flex items-center gap-0.5', 'text-red-700 dark:text-red-400']">{{ formatCount(failed) }}<span class="i-mingcute-close-line" aria-label="failed" /></span>
      <span v-if="props.counts.running" :class="['inline-flex items-center gap-0.5', 'text-blue-700 dark:text-blue-400']">{{ formatCount(props.counts.running) }}<span class="i-mingcute-loading-line" aria-label="running" /></span>
      <span>/ {{ formatCount(props.counts.total) }}</span>
    </span>
  </div>
</template>
