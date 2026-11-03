<script setup lang="ts">
import type { CompareAxis, Interval, PairedDelta } from '../comparison'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

/** One compared column on the previewed axis. */
export interface AxisPreviewRow {
  /** Paired difference from the baseline; absent for the baseline itself. */
  delta?: PairedDelta
  id: string
  isBaseline: boolean
  label: string
  value: Interval
}

/**
 * What picking an axis would show, before it is picked: every column's mean on the axis with its 95% interval on one
 * shared scale (the baseline hollow), its difference from the baseline in the score hue or its opposite hue when it is beyond
 * noise, and how many columns the axis tells apart from the baseline.
 *
 * Use as the preview of a comparison's axis picker, beside the menu (desktop) or in a drawer (phones).
 */
const props = defineProps<{
  axis: CompareAxis
  description?: string
  formatDelta: (value: number) => string
  formatValue: (value: number) => string
  rows: readonly AxisPreviewRow[]
}>()

const { t } = useI18n()

const extent = computed(() => {
  const low = Math.min(...props.rows.map(row => row.value.low))
  const high = Math.max(...props.rows.map(row => row.value.high))
  return high > low ? { high, low } : { high: high + 0.5, low: low - 0.5 }
})
/** The baseline's mean: a dashed line through every row, so each column reads against it at a glance. */
const baselineMean = computed(() => props.rows.find(row => row.isBaseline)?.value.mean)
const position = (value: number) => `${((value - extent.value.low) / (extent.value.high - extent.value.low)) * 100}%`

function verdictOf(delta: PairedDelta | undefined): 'better' | 'noise' | 'worse' | undefined {
  if (delta == null)
    return undefined
  const { high, low } = delta.interval
  if (low <= 0 && high >= 0)
    return 'noise'
  return (props.axis.better === 'lower' ? high < 0 : low > 0) ? 'better' : 'worse'
}
const COLORS = { better: 'var(--series-1)', noise: 'var(--chart-text)', worse: 'var(--series-1-opposite)' } as const
const clear = computed(() => props.rows.filter(row => verdictOf(row.delta) === 'better' || verdictOf(row.delta) === 'worse').length)
const others = computed(() => props.rows.filter(row => row.delta != null).length)
/** Best first by the axis's direction, so the preview reads like the ranking the axis would give. */
const sorted = computed(() => props.rows.toSorted((left, right) => (props.axis.better === 'lower' ? 1 : -1) * (left.value.mean - right.value.mean)))
</script>

<template>
  <div :class="['grid gap-2 w-80 max-w-full text-xs']" data-testid="compare-axis-preview">
    <div>
      <div :class="['flex items-baseline gap-2']">
        <span :class="['font-semibold text-sm']">{{ props.axis.label }}</span>
        <span v-if="props.axis.better" :class="['muted']">{{ t(`compare.chart.direction.${props.axis.better}`) }}</span>
      </div>
      <p v-if="props.description" :class="['m-0 mt-0.5 muted leading-relaxed']">
        {{ props.description }}
      </p>
    </div>
    <ul :class="['grid gap-1']">
      <li v-for="row in sorted" :key="row.id" :class="['grid grid-cols-[6rem_1fr_auto] items-center gap-2 -mx-1 px-1 rounded', row.isBaseline && 'bg-neutral-500/12 py-0.5']">
        <span :class="['truncate', row.isBaseline && 'font-medium']" :title="row.label">{{ row.label }}</span>
        <!-- The mean on the shared scale, its 95% interval as a bar. -->
        <span :class="['relative h-3']" aria-hidden="true">
          <span :class="['absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-neutral-500/20']" />
          <span v-if="baselineMean != null" :class="['absolute -inset-y-1 w-0 border-l border-dashed border-neutral-400/80 dark:border-neutral-500/80']" :style="{ left: position(baselineMean) }" />
          <span
            :class="['absolute top-1/2 h-1 -translate-y-1/2 rounded-full']"
            :style="{ left: position(row.value.low), right: `calc(100% - ${position(row.value.high)})`, background: row.isBaseline ? 'var(--chart-text)' : COLORS[verdictOf(row.delta) ?? 'noise'], opacity: 0.35 }"
          />
          <span
            :class="['absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full', row.isBaseline && 'size-2.5! border-2 border-neutral-400 bg-[var(--chart-surface)]']"
            :style="row.isBaseline ? { left: position(row.value.mean) } : { left: position(row.value.mean), background: verdictOf(row.delta) === 'noise' ? 'var(--chart-text)' : COLORS[verdictOf(row.delta) ?? 'noise'] }"
          />
        </span>
        <span :class="['tabular-nums whitespace-nowrap text-right']">
          {{ props.formatValue(row.value.mean) }}
          <span v-if="row.delta" :class="['inline-block w-16', verdictOf(row.delta) === 'noise' && 'muted']" :style="{ color: verdictOf(row.delta) === 'noise' ? undefined : COLORS[verdictOf(row.delta)!] }">{{ props.formatDelta(row.delta.interval.mean) }}</span>
          <span v-else :class="['inline-block w-16 muted']">{{ t('compare.chart.baselineTag') }}</span>
        </span>
      </li>
    </ul>
    <p v-if="others > 0" :class="['m-0 muted']">
      {{ t('compare.chart.clearHint', { n: clear, total: others }) }}
    </p>
  </div>
</template>
