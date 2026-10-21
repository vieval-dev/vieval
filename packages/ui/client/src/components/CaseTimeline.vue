<script setup lang="ts">
import type { TimelineResponse } from '../../../src/shared/contract'

import { useIntervalFn, useTimestamp } from '@vueuse/core'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import StateBadge from './StateBadge.vue'

import { extent } from '../extent'
import { formatDuration, formatTime } from '../format'

/**
 * Gantt of every try of a case: one lane per auto-attempt round, one bar per try (immediate retries follow each
 * other in the same lane), on a shared time axis.
 */
const props = defineProps<{ timeline: TimelineResponse }>()
const { t, te } = useI18n()
/** State name in the viewer's language, as `StateBadge` shows it; a state without a translation stays as reported. */
const stateName = (state: string) => (te(`states.${state}`, 'en') ? t(`states.${state}`) : state)
// Once per second: elapsed and ETA show whole seconds (the default scheduler would update every frame).
const now = useTimestamp({ scheduler: callback => useIntervalFn(callback, 1000) })

const lanes = computed(() => {
  const entries = props.timeline.entries
  // A case still waiting to rerun stretches the axis to now, so its wait shows.
  const waitingNow = entries.at(-1)?.state === 'requeued'
  const start = extent(entries.map(entry => Date.parse(entry.startedAt))).min
  const end = Math.max(extent(entries.map(entry => (entry.endedAt == null ? now.value : Date.parse(entry.endedAt)))).max, waitingNow ? now.value : 0)
  const span = Math.max(1, end - start)
  const rounds = [...new Set(entries.map(entry => entry.roundIndex))].sort((a, b) => a - b)
  return {
    end,
    lanes: rounds.map((roundIndex) => {
      const inRound = entries.filter(entry => entry.roundIndex === roundIndex)
      return {
        inferred: inRound.some(entry => entry.roundIndexInferred),
        roundIndex,
        tries: inRound.map((entry, tryIndex) => {
          const from = Date.parse(entry.startedAt)
          const to = entry.endedAt == null ? now.value : Date.parse(entry.endedAt)
          return { ...entry, left: ((from - start) / span) * 100, tryNumber: tryIndex + 1, width: Math.max(0.6, ((to - from) / span) * 100) }
        }),
        // The time a requeued try waited at the end of the queue: from its end to the next try, or to now.
        waits: inRound.flatMap((entry, tryIndex) => {
          if (entry.state !== 'requeued' || entry.endedAt == null) {
            return []
          }
          const from = Date.parse(entry.endedAt)
          const next = inRound[tryIndex + 1]
          const to = next == null ? now.value : Date.parse(next.startedAt)
          return [{ key: `${entry.roundIndex}:${tryIndex}`, left: ((from - start) / span) * 100, ms: to - from, width: Math.max(0.6, ((to - from) / span) * 100) }]
        }),
      }
    }),
    start,
  }
})
/** Table rows: tries numbered within their round across requeues, as on the lanes. */
const tableRows = computed(() => props.timeline.entries.map((entry, position, entries) => ({
  ...entry,
  key: `${entry.roundIndex}:${position}`,
  tryNumber: entries.slice(0, position + 1).filter(other => other.roundIndex === entry.roundIndex).length,
})))
/** Fill of a try or round bar from the state tokens (`styles.css`), so the colorblind-safe mode recolors it; a retried try is a try without a result. */
const stateColor = (state: string) => ['errored', 'failed', 'passed', 'running', 'timeout', 'unfinished'].includes(state) ? `var(--mark-${state})` : state === 'retried' || state === 'requeued' ? 'var(--mark-errored)' : 'var(--mark-skipped)'
</script>

<template>
  <div :class="['flex flex-col gap-2']" data-testid="case-timeline">
    <div :class="['flex justify-between text-xs muted mono pl-22 md:pl-28']">
      <span>{{ formatTime(new Date(lanes.start).toISOString()) }}</span>
      <span>{{ formatDuration(lanes.end - lanes.start) }}</span>
      <span>{{ formatTime(new Date(lanes.end).toISOString()) }}</span>
    </div>
    <div v-for="lane in lanes.lanes" :key="lane.roundIndex" :class="['flex items-center gap-2']">
      <div :class="['w-20 md:w-26 shrink-0 text-xs']">
        <div class="font-medium">
          {{ t('cases.round', { n: lane.roundIndex }) }}
        </div>
        <div class="muted">
          {{ lane.roundIndex === 0 ? t('cases.timeline.firstRun') : t('cases.timeline.autoAttempt', { n: lane.roundIndex }) }}{{ lane.inferred ? ' *' : '' }}
        </div>
      </div>
      <div :class="['relative flex-1 h-7 rounded bg-neutral-100 dark:bg-neutral-800']">
        <!-- Waits behind the bars: a dashed amber outline, "no result yet", from a requeue to the next try. -->
        <div
          v-for="wait in lane.waits" :key="wait.key"
          :class="['absolute top-1 h-5 rounded-sm border border-dashed flex items-center px-1 text-[10px] overflow-hidden whitespace-nowrap', '[border-color:var(--mark-errored)] [color:var(--ink-errored)]']"
          :style="{ left: `${wait.left}%`, width: `${wait.width}%` }"
          :title="t('cases.timeline.waited', { duration: formatDuration(wait.ms) })"
          data-testid="timeline-wait"
        >
          {{ t('cases.timeline.waiting') }}
        </div>
        <div
          v-for="entry in lane.tries" :key="entry.tryNumber"
          :class="['absolute top-1 h-5 rounded-sm flex items-center px-1 text-[10px] text-white overflow-hidden whitespace-nowrap', entry.state === 'running' && 'vv-pulse']"
          :style="{ left: `${entry.left}%`, width: `${entry.width}%`, background: stateColor(entry.state) }"
          :title="`${t('cases.timeline.tryTitle', { duration: formatDuration(entry.durationMs), round: entry.roundIndex, state: stateName(entry.state), try: entry.tryNumber })}${entry.errorMessage ? `\n${entry.errorMessage}` : ''}`"
        >
          {{ t('cases.timeline.tryBar', { n: entry.tryNumber }) }}
        </div>
      </div>
    </div>
    <!-- Six columns do not fit a phone; the table scrolls sideways there instead of squeezing the error text. -->
    <div :class="['overflow-x-auto mt-1']">
      <table :class="['w-full max-md:min-w-[36rem]']">
        <thead>
          <tr :class="['border-b border-neutral-200/50 dark:border-neutral-800/50']">
            <th class="th">
              {{ t('cases.timeline.round') }}
            </th>
            <th class="th">
              {{ t('cases.timeline.try') }}
            </th>
            <th class="th">
              {{ t('cases.timeline.state') }}
            </th>
            <th class="th">
              {{ t('cases.timeline.started') }}
            </th>
            <th class="th">
              {{ t('cases.timeline.duration') }}
            </th>
            <th class="th">
              {{ t('cases.timeline.error') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in tableRows" :key="entry.key" :class="['border-b border-neutral-100/70 dark:border-neutral-900']">
            <td :class="['td mono text-xs']">
              {{ entry.roundIndex }}
            </td>
            <td :class="['td mono text-xs']">
              {{ entry.tryNumber }}<span v-if="entry.retryIndex > 0" class="muted">{{ t('cases.timeline.retry', { n: entry.retryIndex }) }}</span><span v-else-if="entry.requeueIndex > 0" class="muted">{{ t('cases.timeline.requeue', { n: entry.requeueIndex }) }}</span>
            </td>
            <td class="td">
              <StateBadge :state="entry.state" />
            </td>
            <td :class="['td mono text-xs muted']">
              {{ formatTime(entry.startedAt) }}
            </td>
            <td :class="['td mono text-xs']">
              {{ formatDuration(entry.durationMs) }}
            </td>
            <td :class="['td text-xs break-all', entry.state === 'failed' ? '[color:var(--ink-failed)]' : '[color:var(--ink-errored)]']">
              {{ entry.errorMessage }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="lanes.lanes.some(lane => lane.inferred)" class="text-xs muted">
      {{ t('cases.timeline.inferredRound') }}
    </p>
  </div>
</template>
