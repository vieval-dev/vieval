<script setup lang="ts">
import type { ScoreDefinition } from '../../../src/shared/contract'
import type { CellComparison, GridCell } from '../matrixGrid'

import { HoverCardArrow, HoverCardContent, HoverCardPortal, HoverCardRoot, HoverCardTrigger } from 'reka-ui'
import { computed } from 'vue'

import AnimatedContent from './AnimatedContent.vue'
import CompletionRing from './CompletionRing.vue'
import MatrixCellDetail from './MatrixCellDetail.vue'

import { href } from '../router'

/**
 * One cell of the compact matrix: its score (or its difference from the baseline) on a fill whose strength follows
 * the value, so a whole grid reads at a glance. Hovering opens the cell's details ({@link MatrixCellDetail}: its full
 * card, configuration, every score, and its baseline comparison); the cell itself links to the task like the card does.
 */
const props = defineProps<{
  averagedNames: readonly string[]
  /** Text of the reader's baseline, for the comparison in the details. */
  baselineLabel?: string
  /** Outlined: the best settled cell of its row. */
  best?: boolean
  cell: GridCell
  comparison?: CellComparison
  /** The cell's values on the laid-out axes, for the details. */
  coordinates: readonly { name: string, value: string }[]
  definitions: readonly ScoreDefinition[]
  /** Narrow cells for wide grids: whole numbers, smaller type. */
  dense?: boolean
  /** The cell is a baseline cell: its own score, unfilled inside a dashed outline, for the differences around it. */
  isBase?: boolean
  /** Fill strength 0–1 (from the grid's color scale); `undefined` leaves the cell unfilled (incomplete, no pair). */
  strength?: number
}>()

const lead = computed(() => props.cell.members[0]!)
const shown = computed(() => {
  if (props.comparison != null) {
    const points = props.comparison.delta * 100
    const sign = points > 0 ? '+' : points < 0 ? '−' : '±'
    return `${sign}${Math.abs(points).toFixed(props.dense ? 0 : 1)}`
  }
  return props.cell.value == null ? '—' : (props.cell.value * 100).toFixed(props.dense ? 0 : 1)
})
// Gains and plain scores in the score hue, losses in teal (`PairsHeatmap.vue`); a difference within noise is faint.
const hue = computed(() => (props.comparison != null && props.comparison.delta < 0 ? 'var(--series-3)' : 'var(--series-1)'))
const style = computed(() => {
  if (props.strength == null || props.isBase)
    return undefined
  const mix = Math.round(10 + props.strength * 85)
  const faint = props.comparison != null && !props.comparison.clear
  return {
    background: `color-mix(in oklab, ${hue.value} ${faint ? Math.min(mix, 30) : mix}%, transparent)`,
    color: !faint && mix > 60 ? 'var(--heat-ink)' : undefined,
  }
})
</script>

<template>
  <HoverCardRoot :open-delay="250" :close-delay="80">
    <HoverCardTrigger as-child>
      <a
        :href="href({ name: 'task', runKey: lead.latest.runKey, taskId: lead.latest.taskId })"
        :class="[
          'relative flex items-center justify-center rounded-md tabular-nums transition-[outline-color]',
          'outline-2 -outline-offset-2 outline outline-transparent hover:outline-neutral-500/50 focus-visible:outline-primary-500',
          props.dense ? 'w-10 h-7 text-[11px]' : 'w-15 h-9 text-sm',
          props.strength == null && !props.isBase && 'bg-neutral-500/10 muted',
          props.isBase && 'muted outline-dashed outline-neutral-400/70! dark:outline-neutral-500/70!',
          props.best && 'font-semibold outline-neutral-900! dark:outline-neutral-100!',
        ]"
        :style="style"
        data-testid="matrix-heat-cell"
      >
        {{ shown }}
        <CompletionRing v-if="props.cell.completion" :class="['absolute top-0.5 right-0.5']" :completion="props.cell.completion" :size="props.dense ? 9 : 11" />
      </a>
    </HoverCardTrigger>
    <HoverCardPortal>
      <HoverCardContent as-child side="right" align="start" :side-offset="6" :collision-padding="8" :class="['floating']">
        <AnimatedContent>
          <MatrixCellDetail :cell="props.cell" :comparison="props.comparison" :coordinates="props.coordinates" :baseline-label="props.baselineLabel" :definitions="props.definitions" :averaged-names="props.averagedNames" />
          <HoverCardArrow :class="['floating-arrow']" />
        </AnimatedContent>
      </HoverCardContent>
    </HoverCardPortal>
  </HoverCardRoot>
</template>
