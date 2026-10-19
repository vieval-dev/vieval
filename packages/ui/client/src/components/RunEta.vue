<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { useIntervalFn, useTimestamp } from '@vueuse/core'
import { TooltipArrow, TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui'
import { computed, watch } from 'vue'

import ProgressBar from './ProgressBar.vue'

import { api } from '../api'
import { formatDuration } from '../format'
import { formatFinish } from '../labels'

/**
 * Where a running run stands, for cards outside the run page: when it is expected to end, how long ago it started,
 * and a thin progress bar (done in the theme color, running in blue, the rest gray) whose tooltip has the numbers.
 *
 * Reads `GET /api/runs/:runKey/progress` (cached per run) and reads it again whenever `seq` changes, so it follows the
 * catalog's refresh instead of polling on its own. Until the first response a skeleton of the same size holds the
 * place, so the card does not grow when the estimate arrives.
 */
const props = defineProps<{
  runKey: string
  /** Last event sequence of the run (`RunListItem.lastSeq`); a new value re-reads the progress. */
  seq: number
  /** Start of the run (ISO), for "started … ago". */
  startedAt?: string
}>()

const progress = useQuery({ key: () => ['runs', props.runKey, 'progress'], query: () => api.progress(props.runKey) })
watch(() => props.seq, () => void progress.refetch())
// Every 10 s: "started … ago" and the expected finish show minutes at most.
const now = useTimestamp({ scheduler: callback => useIntervalFn(callback, 10_000) })

const view = computed(() => {
  const value = progress.data.value?.progress
  if (value == null)
    return undefined
  const { cases, etaMs, lowerBound, ratio } = value
  const total = cases.estimatedTotal
  const percent = ratio == null ? undefined : Math.min(100, ratio * 100)
  return {
    cases: `${cases.completed} / ${total ?? '?'} cases`,
    finish: etaMs == null ? undefined : formatFinish(new Date(now.value + etaMs).toISOString(), now.value),
    lowerBound,
    percent,
    running: cases.running,
    runningPercent: total == null || total === 0 ? 0 : (cases.running / total) * 100,
  }
})
const startedAgo = computed(() => (props.startedAt == null ? undefined : formatDuration(Math.max(0, now.value - Date.parse(props.startedAt)))))
</script>

<template>
  <div :class="['flex flex-col gap-1.5 min-w-0']" data-testid="run-eta">
    <template v-if="view">
      <!-- Two facts, no separator: on a narrow card the second wraps below the first instead of starting with a dot. -->
      <span :class="['flex items-baseline justify-between flex-wrap gap-x-3 text-xs muted']">
        <span :class="['whitespace-nowrap']">
          <template v-if="view.finish">
            Ends {{ view.lowerBound ? 'after' : 'at' }} <b :class="['font-semibold tabular-nums text-neutral-800 dark:text-neutral-200']">{{ view.finish }}</b>
          </template>
          <template v-else>No estimate yet</template>
        </span>
        <span v-if="startedAgo" :class="['whitespace-nowrap']">started {{ startedAgo }} ago</span>
      </span>
      <TooltipRoot :delay-duration="150">
        <TooltipTrigger as-child>
          <div :class="['py-1.5 -my-1.5 outline-none']" tabindex="0">
            <ProgressBar
              size="sm"
              label="Run progress"
              :value="view.percent ?? 0"
              :segments="[
                { class: 'bg-primary-500 dark:bg-primary-400', percent: view.percent ?? 0 },
                { class: '[background-color:color-mix(in_oklab,var(--mark-running)_70%,transparent)]', percent: view.runningPercent },
              ]"
            />
          </div>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent :side-offset="4" :class="['tooltip', 'tabular-nums']" data-testid="run-eta-tooltip">
            {{ view.percent == null ? 'Progress unknown' : `${view.percent.toFixed(1)}% done` }} · {{ view.cases }} · {{ view.running }} running
            <TooltipArrow :class="['tooltip-arrow']" />
          </TooltipContent>
        </TooltipPortal>
      </TooltipRoot>
    </template>
    <template v-else>
      <span :class="['skeleton h-4 w-56 max-w-full']" />
      <span :class="['skeleton h-1.5 w-full rounded-full']" />
    </template>
  </div>
</template>
