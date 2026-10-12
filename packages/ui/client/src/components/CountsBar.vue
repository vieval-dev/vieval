<script setup lang="ts">
import type { CaseCounts } from '../../../src/shared/contract'

import { TooltipArrow, TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui'
import { computed } from 'vue'

import { formatCount } from '../format'

/**
 * The one indicator of case outcomes in the viewer: a thin stacked bar of passed / failed / running / other cases.
 *
 * The bar never carries text next to it; the numbers are one hover away, depending on where it sits:
 * - `hover` (cards, summaries): hovering or focusing the bar thickens it and shows each segment's count right above
 *   that segment; the label row is reserved above the bar, so the card does not move.
 * - `tooltip` (list rows, tree rows, table cells, page headers): the counts open in a tooltip, so the bar fits a
 *   single line of any height.
 * - `none` (inside an option that is itself interactive, such as a switcher item): the bar alone, with the counts as
 *   its accessible name; the option around it says the rest.
 *
 * Counts from 10 000 on use compact notation (`1M`); the accessible name and the tooltip carry the exact numbers.
 */
// The tooltip variant's root is reka's `TooltipRoot`, which renders no element: classes such as a width would be
// dropped, so every variant binds the attributes to its own outer element.
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  counts: CaseCounts
  /** @default 'tooltip' */
  labels?: 'hover' | 'none' | 'tooltip'
}>(), { labels: 'tooltip' })

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
const summary = computed(() => [...parts.value.map(part => `${part.value} ${part.label}`), `${props.counts.total} total`].join(', '))
</script>

<template>
  <!-- Hover labels: a label row with the same segment widths sits above the bar; the bar clips its own segments for
       the round ends, so the labels cannot live inside them. -->
  <div
    v-if="props.labels === 'hover'"
    v-bind="$attrs"
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
  <div v-else-if="props.labels === 'none'" v-bind="$attrs" role="img" :aria-label="summary" :class="['flex h-1.5 gap-[2px] overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800']" data-testid="counts-bar">
    <div v-for="part in parts" :key="part.label" :class="[part.class, 'h-full rounded-full min-w-1.5']" :style="{ width: part.width }" />
  </div>
  <TooltipRoot v-else :delay-duration="150">
    <TooltipTrigger as-child>
      <!-- The padding widens the hover target of a 6 px bar without moving it. -->
      <div v-bind="$attrs" :class="['group py-1.5 -my-1.5 min-w-12 outline-none']" tabindex="0" role="img" :aria-label="summary" data-testid="counts-bar-tooltip">
        <div :class="['flex h-1.5 gap-[2px] overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800', 'transition-[height] duration-200 group-hover:h-2 group-focus-visible:h-2']" data-testid="counts-bar">
          <div v-for="part in parts" :key="part.label" :class="[part.class, 'h-full rounded-full min-w-1.5']" :style="{ width: part.width }" />
        </div>
      </div>
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent :side-offset="4" :class="['tooltip', 'flex items-center gap-2 tabular-nums']" data-testid="counts-tooltip">
        <span v-for="part in parts" :key="part.label" :class="['inline-flex items-center gap-1']">
          <span :class="[part.class, 'size-2 rounded-full']" aria-hidden="true" />{{ formatCount(part.value) }} {{ part.label }}
        </span>
        <span :class="['opacity-70']">/ {{ formatCount(props.counts.total) }}</span>
        <TooltipArrow :class="['tooltip-arrow']" />
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
