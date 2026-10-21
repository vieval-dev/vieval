<script setup lang="ts">
import type { RunProgress } from '../../../src/shared/contract'

import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { useElementWidth } from '../composables/useElementWidth'
import { formatDuration } from '../format'
import { formatFinish } from '../labels'

/**
 * Completed cases over time: the solid line is what happened (`progress.history`), the dashed line where the run is
 * heading at its current ETA (to `estimatedTotalMs` / `cases.estimatedTotal`), so position, speed, and the expected
 * finish read at a glance.
 *
 * The projection is drawn only while the run is live and has an ETA; when auto attempts were seen the ETA is a lower
 * bound and the projection is drawn fainter.
 */
const props = defineProps<{
  /** Elapsed time now (server value plus local drift), in ms since `run.started`. */
  elapsedMs: number
  /** Expected finish as an ISO time (now + ETA), for the label at the end of the projection. */
  finishAt?: string
  live: boolean
  progress: RunProgress
}>()

const { t } = useI18n()
const root = useTemplateRef<HTMLElement>('root')
const width = useElementWidth(root, 640)
const height = 140
const pad = { bottom: 20, left: 40, right: 64, top: 12 }

/** Window of the "recent rate": the last 15 minutes, or the last tenth of the run when that is longer. */
const RATE_WINDOW_MS = 15 * 60_000

const last = computed(() => props.progress.history.at(-1) ?? { completed: props.progress.cases.completed, elapsedMs: 0 })
const projection = computed(() => {
  const { estimatedTotalMs, etaMs } = props.progress
  const total = props.progress.cases.estimatedTotal
  if (!props.live || etaMs == null || estimatedTotalMs == null || total == null)
    return undefined
  return { completed: total, elapsedMs: Math.max(estimatedTotalMs, props.elapsedMs) }
})
/**
 * The projection is cut at twice the elapsed time: with a long ETA (6 of 345 cases after 18 h, 1029 h to go) a time
 * axis up to the finish squeezed the actual progress into the first pixels. The cut projection ends at the right edge,
 * which names the expected finish instead.
 */
const PROJECTION_SPAN_FACTOR = 2
const projectionCut = computed(() => {
  if (projection.value == null)
    return false
  return projection.value.elapsedMs > Math.max(props.elapsedMs, last.value.elapsedMs) * PROJECTION_SPAN_FACTOR
})
const bounds = computed(() => {
  const projectedX = projectionCut.value
    ? Math.max(props.elapsedMs, last.value.elapsedMs) * PROJECTION_SPAN_FACTOR
    : projection.value?.elapsedMs ?? 0
  const maxX = Math.max(1, props.elapsedMs, last.value.elapsedMs, projectedX)
  const maxY = Math.max(1, last.value.completed, props.progress.cases.estimatedTotal ?? 0)
  return { maxX, maxY }
})
const sx = (ms: number) => pad.left + (ms / bounds.value.maxX) * (width.value - pad.left - pad.right)
const sy = (count: number) => pad.top + (1 - count / bounds.value.maxY) * (height - pad.top - pad.bottom)

/** Actual progress as steps: the count holds until the next case settles, and holds until now while live. */
const actualPath = computed(() => {
  const points = props.progress.history
  if (points.length === 0)
    return ''
  let path = `M${sx(0).toFixed(1)},${sy(0).toFixed(1)}`
  let previous = 0
  for (const point of points) {
    path += ` L${sx(point.elapsedMs).toFixed(1)},${sy(previous).toFixed(1)} L${sx(point.elapsedMs).toFixed(1)},${sy(point.completed).toFixed(1)}`
    previous = point.completed
  }
  const end = props.live ? Math.max(props.elapsedMs, last.value.elapsedMs) : last.value.elapsedMs
  return `${path} L${sx(end).toFixed(1)},${sy(previous).toFixed(1)}`
})
/** End of the drawn projection: the projected finish, or the point on the projection at the right edge when cut. */
const projectionEnd = computed(() => {
  if (projection.value == null)
    return undefined
  if (!projectionCut.value)
    return projection.value
  const { maxX } = bounds.value
  const from = { completed: last.value.completed, elapsedMs: props.elapsedMs }
  const share = (maxX - from.elapsedMs) / (projection.value.elapsedMs - from.elapsedMs)
  return { completed: from.completed + (projection.value.completed - from.completed) * share, elapsedMs: maxX }
})
const projectionPath = computed(() => {
  if (projectionEnd.value == null)
    return ''
  return `M${sx(props.elapsedMs).toFixed(1)},${sy(last.value.completed).toFixed(1)} L${sx(projectionEnd.value.elapsedMs).toFixed(1)},${sy(projectionEnd.value.completed).toFixed(1)}`
})

const finishLabel = computed(() => (props.finishAt == null ? '' : formatFinish(props.finishAt)))

/** Cases per hour over the recent window; the whole run while the window has fewer than two settled cases. */
const rate = computed(() => {
  const points = props.progress.history
  if (points.length === 0 || props.elapsedMs <= 0)
    return undefined
  const window = Math.max(RATE_WINDOW_MS, props.elapsedMs / 10)
  const from = props.elapsedMs - window
  const before = points.findLast(point => point.elapsedMs <= from)
  const recent = points.filter(point => point.elapsedMs > from)
  if (before == null || recent.length < 2)
    return { overall: true, perHour: (last.value.completed / props.elapsedMs) * 3_600_000 }
  return { overall: false, perHour: ((last.value.completed - before.completed) / window) * 3_600_000, window }
})
</script>

<template>
  <figure ref="root" :class="['relative w-full']" data-testid="progress-chart">
    <!-- A fixed pixel height: with `h-auto` the height followed the width, so every width update resized the figure
         again and the ResizeObserver reported a loop. The viewBox width equals the element width (useElementWidth). -->
    <svg :viewBox="`0 0 ${width} ${height}`" :style="{ height: `${height}px` }" :class="['w-full overflow-visible']" role="img" :aria-label="t('runs.chart.label', { completed: last.completed, total: props.progress.cases.estimatedTotal ?? t('runs.chart.unknown') })">
      <!-- Axes: zero line, estimated total, and the time span. -->
      <line :x1="pad.left" :x2="width - pad.right" :y1="sy(0)" :y2="sy(0)" stroke="var(--chart-grid)" />
      <text :x="pad.left - 6" :y="sy(0) + 3" font-size="10" text-anchor="end" fill="var(--chart-text)">0</text>
      <template v-if="props.progress.cases.estimatedTotal != null">
        <line :x1="pad.left" :x2="width - pad.right" :y1="sy(props.progress.cases.estimatedTotal)" :y2="sy(props.progress.cases.estimatedTotal)" stroke="var(--chart-text)" stroke-opacity="0.35" stroke-dasharray="2 4" data-testid="progress-total-guide" />
        <text :x="pad.left - 6" :y="sy(props.progress.cases.estimatedTotal) + 3" font-size="10" text-anchor="end" fill="var(--chart-text)">{{ props.progress.cases.estimatedTotal }}</text>
      </template>
      <text :x="pad.left" :y="height - 4" font-size="10" fill="var(--chart-text)">0s</text>
      <text :x="width - pad.right" :y="height - 4" font-size="10" text-anchor="end" fill="var(--chart-text)">{{ formatDuration(bounds.maxX) }}</text>

      <path v-if="projectionPath" :d="projectionPath" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-dasharray="6 5" :stroke-opacity="props.progress.lowerBound ? 0.4 : 0.8" data-testid="progress-projection" />
      <path v-if="actualPath" :d="actualPath" fill="none" stroke="var(--series-1)" stroke-width="2.5" stroke-linejoin="round" data-testid="progress-actual" />

      <!-- Now: where the run is. -->
      <g v-if="props.live">
        <line :x1="sx(props.elapsedMs)" :x2="sx(props.elapsedMs)" :y1="pad.top" :y2="sy(0)" stroke="var(--chart-text)" stroke-opacity="0.5" stroke-dasharray="2 2" />
        <circle :cx="sx(props.elapsedMs)" :cy="sy(last.completed)" r="4" fill="var(--series-1)" stroke="var(--chart-surface, white)" stroke-width="2" data-testid="progress-now" />
        <text :x="sx(props.elapsedMs)" :y="pad.top - 2" font-size="10" text-anchor="middle" fill="var(--chart-text)">{{ t('runs.chart.now') }}</text>
      </g>
      <!-- Expected finish at the end of the projection. -->
      <g v-if="projection && projectionEnd && props.finishAt && !projectionCut">
        <circle :cx="sx(projectionEnd.elapsedMs)" :cy="sy(projectionEnd.completed)" r="3" fill="none" stroke="var(--series-1)" stroke-width="1.5" />
        <text :x="sx(projectionEnd.elapsedMs) + 6" :y="sy(projectionEnd.completed) + 4" font-size="10" fill="var(--chart-text)">{{ props.progress.lowerBound ? '≥ ' : '' }}{{ finishLabel }}</text>
      </g>
      <!-- Cut projection: the finish lies beyond the right edge. -->
      <text v-if="projectionEnd && props.finishAt && projectionCut" :x="sx(projectionEnd.elapsedMs) + 6" :y="sy(projectionEnd.completed) + 4" font-size="10" fill="var(--chart-text)" data-testid="progress-finish-beyond">→ {{ props.progress.lowerBound ? '≥ ' : '' }}{{ finishLabel }}</text>
    </svg>
    <figcaption :class="['flex flex-wrap gap-x-4 gap-y-1 text-xs muted mt-1']">
      <span :class="['inline-flex items-center gap-1.5']"><span :class="['inline-block w-4 h-0.5 bg-[var(--series-1)]']" aria-hidden="true" />{{ t('runs.chart.legendCompleted') }}</span>
      <span v-if="projectionPath" :class="['inline-flex items-center gap-1.5']"><span :class="['inline-block w-4 border-t-2 border-dashed border-[var(--series-1)]']" aria-hidden="true" />{{ props.progress.lowerBound ? t('runs.chart.legendProjectionLowerBound') : t('runs.chart.legendProjection') }}</span>
      <span v-if="rate" data-testid="progress-rate">
        <i18n-t keypath="runs.chart.rate" scope="global">
          <template #rate><b :class="['tabular-nums text-neutral-700 dark:text-neutral-300']">{{ rate.perHour >= 10 ? Math.round(rate.perHour) : rate.perHour.toFixed(1) }}</b></template>
        </i18n-t>
        {{ rate.overall ? t('runs.chart.rateWholeRun') : t('runs.chart.rateWindow', { window: formatDuration(rate.window) }) }}
      </span>
    </figcaption>
  </figure>
</template>
