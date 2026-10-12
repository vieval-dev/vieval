<script setup lang="ts">
import { computed } from 'vue'

import { api } from '../api'
import { useResource } from '../composables/useResource'
import { formatDuration } from '../format'
import { formatFinish } from '../labels'

/**
 * Progress and expected finish of a running run, for summaries outside the run page (project cards).
 *
 * Reads `GET /api/runs/:runKey/progress` and reads it again whenever `seq` changes, so it follows the catalog's
 * refresh instead of polling on its own. Shows nothing until a first estimate exists.
 */
const props = defineProps<{
  runKey: string
  /** Last event sequence of the run (`RunListItem.lastSeq`); a new value re-reads the progress. */
  seq: number
}>()

const progress = useResource(() => [props.runKey, props.seq] as const, ([runKey]) => api.progress(runKey), { keepData: true })
const view = computed(() => {
  const value = progress.data.value?.progress
  if (value == null)
    return undefined
  const { cases, etaMs, lowerBound, ratio } = value
  return {
    cases: `${cases.completed} / ${cases.estimatedTotal ?? '?'}`,
    finish: etaMs == null ? undefined : formatFinish(new Date(Date.now() + etaMs).toISOString()),
    percent: ratio == null ? undefined : `${(Math.min(1, ratio) * 100).toFixed(1)}%`,
    remaining: etaMs == null ? undefined : `${lowerBound ? '≥ ' : ''}${formatDuration(etaMs)}`,
  }
})
</script>

<template>
  <span v-if="view" :class="['flex items-baseline flex-wrap gap-x-3 gap-y-0.5 text-xs muted']" data-testid="run-eta">
    <span v-if="view.percent"><b :class="['text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100']">{{ view.percent }}</b> · {{ view.cases }} cases</span>
    <span v-if="view.finish" :class="['inline-flex items-baseline gap-1']">
      <span :class="['i-mingcute-flag-4-line self-center']" aria-hidden="true" />finish
      <b :class="['text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100']">{{ view.finish }}</b>
      <span :class="['tabular-nums']">({{ view.remaining }} left)</span>
    </span>
  </span>
</template>
