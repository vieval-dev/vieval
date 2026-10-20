<script setup lang="ts">
import type { RunSnapshot } from '../../../src/shared/contract'
import type { LiveConnection } from '../composables/useRunLive'

import { useIntervalFn, useTimestamp } from '@vueuse/core'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

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
const { t } = useI18n()

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
  'cases': t('runs.progress.basis.cases'),
  'cases+task-extrapolation': t('runs.progress.basis.taskExtrapolation'),
  'ended': t('runs.progress.basis.ended'),
  'unknown': t('runs.progress.basis.unknown'),
})[progress.value.basis])
const connectionText = computed(() => ({
  closed: t('runs.progress.connection.closed'),
  connecting: t('runs.progress.connection.connecting'),
  ended: props.snapshot.state === 'running' ? t('runs.progress.connection.streamClosed') : t('runs.progress.connection.finished'),
  error: t('runs.progress.connection.error'),
  open: t('runs.progress.connection.open'),
})[props.connection])
/** How the ETA is computed: its basis (a lower bound once auto attempts were seen), then the rule. */
const etaNote = computed(() => {
  const basis = t(live.value && progress.value.lowerBound ? 'runs.progress.etaLowerBound' : 'runs.progress.eta', { basis: basisText.value })
  return `${basis} ${t('runs.progress.etaRule')}`
})
</script>

<template>
  <section :class="['card p-3 flex flex-col gap-3']" data-testid="progress-panel">
    <div :class="['flex items-center gap-3 flex-wrap text-sm']">
      <StateBadge :state="props.snapshot.state" />
      <span :class="['badge', props.connection === 'open' ? 'state-running' : props.connection === 'error' ? 'state-failed' : 'state-neutral']" :title="props.connection === 'open' ? t('runs.progress.updated', { time: formatTime(new Date(props.receivedAt).toISOString()) }) : undefined" data-testid="live-indicator">
        <span :class="[props.connection === 'open' ? 'i-mingcute-airdrop-line vv-pulse' : 'i-mingcute-signal-line']" aria-hidden="true" />{{ connectionText }}
      </span>
      <!-- Only while the run should be moving but no live stream proves it: then the last event tells whether it stalled. -->
      <span v-if="props.snapshot.current.lastEvent && props.connection !== 'open' && (props.snapshot.state === 'running' || props.snapshot.state === 'stale')" class="text-xs muted ml-auto">
        <i18n-t keypath="runs.progress.lastEvent" scope="global">
          <template #event><b>{{ props.snapshot.current.lastEvent.event }}</b></template>
          <template #time>{{ formatTime(props.snapshot.current.lastEvent.time) }}</template>
        </i18n-t>
      </span>
    </div>

    <ProgressBar
      :label="t('runs.progress.barLabel')"
      :active="live"
      :value="percent ?? 0"
      :segments="[
        { class: 'bg-primary-500 dark:bg-primary-400', percent: percent ?? 0, title: t('runs.progress.casesDone', { n: progress.cases.completed }, progress.cases.completed) },
        ...(live ? [{ class: '[background-color:color-mix(in_oklab,var(--mark-running)_50%,transparent)]', percent: runningPercent, title: t('runs.progress.casesRunning', { n: progress.cases.running }, progress.cases.running) }] : []),
      ]"
    />
    <!-- Phones show the numbers (progress, ETA, expected finish) right under the bar and the chart after them. -->
    <ProgressChart v-if="progress.history.length > 0" :class="['max-md:order-1']" :elapsed-ms="elapsed" :finish-at="finishAt" :live="live" :progress="progress" />

    <dl :class="['grid gap-x-6 gap-y-2 text-sm']" style="grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))">
      <div>
        <dt class="text-xs muted">
          {{ t('runs.progress.fields.progress') }}
        </dt>
        <dd :class="['text-xl font-semibold tabular-nums']" data-testid="progress-percent">
          {{ percent == null ? '—' : `${percent.toFixed(1)}%` }}
        </dd>
      </div>
      <div>
        <dt class="text-xs muted">
          {{ t('runs.progress.fields.casesDone') }}
        </dt>
        <dd :class="['text-xl font-semibold tabular-nums']" data-testid="progress-cases">
          {{ progress.cases.completed }} / {{ progress.cases.estimatedTotal ?? '?' }}
        </dd>
      </div>
      <div>
        <dt class="text-xs muted">
          {{ t('runs.progress.fields.runningNow') }}
        </dt>
        <dd :class="['text-xl font-semibold tabular-nums']">
          {{ progress.cases.running }}
        </dd>
      </div>
      <div v-if="progress.cases.waiting > 0">
        <dt class="text-xs muted">
          {{ t('runs.progress.fields.waitingToRerun') }}
        </dt>
        <dd :class="['text-xl font-semibold tabular-nums', '[color:var(--ink-errored)]']" data-testid="progress-waiting">
          {{ progress.cases.waiting }}
        </dd>
      </div>
      <div>
        <dt class="text-xs muted">
          {{ t('runs.progress.fields.tasksDone') }}
        </dt>
        <dd :class="['text-xl font-semibold tabular-nums']">
          {{ progress.tasks.completed }} / {{ progress.tasks.total }}
        </dd>
      </div>
      <div>
        <dt class="text-xs muted">
          {{ t('runs.progress.fields.elapsed') }}
        </dt>
        <dd :class="['text-xl font-semibold tabular-nums']" data-testid="progress-elapsed">
          {{ formatDuration(elapsed) }}
        </dd>
      </div>
      <div>
        <dt class="text-xs muted">
          {{ live ? t('runs.progress.fields.estimatedRemaining') : t('runs.progress.fields.totalDuration') }}
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
          {{ t('runs.progress.fields.expectedFinish') }}
        </dt>
        <dd :class="['text-xl font-semibold tabular-nums']">
          {{ formatFinish(finishAt) }}
        </dd>
      </div>
    </dl>
    <p :class="['text-xs muted max-md:order-1']">
      {{ etaNote }}
    </p>

    <div v-if="props.snapshot.current.running.length > 0 || props.snapshot.current.waiting.length > 0" :class="['max-md:order-1']" data-testid="current-position">
      <div :class="['text-xs font-semibold mb-1 flex items-center gap-1']">
        <span :class="['i-mingcute-aiming-2-line', '[color:var(--mark-running)]']" aria-hidden="true" />{{ t('runs.progress.currentPosition') }} · {{ t('runs.progress.running', { n: props.snapshot.current.running.length }) }}<template v-if="props.snapshot.current.waiting.length > 0">
          · {{ t('runs.progress.waiting', { n: props.snapshot.current.waiting.length }) }}
        </template>
      </div>
      <ul :class="['grid gap-1']" style="grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr))">
        <li v-for="item in props.snapshot.current.running" :key="`${item.taskId}/${item.caseId}`" :class="['flex items-center gap-2 rounded-md px-2 py-1 text-xs', '[background-color:color-mix(in_oklab,var(--mark-running)_10%,transparent)]']">
          <span :class="['i-mingcute-loading-line shrink-0 animate-spin', '[color:var(--mark-running)]']" aria-hidden="true" />
          <a :href="href({ caseId: item.caseId, name: 'case', runKey: props.snapshot.runKey, taskId: item.taskId })" :class="['link mono text-xs truncate']" :title="item.name">{{ item.name }}</a>
          <span v-if="item.roundIndex > 0" class="badge state-neutral">{{ t('runs.position.round', { n: item.roundIndex }) }}</span>
          <span v-if="item.retryIndex > 0" class="badge state-interrupted">{{ t('runs.position.retry', { n: item.retryIndex }) }}</span>
          <span :class="['ml-auto mono text-xs muted whitespace-nowrap']">{{ formatDuration(item.elapsedMs + drift) }}</span>
        </li>
        <!-- Cases waiting to rerun follow the running ones, in the order they were requeued. -->
        <li v-for="item in props.snapshot.current.waiting" :key="`${item.taskId}/${item.caseId}`" :class="['flex items-center gap-2 rounded-md px-2 py-1 text-xs', '[background-color:color-mix(in_oklab,var(--mark-errored)_10%,transparent)]']" data-testid="current-waiting">
          <span :class="['i-mingcute-time-fill shrink-0', '[color:var(--mark-errored)]']" aria-hidden="true" />
          <a :href="href({ caseId: item.caseId, name: 'case', runKey: props.snapshot.runKey, taskId: item.taskId })" :class="['link mono text-xs truncate']" :title="item.name">{{ item.name }}</a>
          <span class="badge state-interrupted">{{ t('runs.position.requeue', { index: item.requeueIndex, total: item.requeue }) }}</span>
          <span :class="['ml-auto mono text-xs whitespace-nowrap', '[color:var(--ink-errored)]']">{{ Date.parse(item.requeuedAt) + item.delayMs > now ? t('runs.position.rerunIn', { duration: formatDuration(Date.parse(item.requeuedAt) + item.delayMs - now) }) : t('runs.position.waitingForSlot') }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>
