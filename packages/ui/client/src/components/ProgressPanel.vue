<script setup lang="ts">
import type { RunSnapshot } from '../../../src/shared/contract'
import type { LiveConnection } from '../composables/useRunLive'

import { useIntervalFn, useTimestamp } from '@vueuse/core'
import { computed } from 'vue'

import ProgressBar from './ProgressBar.vue'
import ProgressChart from './ProgressChart.vue'
import StateBadge from './StateBadge.vue'

import { formatDuration, formatTime } from '../format'
import { formatFinish } from '../labels'
import { href } from '../router'

/**
 * Progress, elapsed time, ETA, and the current position of a run.
 *
 * Between server updates the elapsed time and the ETA move with the local clock, so a live run never looks frozen;
 * each server `progress` event (or snapshot) resets them to the server's numbers.
 */
const props = defineProps<{ connection: LiveConnection, receivedAt: number, snapshot: RunSnapshot }>()

// Once per second: elapsed and ETA show whole seconds (the default scheduler would update every frame).
const now = useTimestamp({ scheduler: callback => useIntervalFn(callback, 1000) })
const live = computed(() => props.snapshot.state === 'running')
const drift = computed(() => (live.value ? Math.max(0, now.value - props.receivedAt) : 0))
const progress = computed(() => props.snapshot.progress)
const elapsed = computed(() => progress.value.elapsedMs + drift.value)
const eta = computed(() => (progress.value.etaMs == null ? undefined : Math.max(0, progress.value.etaMs - drift.value)))
const finishAt = computed(() => (eta.value == null ? undefined : new Date(now.value + eta.value).toISOString()))
const percent = computed(() => (progress.value.ratio == null ? undefined : Math.min(100, progress.value.ratio * 100)))
const runningPercent = computed(() => {
  const total = progress.value.cases.estimatedTotal
  return total == null || total === 0 ? 0 : (progress.value.cases.running / total) * 100
})
const basisText = computed(() => ({
  'cases': 'case totals of every task are known',
  'cases+task-extrapolation': 'totals of tasks that did not start yet are extrapolated',
  'ended': 'run ended',
  'unknown': 'no case finished yet: no estimate',
})[progress.value.basis])
const connectionText = computed(() => ({
  closed: 'not connected',
  connecting: 'connecting…',
  ended: props.snapshot.state === 'running' ? 'stream closed' : 'finished — no live updates',
  error: 'disconnected (retrying)',
  open: 'live',
})[props.connection])
</script>

<template>
  <section :class="['card p-3 flex flex-col gap-3']" data-testid="progress-panel">
    <div :class="['flex items-center gap-3 flex-wrap text-sm']">
      <StateBadge :state="props.snapshot.state" />
      <span :class="['badge', props.connection === 'open' ? 'state-running' : props.connection === 'error' ? 'state-failed' : 'state-neutral']" :title="props.connection === 'open' ? `updated ${formatTime(new Date(props.receivedAt).toISOString())}` : undefined" data-testid="live-indicator">
        <span :class="[props.connection === 'open' ? 'i-mingcute-airdrop-line vv-pulse' : 'i-mingcute-signal-line']" aria-hidden="true" />{{ connectionText }}
      </span>
      <!-- Only while the run should be moving but no live stream proves it: then the last event tells whether it stalled. -->
      <span v-if="props.snapshot.current.lastEvent && props.connection !== 'open' && (props.snapshot.state === 'running' || props.snapshot.state === 'stale')" class="text-xs muted ml-auto">last event <b>{{ props.snapshot.current.lastEvent.event }}</b> at {{ formatTime(props.snapshot.current.lastEvent.time) }}</span>
    </div>

    <ProgressBar
      label="Run progress"
      :active="live"
      :value="percent ?? 0"
      :segments="[
        { class: 'bg-primary-500 dark:bg-primary-400', percent: percent ?? 0, title: `${progress.cases.completed} cases done` },
        ...(live ? [{ class: 'bg-blue-300 dark:bg-blue-400/50', percent: runningPercent, title: `${progress.cases.running} cases running` }] : []),
      ]"
    />
    <!-- Phones show the numbers (progress, ETA, expected finish) right under the bar and the chart after them. -->
    <ProgressChart v-if="progress.history.length > 0" :class="['max-md:order-1']" :elapsed-ms="elapsed" :finish-at="finishAt" :live="live" :progress="progress" />

    <dl :class="['grid gap-x-6 gap-y-2 text-sm']" style="grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))">
      <div>
        <dt class="text-xs muted">
          Progress
        </dt>
        <dd :class="['text-xl font-semibold tabular-nums']" data-testid="progress-percent">
          {{ percent == null ? '—' : `${percent.toFixed(1)}%` }}
        </dd>
      </div>
      <div>
        <dt class="text-xs muted">
          Cases done / estimated
        </dt>
        <dd :class="['text-xl font-semibold tabular-nums']" data-testid="progress-cases">
          {{ progress.cases.completed }} / {{ progress.cases.estimatedTotal ?? '?' }}
        </dd>
      </div>
      <div>
        <dt class="text-xs muted">
          Running now
        </dt>
        <dd :class="['text-xl font-semibold tabular-nums']">
          {{ progress.cases.running }}
        </dd>
      </div>
      <div>
        <dt class="text-xs muted">
          Tasks done
        </dt>
        <dd :class="['text-xl font-semibold tabular-nums']">
          {{ progress.tasks.completed }} / {{ progress.tasks.total }}
        </dd>
      </div>
      <div>
        <dt class="text-xs muted">
          Elapsed
        </dt>
        <dd :class="['text-xl font-semibold tabular-nums']" data-testid="progress-elapsed">
          {{ formatDuration(elapsed) }}
        </dd>
      </div>
      <div>
        <dt class="text-xs muted">
          {{ live ? 'Estimated remaining' : 'Total duration' }}
        </dt>
        <dd :class="['text-xl font-semibold tabular-nums']" data-testid="progress-eta">
          <template v-if="live">
            {{ eta == null ? '—' : `${progress.lowerBound ? '≥ ' : ''}${formatDuration(eta)}` }}
          </template>
          <template v-else>
            {{ formatDuration(progress.elapsedMs) }}
          </template>
        </dd>
      </div>
      <div v-if="live && finishAt">
        <dt class="text-xs muted">
          Expected finish
        </dt>
        <dd :class="['text-xl font-semibold tabular-nums']">
          {{ formatFinish(finishAt) }}
        </dd>
      </div>
    </dl>
    <p :class="['text-xs muted max-md:order-1']">
      {{ `ETA basis: ${basisText}${live && progress.lowerBound ? '; auto attempts were seen, so more rounds may follow (lower bound)' : ''}. Rule: elapsed ÷ settled cases × estimated cases − elapsed, and at least as long as the longest running case has run.` }}
    </p>

    <div v-if="props.snapshot.current.running.length > 0" :class="['max-md:order-1']" data-testid="current-position">
      <div :class="['text-xs font-semibold mb-1 flex items-center gap-1']">
        <span class="i-mingcute-aiming-2-line text-blue-600" aria-hidden="true" />Current position · {{ props.snapshot.current.running.length }} running
      </div>
      <ul :class="['grid gap-1']" style="grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr))">
        <li v-for="item in props.snapshot.current.running" :key="`${item.taskId}/${item.caseId}`" :class="['flex items-center gap-2 rounded-md bg-blue-50 dark:bg-blue-950/40 px-2 py-1 text-xs']">
          <span class="i-mingcute-loading-line text-blue-600 shrink-0 animate-spin" aria-hidden="true" />
          <a :href="href({ caseId: item.caseId, name: 'case', runKey: props.snapshot.runKey, taskId: item.taskId })" :class="['link mono text-xs truncate']" :title="item.name">{{ item.name }}</a>
          <span v-if="item.roundIndex > 0" class="badge state-neutral">round {{ item.roundIndex }}</span>
          <span v-if="item.retryIndex > 0" class="badge state-interrupted">retry {{ item.retryIndex }}</span>
          <span :class="['ml-auto mono text-xs muted whitespace-nowrap']">{{ formatDuration(item.elapsedMs + drift) }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>
