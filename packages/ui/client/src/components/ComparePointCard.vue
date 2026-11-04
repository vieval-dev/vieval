<script setup lang="ts">
import type { CompareAxis, Interval, PairedDelta } from '../comparison'

import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import StateBadge from './StateBadge.vue'

/** One axis of a compared column, as the card reads it. */
export interface PointAxisReading {
  axis: CompareAxis
  /** Paired difference from the baseline; absent for the baseline itself. */
  delta?: PairedDelta
  formatDelta: (value: number) => string
  formatValue: (value: number) => string
  value: Interval
}

/**
 * One compared column of the score plane, sized to be read at a glance: per axis, its mean with the 95% interval of
 * the mean (where its score lies), and its paired difference from the baseline with that interval (where its advantage
 * lies, and whether it clears noise), drawn as a small bar around zero.
 *
 * Use inside the plane's popover (desktop: a hover preview, a click pins it) or drawer (phones). `pinned` adds the
 * actions as small round buttons beside the name, as the case charts' card has them: make the column the baseline,
 * hide it from the charts (an outlier that squeezes the others), open its run, close the card.
 */
const props = defineProps<{
  baselineLabel?: string
  href?: string
  isBaseline: boolean
  label: string
  pinned: boolean
  readings: readonly PointAxisReading[]
  /** The column's newest run is still running: its numbers move as cases settle. */
  running?: boolean
}>()
const emit = defineEmits<{ baseline: [], hide: [], unpin: [] }>()
const { t } = useI18n()

function verdictOf(reading: PointAxisReading): 'better' | 'noise' | 'worse' | undefined {
  if (reading.delta == null)
    return undefined
  const { high, low } = reading.delta.interval
  if (low <= 0 && high >= 0)
    return 'noise'
  return (reading.axis.better === 'lower' ? high < 0 : low > 0) ? 'better' : 'worse'
}
/** Round actions beside the name of a pinned card: make it the baseline (unless it is), open its run, close. */
const actions = computed<{ href?: string, icon: string, key: 'baseline' | 'close' | 'hide' | 'open', label: string }[]>(() => [
  ...(props.isBaseline ? [] : [{ icon: 'i-mingcute-flag-2-line', key: 'baseline' as const, label: t('compare.chart.card.useAsBaseline') }]),
  // The baseline cannot be hidden: every difference is read against it.
  ...(props.isBaseline ? [] : [{ icon: 'i-mingcute-eye-close-line', key: 'hide' as const, label: t('compare.chart.card.hide') }]),
  ...(props.href == null ? [] : [{ href: props.href, icon: 'i-mingcute-arrow-right-up-line', key: 'open' as const, label: t('compare.chart.card.openRun') }]),
  { icon: 'i-mingcute-close-line', key: 'close' as const, label: t('compare.chart.card.close') },
])
const COLORS = { better: 'var(--series-1)', noise: 'var(--chart-text)', worse: 'var(--series-1-opposite)' } as const

/** Where a value sits on the difference bar (0–1): zero in the middle, the far end of the interval at an edge. */
function barPosition(delta: PairedDelta, value: number): number {
  const reach = Math.max(Math.abs(delta.interval.low), Math.abs(delta.interval.high), 1e-9) * 1.1
  return 0.5 + value / reach / 2
}
</script>

<template>
  <div :class="['grid gap-2.5 text-xs']" data-testid="compare-point-card">
    <div :class="['flex items-center gap-1 min-w-0']">
      <StateBadge v-if="props.running" state="running" icon-only />
      <span :class="['font-semibold text-sm truncate']">{{ props.label }}</span>
      <span v-if="props.isBaseline" :class="['muted shrink-0']">· {{ t('compare.chart.baselineTag') }}</span>
      <template v-if="props.pinned">
        <span :class="['flex-1']" />
        <TooltipRoot v-for="action in actions" :key="action.key">
          <TooltipTrigger as-child>
            <a v-if="action.href" :href="action.href" :class="['card-action']" :aria-label="action.label">
              <span :class="[action.icon]" aria-hidden="true" />
            </a>
            <button v-else type="button" :class="['card-action']" :aria-label="action.label" :data-testid="action.key === 'baseline' ? 'compare-point-baseline' : undefined" @click="action.key === 'baseline' ? emit('baseline') : action.key === 'hide' ? emit('hide') : emit('unpin')">
              <span :class="[action.icon]" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent :side-offset="4" :class="['tooltip']">
              {{ action.label }}<kbd v-if="action.key === 'close'" :class="['mono opacity-70 ml-1']">Esc</kbd>
            </TooltipContent>
          </TooltipPortal>
        </TooltipRoot>
      </template>
    </div>

    <div v-for="reading in props.readings" :key="reading.axis.name" :class="['grid gap-1']">
      <div :class="['flex items-baseline gap-2']">
        <span :class="['muted truncate']">{{ reading.axis.label }}</span>
        <span :class="['ml-auto font-semibold tabular-nums']">{{ reading.formatValue(reading.value.mean) }}</span>
        <span :class="['muted tabular-nums whitespace-nowrap']">[{{ reading.formatValue(reading.value.low) }}, {{ reading.formatValue(reading.value.high) }}]</span>
      </div>
      <template v-if="reading.delta">
        <div :class="['flex items-center gap-2']">
          <span :class="['muted whitespace-nowrap']">{{ t('compare.chart.card.versus', { baseline: props.baselineLabel }) }}</span>
          <!-- The paired difference: its interval as a bar around the zero line, its mean as a dot. -->
          <span :class="['relative h-3 flex-1 min-w-16']" aria-hidden="true">
            <span :class="['absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-neutral-500/25']" />
            <span :class="['absolute top-0 bottom-0 w-px left-1/2 bg-neutral-500/60']" />
            <span
              :class="['absolute top-1/2 h-1 -translate-y-1/2 rounded-full']"
              :style="{
                left: `${barPosition(reading.delta, reading.delta.interval.low) * 100}%`,
                width: `${(barPosition(reading.delta, reading.delta.interval.high) - barPosition(reading.delta, reading.delta.interval.low)) * 100}%`,
                background: COLORS[verdictOf(reading)!],
                opacity: verdictOf(reading) === 'noise' ? 0.5 : 0.85,
              }"
            />
            <span :class="['absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full']" :style="{ left: `${barPosition(reading.delta, reading.delta.interval.mean) * 100}%`, background: COLORS[verdictOf(reading)!] }" />
          </span>
          <span :class="['font-semibold tabular-nums whitespace-nowrap']" :style="{ color: verdictOf(reading) === 'noise' ? undefined : COLORS[verdictOf(reading)!] }">{{ reading.formatDelta(reading.delta.interval.mean) }}</span>
        </div>
        <div :class="['flex gap-2 muted tabular-nums whitespace-nowrap']">
          <span>[{{ reading.formatDelta(reading.delta.interval.low) }}, {{ reading.formatDelta(reading.delta.interval.high) }}]</span>
          <span :class="['ml-auto']">{{ t('compare.chart.winsLossesShort', { losses: reading.delta.losses, ties: reading.delta.ties, wins: reading.delta.wins }) }}</span>
        </div>
      </template>
    </div>
  </div>
</template>
