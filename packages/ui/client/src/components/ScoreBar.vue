<script setup lang="ts">
import { TooltipArrow, TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui'
import { computed } from 'vue'

import { formatCount, formatTick } from '../format'

// `TooltipRoot` renders no element, so a width given to this component lands on the trigger (as in CountsBar).
defineOptions({ inheritAttrs: false })

/**
 * How the scores of cases spread: a thin stacked bar with one segment per score (a 0 / 1 score, the 0 ⅓ ⅔ 1 of three
 * votes) or per fifth of the range for scores with many values, low to high, in the sequential ramp the case charts
 * color scores with. The counts open in a tooltip, like {@link CountsBar}, whose anatomy it shares.
 *
 * Use when:
 * - a task or run header shows where its score comes from, next to the mean (a 65.7 % mean is 44 cases at 1 and 23 at
 *   0, not 67 cases at 0.66)
 */
const props = defineProps<{
  /** One score per case (0–1); cases without a score are left out. */
  scores: readonly (null | number | undefined)[]
}>()

/** Distinct scores up to this many get a segment each; more are binned into as many equal parts of the range. */
const MAX_SEGMENTS = 5

const parts = computed(() => {
  const values = props.scores.filter((value): value is number => value != null && Number.isFinite(value))
  if (values.length === 0)
    return []
  const distinct = [...new Set(values)].sort((a, b) => a - b)
  const groups = distinct.length <= MAX_SEGMENTS
    ? distinct.map(value => ({ count: values.filter(item => item === value).length, label: formatTick(value) }))
    : binned(values)
  const used = groups.filter(group => group.count > 0)
  return used.map((group, index) => ({
    ...group,
    // Spread over the whole ramp, so two segments are its two ends; the low scores take the most ink, as on the case
    // charts colored by a score.
    color: `var(--seq-${used.length <= 1 ? 1 : 5 - Math.round((index * 4) / (used.length - 1))})`,
    width: `${(group.count / values.length) * 100}%`,
  }))
})
const summary = computed(() => parts.value.map(part => `${part.count} at ${part.label}`).join(', '))

function binned(values: readonly number[]): { count: number, label: string }[] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const width = (max - min) / MAX_SEGMENTS
  return Array.from({ length: MAX_SEGMENTS }, (_, index) => {
    const from = min + index * width
    const to = index === MAX_SEGMENTS - 1 ? max : from + width
    return {
      count: values.filter(value => value >= from && (index === MAX_SEGMENTS - 1 ? value <= to : value < to)).length,
      label: `${formatTick(from)}–${formatTick(to)}`,
    }
  })
}
</script>

<template>
  <TooltipRoot v-if="parts.length > 0" :delay-duration="150">
    <TooltipTrigger as-child>
      <!-- The padding widens the hover target of a 6 px bar without moving it (as in CountsBar). -->
      <div v-bind="$attrs" :class="['group py-1.5 -my-1.5 min-w-12 outline-none']" tabindex="0" role="img" :aria-label="`Scores: ${summary}`" data-testid="score-bar">
        <div :class="['flex h-1.5 gap-[2px] overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800', 'transition-[height] duration-200 group-hover:h-2 group-focus-visible:h-2']">
          <div v-for="part in parts" :key="part.label" :class="['h-full rounded-full min-w-1.5']" :style="{ background: part.color, width: part.width }" />
        </div>
      </div>
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent :side-offset="4" :class="['tooltip', 'flex items-center gap-2 tabular-nums']">
        <span v-for="part in parts" :key="part.label" :class="['inline-flex items-center gap-1']">
          <span :class="['size-2 rounded-full']" :style="{ background: part.color }" aria-hidden="true" />{{ formatCount(part.count) }} at {{ part.label }}
        </span>
        <TooltipArrow :class="['tooltip-arrow']" />
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
