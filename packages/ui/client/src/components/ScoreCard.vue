<script setup lang="ts">
import type { CaseCounts } from '../../../src/shared/contract'

import CountsBar from './CountsBar.vue'
import RunEta from './RunEta.vue'
import StateBadge from './StateBadge.vue'

import { formatScore } from '../format'

/**
 * The standard card of a scored item (a project, a matrix cell, a compared column), laid out the same everywhere:
 *
 * ```
 * 66.1% exact  ↑2.3          [running]
 * Title
 * meta (dates, run count, chips)
 * Ends around 06:04 · started 1h 12m ago   ← only while the run is running
 * ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ progress
 * ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ cases (counts on hover)
 * ```
 *
 * With `href` the whole card is the link; put no other links inside it.
 */
const props = defineProps<{
  counts?: CaseCounts
  href?: string
  /** Run whose progress shows while `state` is `running`. */
  run?: { lastSeq: number, runKey: string, startedAt?: string }
  /** Exact score, from 0 to 1; `null` before any case was scored. */
  score: null | number | undefined
  /**
   * What the score is, after the number.
   *
   * @default 'exact'
   */
  scoreLabel?: string
  /** State of the item's newest run, in the top-right corner. */
  state?: string
  title?: string
}>()
</script>

<template>
  <component
    :is="props.href ? 'a' : 'div'"
    :href="props.href"
    :class="['card relative flex flex-col gap-2 p-4 min-w-0', props.href && 'transition-colors hover:border-primary-400/60 hover:bg-primary-500/3']"
    data-testid="score-card"
  >
    <span :class="['flex items-start gap-2']">
      <span :class="['flex items-baseline flex-wrap gap-x-1.5 min-w-0']">
        <span :class="['text-2xl font-semibold tabular-nums leading-none']" data-testid="score-card-score">{{ formatScore(props.score) }}</span>
        <span :class="['text-xs muted']">{{ props.scoreLabel ?? 'exact' }}</span>
        <!-- Change from the previous run, a trend line, …: facts about the score itself. -->
        <slot name="score" />
      </span>
      <StateBadge v-if="props.state" :class="['ml-auto shrink-0']" :state="props.state" />
    </span>
    <span v-if="props.title || $slots.title" :class="['font-semibold min-w-0 truncate']">
      <slot name="title">{{ props.title }}</slot>
    </span>
    <span v-if="$slots.default" :class="['flex flex-col gap-1.5 text-xs muted min-w-0']">
      <slot />
    </span>
    <RunEta v-if="props.run && props.state === 'running'" :run-key="props.run.runKey" :seq="props.run.lastSeq" :started-at="props.run.startedAt" />
    <CountsBar v-if="props.counts" :class="['mt-auto']" :counts="props.counts" labels="hover" />
  </component>
</template>
