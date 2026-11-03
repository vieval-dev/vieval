<script setup lang="ts">
import type { ScoreDefinition } from '../../../src/shared/contract'
import type { CellComparison, GridCell } from '../matrixGrid'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import CompletionRing from './CompletionRing.vue'
import MatrixCellCard from './MatrixCellCard.vue'

import { formatCount, formatScore } from '../format'
import { isSettled } from '../matrixGrid'
import { headlineOf, headlineValue, scoreLabel } from '../scores'

/**
 * What the compact matrix opens on hover: the cell's full card ({@link MatrixCellCard}) with what a filled number
 * cannot say around it — which configuration the cell is, how far the score can be trusted, its difference from the
 * baseline cell, every score of the run (not only the headline), and each repeat of an averaged cell.
 */
const props = defineProps<{
  averagedNames: readonly string[]
  /** Text of the reader's baseline (`method = text · view = online`), when one is picked. */
  baselineLabel?: string
  cell: GridCell
  comparison?: CellComparison
  /** The cell's values on the laid-out axes, outer first. */
  coordinates: readonly { name: string, value: string }[]
  definitions: readonly ScoreDefinition[]
}>()
const { t } = useI18n()

/** About 95 % of the headline's plausible values: ±1.96 standard errors, inside 0–1. */
const interval = computed(() => {
  const { se, value } = props.cell
  if (value == null || se == null)
    return undefined
  return { high: Math.min(1, value + 1.96 * se), low: Math.max(0, value - 1.96 * se) }
})
const headlineCount = computed(() => {
  const headline = headlineOf(props.cell.scoring).headline
  return headline.kind === 'per-task' ? undefined : headline.score.n
})
const scores = computed(() => props.cell.scoring.scores.map(summary => ({
  label: scoreLabel(summary.name, props.definitions),
  mean: summary.mean,
  n: summary.n,
  name: summary.name,
  primary: summary.name === props.cell.scoring.primary,
})))
const points = (delta: number) => `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta * 100).toFixed(1)}`
</script>

<template>
  <div :class="['flex flex-col gap-2 w-80 max-h-[min(36rem,var(--reka-hover-card-content-available-height))] overflow-y-auto p-1 text-xs']" data-testid="matrix-cell-detail">
    <div :class="['flex flex-wrap gap-1 px-1 pt-1']">
      <span v-for="coordinate in props.coordinates" :key="coordinate.name" :class="['badge state-neutral font-normal']">
        <span :class="['muted']">{{ coordinate.name }}</span>{{ coordinate.value }}
      </span>
    </div>

    <MatrixCellCard :cell="props.cell" :comparison="props.comparison" :definitions="props.definitions" :averaged-names="props.averagedNames" />

    <div v-if="props.comparison" :class="['flex flex-col gap-0.5 px-2']" data-testid="matrix-cell-detail-baseline">
      <span :class="['muted']">{{ t('matrix.detail.against', { baseline: props.baselineLabel ?? '' }) }}</span>
      <span :class="['flex items-baseline gap-2 tabular-nums']">
        <span>{{ formatScore(props.comparison.base.value) }} → {{ formatScore(props.cell.value) }}</span>
        <span :class="['font-semibold', props.comparison.clear ? (props.comparison.delta >= 0 ? 'text-primary-700 dark:text-primary-300' : '[color:var(--series-1-opposite)]') : 'muted']">{{ points(props.comparison.delta) }}</span>
      </span>
      <span :class="['muted']">{{ t(props.comparison.clear ? 'matrix.baseline.clear' : 'matrix.baseline.noise') }}</span>
    </div>

    <div v-if="interval" :class="['px-2 muted tabular-nums']" data-testid="matrix-cell-detail-interval">
      {{ t('matrix.detail.interval', { high: formatScore(interval.high), low: formatScore(interval.low), n: formatCount(headlineCount ?? 0) }) }}
    </div>

    <div v-if="scores.length > 1" :class="['flex flex-col px-2']" data-testid="matrix-cell-detail-scores">
      <span :class="['muted pb-1']">{{ t('matrix.detail.scores') }}</span>
      <span v-for="score in scores" :key="score.name" :class="['grid grid-cols-[1fr_auto_3.5rem] gap-2 py-0.5 tabular-nums', score.primary && 'font-semibold']">
        <span :class="['truncate']" :title="score.name">{{ score.label }}</span>
        <span>{{ formatScore(score.mean) }}</span>
        <span :class="['muted text-right']">n {{ formatCount(score.n) }}</span>
      </span>
    </div>

    <div v-if="props.cell.members.length > 1" :class="['flex flex-col px-2 pb-1']" data-testid="matrix-cell-detail-members">
      <span :class="['muted pb-1']">{{ t('matrix.detail.members', { axes: props.averagedNames.join(' · ') }) }}</span>
      <span v-for="member in props.cell.members" :key="member.runRowId" :class="['grid grid-cols-[1fr_auto_auto] items-center gap-2 py-0.5 tabular-nums']">
        <span :class="['truncate']">{{ props.averagedNames.map(name => member.run[name] ?? member.eval[name] ?? '—').join(' · ') }}</span>
        <span>{{ formatScore(headlineValue(headlineOf(member.latest.scoring))) }}</span>
        <span :class="['muted text-right']">{{ t('matrix.view.caseCount', { n: formatCount(member.latest.counts.total) }, member.latest.counts.total) }}</span>
      </span>
    </div>

    <div v-if="props.cell.completion" :class="['flex items-start gap-1.5 px-2 pb-1']" data-testid="matrix-cell-detail-completion">
      <CompletionRing :class="['mt-px']" :completion="props.cell.completion" :size="12" />
      <span :class="['flex flex-col muted']">
        <span>{{ t(props.cell.completion.errored > 0 ? 'matrix.ring.errored' : 'matrix.ring.label', { errored: formatCount(props.cell.completion.errored), expected: formatCount(props.cell.completion.expected), scored: formatCount(props.cell.completion.scored) }) }}</span>
        <span v-if="!isSettled(props.cell)">{{ t('matrix.detail.excluded') }}</span>
      </span>
    </div>
  </div>
</template>
