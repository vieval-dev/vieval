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
 * 66.1%  ↑2.3                 [running]
 * Title
 * meta (run counts, times)
 * Ends at 06:04      started 1h 12m ago   ← only while the run is running
 * ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ progress
 * ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ cases (counts on hover)
 * ╭──────────────────╮
 * │ tags (matrix)    │                       ← `footer` slot, an inset with the card's inner radius
 * ╰──────────────────╯
 * ```
 *
 * The surface is a faint fill with a hairline edge (the look of the matrix cells), not a bordered panel, so the
 * numbers stay the strongest thing on it. With `href` the whole card is the link; put no other links inside it.
 */
const props = defineProps<{
  counts?: CaseCounts
  href?: string
  /** Run whose progress shows while `state` is `running`. */
  run?: { lastSeq: number, runKey: string, startedAt?: string }
  /** Exact score, from 0 to 1; `null` before any case was scored. */
  score: null | number | undefined
  /**
   * What the score is (for example "best exact score of 12 runs"); the tooltip and accessible name of the number.
   *
   * @default 'exact score'
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
    :class="[
      'relative flex flex-col gap-2 p-4 min-w-0 rounded-xl transition-colors',
      'bg-neutral-500/5 border border-neutral-500/8',
      props.href && 'hover:(bg-primary-500/6 border-primary-500/15)',
    ]"
    data-testid="score-card"
  >
    <span :class="['flex items-start gap-2']">
      <span :class="['flex items-baseline flex-wrap gap-x-1.5 min-w-0']">
        <span :class="['text-2xl font-semibold tabular-nums leading-none']" :title="props.scoreLabel ?? 'exact score'" data-testid="score-card-score">
          {{ formatScore(props.score) }}<span :class="['sr-only']"> {{ props.scoreLabel ?? 'exact score' }}</span>
        </span>
        <!-- Change from the previous run, a trend line, …: facts about the score itself. -->
        <slot name="score" />
      </span>
      <StateBadge v-if="props.state" :class="['ml-auto shrink-0']" :state="props.state" />
    </span>
    <span v-if="props.title || $slots.title" :class="['font-semibold min-w-0 truncate']">
      <slot name="title">{{ props.title }}</slot>
    </span>
    <span v-if="$slots.default" :class="['flex flex-col gap-1 text-xs muted min-w-0']">
      <slot />
    </span>
    <span v-if="(props.run && props.state === 'running') || props.counts" :class="['flex flex-col gap-2.5 mt-auto pt-1']">
      <RunEta v-if="props.run && props.state === 'running'" :run-key="props.run.runKey" :seq="props.run.lastSeq" :started-at="props.run.startedAt" />
      <CountsBar v-if="props.counts" :counts="props.counts" labels="hover" />
    </span>
    <!-- Concentric corners: the inset sits 8 px inside the card's 12 px corners (`rounded-xl`), so its radius is 4 px. -->
    <span v-if="$slots.footer" :class="['flex flex-wrap gap-1 -mx-2 -mb-2 mt-1 p-2 rounded bg-neutral-500/6']">
      <slot name="footer" />
    </span>
  </component>
</template>
