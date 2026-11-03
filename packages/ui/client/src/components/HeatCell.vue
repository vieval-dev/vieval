<script setup lang="ts">
import { HoverCardArrow, HoverCardContent, HoverCardPortal, HoverCardRoot, HoverCardTrigger } from 'reka-ui'
import { computed } from 'vue'

import AnimatedContent from './AnimatedContent.vue'

/** How a {@link HeatCell} is filled. */
export interface HeatFill {
  /** Within noise: the fill stays faint whatever its strength. */
  faint?: boolean
  /** `gain` (a score, or a difference that is better) in the score hue; `loss` in its opposite hue. */
  hue: 'gain' | 'loss'
  /** Strength of the fill on its scale, 0–1. */
  strength: number
}

/**
 * One compact heat cell: a number on a fill whose strength follows its value, so a whole grid reads at a glance, with
 * its details in a hover card. Shared by the compact matrix ({@link MatrixHeatCell}) and the comparison's score table.
 *
 * Use for a grid of comparable values (scores, or differences from a baseline) where each cell has more to say than
 * its number. A baseline cell is unfilled inside a dashed outline; the best cell of its row or axis is outlined.
 *
 * NOTICE:
 * The fill stays within 10–50% and the text keeps the page's ink. Measured on the card surfaces (WCAG contrast), the
 * page ink over a 50% fill of the score hue or its opposite is at least 5.7:1 in both themes; above 60% it falls under
 * 4.5:1 for some hue, and a dark or white ink there (the former `--heat-ink`) stayed under 4.5:1 for the loss hue on
 * dark pages.
 */
const props = defineProps<{
  /** Outlined: the best cell of its row (matrix) or axis (score table). */
  best?: boolean
  /** Narrow cells for wide grids: smaller type. */
  dense?: boolean
  /** The cell has no value: gray and muted. */
  empty?: boolean
  /** `undefined` leaves the cell unfilled (no value, an incomplete cell). */
  fill?: HeatFill
  /** As wide as its column (at least a compact cell), for values with a unit such as "−25.0 pt". */
  fit?: boolean
  href?: string
  /** The baseline's own cell: unfilled inside a dashed outline, for the differences around it. */
  isBase?: boolean
  testId?: string
  text: string
}>()
defineSlots<{
  /** Marks drawn inside the cell (a completion ring). */
  default?: () => unknown
  /** Body of the hover card. */
  detail?: () => unknown
}>()

const style = computed(() => {
  if (props.fill == null || props.isBase)
    return undefined
  const mix = Math.round(10 + props.fill.strength * 40)
  const hue = props.fill.hue === 'loss' ? 'var(--series-1-opposite)' : 'var(--series-1)'
  return { background: `color-mix(in oklab, ${hue} ${props.fill.faint ? Math.min(mix, 18) : mix}%, transparent)` }
})
</script>

<template>
  <HoverCardRoot :open-delay="250" :close-delay="80">
    <HoverCardTrigger as-child>
      <component
        :is="props.href ? 'a' : 'span'"
        :href="props.href"
        :tabindex="props.href ? undefined : 0"
        :class="[
          'relative flex items-center justify-center rounded-md tabular-nums transition-[outline-color]',
          'outline-2 -outline-offset-2 outline outline-transparent hover:outline-neutral-500/50 focus-visible:outline-primary-500',
          props.dense ? 'w-10 h-7 text-[11px]' : 'h-9 text-sm',
          !props.dense && (props.fit ? 'min-w-15 w-full px-1.5 whitespace-nowrap' : 'w-15'),
          (props.empty || (props.fill == null && !props.isBase)) && 'bg-neutral-500/10 muted',
          props.isBase && 'muted outline-dashed outline-neutral-400/70! dark:outline-neutral-500/70!',
          props.best && 'font-semibold outline-neutral-900! dark:outline-neutral-100!',
        ]"
        :style="style"
        :data-testid="props.testId"
      >
        {{ props.text }}
        <slot />
      </component>
    </HoverCardTrigger>
    <HoverCardPortal v-if="$slots.detail">
      <HoverCardContent as-child side="right" align="start" :side-offset="6" :collision-padding="8" :class="['floating']">
        <AnimatedContent>
          <slot name="detail" />
          <HoverCardArrow :class="['floating-arrow']" />
        </AnimatedContent>
      </HoverCardContent>
    </HoverCardPortal>
  </HoverCardRoot>
</template>
