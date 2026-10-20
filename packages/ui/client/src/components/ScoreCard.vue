<script setup lang="ts">
import type { CaseCounts, HeadlineResult, ScoreDefinition } from '../../../src/shared/contract'

import CountsBar from './CountsBar.vue'
import HeadlineScore from './HeadlineScore.vue'
import RunEta from './RunEta.vue'
import StateBadge from './StateBadge.vue'

/**
 * The standard card of a scored item (a project, a matrix cell, a compared column), laid out the same everywhere:
 *
 * ```
 * 66.1% Pass  ↑2.3            [running]
 * completed 96.8%
 * Title
 * meta (run counts, times)
 * Ends at 06:04      started 1h 12m ago   ← only while the run is running
 * ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ progress
 * ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ cases (counts on hover), or the `bar` slot
 * ╰──────────────────╯
 *  tags (matrix)                             ← `footer` slot, on the tray below the panel
 * ```
 *
 * A white panel raised on a gray tray (the anatomy of airi's `IconStatusItem`: a 2 px tray edge, the panel's corners
 * one step inside the tray's), so the numbers sit on the brightest surface and what describes the item (its matrix
 * values) sits on the tray below. With `href` the whole card is the link; put no other links inside it.
 */
const props = defineProps<{
  /** Tighter panel padding, for cards in a grid of many (matrix cells). */
  compact?: boolean
  counts?: CaseCounts
  /** `score.defined` of the headline's scores, for their labels and descriptions. */
  definitions: readonly ScoreDefinition[]
  /** Headline of the item ({@link HeadlineScore}); `null` before any case settled. */
  headline: HeadlineResult | null | undefined
  href?: string
  /** Run whose progress shows while `state` is `running`. */
  run?: { lastSeq: number, runKey: string, startedAt?: string }
  /** State of the item's newest run, in the top-right corner. */
  state?: string
  /** Readable name of a task, for a headline that lists each task's primary score. */
  taskLabel?: (taskId: string) => string
  title?: string
}>()
</script>

<template>
  <component
    :is="props.href ? 'a' : 'div'"
    :href="props.href"
    :class="[
      'flex flex-col min-w-0 rounded-xl overflow-hidden transition-colors',
      'bg-neutral-100/70 dark:bg-neutral-800/60 border-2 border-neutral-200/50 dark:border-neutral-800/40',
      props.href && 'hover:border-primary-500/30 dark:hover:border-primary-400/30',
    ]"
    data-testid="score-card"
  >
    <span :class="['relative flex flex-col gap-2 flex-1 min-w-0 rounded-lg bg-white dark:bg-neutral-900', props.compact ? 'p-3 md:p-3.5' : 'p-4']">
      <span :class="['flex items-start gap-2']">
        <HeadlineScore :class="['min-w-0']" :result="props.headline" :definitions="props.definitions" size="lg" :task-label="props.taskLabel" data-testid="score-card-score">
          <!-- Change from the previous run, a trend line, …: facts about the score itself. -->
          <slot name="score" />
        </HeadlineScore>
        <StateBadge v-if="props.state" :class="['ml-auto shrink-0']" :state="props.state" />
      </span>
      <span v-if="props.title || $slots.title" :class="['font-semibold min-w-0 truncate']">
        <slot name="title">{{ props.title }}</slot>
      </span>
      <span v-if="$slots.default" :class="['flex flex-col gap-1 text-xs muted min-w-0']">
        <slot />
      </span>
      <span v-if="(props.run && props.state === 'running') || props.counts || $slots.bar" :class="['flex flex-col gap-2.5 mt-auto pt-1']">
        <RunEta v-if="props.run && props.state === 'running'" :run-key="props.run.runKey" :seq="props.run.lastSeq" :started-at="props.run.startedAt" />
        <!-- Another bar in place of the case counts, for example how the scores spread in a scored eval. -->
        <slot name="bar">
          <CountsBar v-if="props.counts" :counts="props.counts" labels="hover" />
        </slot>
      </span>
    </span>
    <span v-if="$slots.footer" :class="['flex flex-wrap gap-1 px-2 py-1.5']">
      <slot name="footer" />
    </span>
  </component>
</template>
