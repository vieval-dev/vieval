<script setup lang="ts">
import type { MatrixCell, ScoreDefinition } from '../../../src/shared/contract'
import type { CellComparison, GridCell } from '../matrixGrid'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import CompletionRing from './CompletionRing.vue'
import ScoreBar from './ScoreBar.vue'
import ScoreCard from './ScoreCard.vue'
import Sparkline from './Sparkline.vue'

import { useCatalog } from '../composables/useCatalog'
import { formatCount, formatScore } from '../format'
import { attemptLabel, formatShortDateTime } from '../labels'
import { href } from '../router'
import { headlineOf, headlineValue, headlineView } from '../scores'

/**
 * The card of one matrix cell: its headline, how the case scores spread, when it ran, and its trend across runs. The
 * card view of the matrix lays these out in the grid; the compact view opens the same card on hover, so both views
 * say the same things about a cell.
 *
 * A cell averaged over repeats (`seed`, `repeat`) shows the pooled score and each repeat's value in place of one run's
 * time and trend.
 */
const props = defineProps<{
  /** Names of the averaged axes, for the line of each repeat's value. */
  averagedNames: readonly string[]
  cell: GridCell
  /** The cell against the reader's baseline; its difference replaces the change from the previous run. */
  comparison?: CellComparison
  definitions: readonly ScoreDefinition[]
}>()
const { t } = useI18n()
const catalog = useCatalog()

const single = computed<MatrixCell | undefined>(() => (props.cell.members.length === 1 ? props.cell.members[0] : undefined))
const lead = computed(() => props.cell.members[0]!)
const headline = computed(() => headlineOf(props.cell.scoring))
const label = computed(() => headlineView(headline.value, props.definitions).label)
const running = computed(() => props.cell.members.some(member => member.latest.state === 'running' || member.latest.state === 'queued'))
/**
 * The catalog entry of the run still running in this cell (of an averaged cell, the repeat that runs), whose event
 * sequence drives the progress and the expected end of the card.
 */
const run = computed(() => {
  const active = props.cell.members.find(member => member.latest.state === 'running' || member.latest.state === 'queued') ?? lead.value
  return catalog.runs.value.find(item => item.runKey === active.latest.runKey)
})
const caseTotal = computed(() => props.cell.members.reduce((total, member) => total + member.latest.counts.total, 0))
/** When the cell's runs started: one time, or the first and the last of an averaged cell's repeats. */
const startedText = computed(() => {
  const times = props.cell.members.map(member => member.latest.startedAt).filter((time): time is string => time != null).toSorted()
  if (times.length === 0)
    return attemptLabel(lead.value.latest.attemptId)
  const first = formatShortDateTime(new Date(times[0]!))
  const last = formatShortDateTime(new Date(times.at(-1)!))
  return first === last ? first : `${first} – ${last}`
})
/** Members whose newest run has not measured every case yet, for the line that says so. */
const partial = computed(() => props.cell.members.filter(member => member.latest.coverage !== 'full' && member.latest.state !== 'running' && member.latest.state !== 'queued'))
const counts = computed(() => {
  const sum = (pick: (member: MatrixCell) => number) => props.cell.members.reduce((total, member) => total + pick(member), 0)
  return {
    errored: sum(member => member.latest.counts.errored),
    failed: sum(member => member.latest.counts.failed),
    passed: sum(member => member.latest.counts.passed),
    requeued: sum(member => member.latest.counts.requeued),
    running: sum(member => member.latest.counts.running),
    skipped: sum(member => member.latest.counts.skipped),
    timeout: sum(member => member.latest.counts.timeout),
    total: sum(member => Math.max(member.latest.counts.total, member.latest.caseTotal ?? 0)),
  }
})
/**
 * Whether the cell is read by its score: it has a primary score and no case failed an assertion, so the case counts
 * are all green and say nothing; how the scores spread does.
 */
const scored = computed(() => props.cell.scoring.primary != null && counts.value.failed === 0 && !running.value)
const state = computed(() => {
  const states = [...new Set(props.cell.members.map(member => member.latest.state))]
  const shown = running.value ? 'running' : states.length === 1 ? states[0] : undefined
  return scored.value && shown === 'passed' ? undefined : shown
})

/**
 * Change of the primary score from the previous full run, in percentage points; `undefined` unless the cell's run and
 * an earlier run both covered the cell fully (a partial run or one without a result is no baseline).
 */
const previousDelta = computed(() => {
  const cell = single.value
  const latest = props.cell.value
  if (cell == null || cell.latest.coverage !== 'full' || latest == null)
    return undefined
  const index = cell.history.findIndex(point => point.runKey === cell.latest.runKey)
  const previous = cell.history.slice(0, Math.max(0, index)).findLast(point => point.coverage === 'full' && point.score != null)
  return previous == null ? undefined : (latest - previous.score!) * 100
})
const baselineDelta = computed(() => (props.comparison == null ? undefined : props.comparison.delta * 100))

/** When a point of a cell's history started: its run's start time, else the attempt label. */
function pointTime(point: MatrixCell['history'][number]): string {
  return point.startedAt == null ? attemptLabel(point.attemptId) : formatShortDateTime(new Date(point.startedAt))
}
/** Tooltip of one history point: when, how much it measured, its score, and its completion rate. */
function pointTitle(cell: MatrixCell, point: MatrixCell['history'][number]): string {
  return t('matrix.view.pointTitle', {
    completion: formatScore(point.completion),
    coverage: t(`matrix.view.coverage.${point.coverage}`),
    measured: formatCount(point.counts.passed + point.counts.failed),
    score: label.value,
    time: pointTime(point),
    total: formatCount(cell.caseCount),
    value: formatScore(point.score),
  })
}
</script>

<template>
  <ScoreCard
    compact hide-completion
    :href="href({ name: 'task', runKey: lead.latest.runKey, taskId: lead.latest.taskId })"
    :headline="headline"
    :definitions="props.definitions"
    :state="state"
    :counts="scored ? undefined : counts"
    :run="running ? run : undefined"
    data-testid="matrix-cell"
  >
    <template #score>
      <span
        v-if="baselineDelta !== undefined"
        :class="['text-xs font-medium tabular-nums', props.comparison!.clear ? (baselineDelta >= 0 ? 'text-primary-700 dark:text-primary-300' : '[color:var(--series-3)]') : 'muted']"
        :title="t(props.comparison!.clear ? 'matrix.baseline.clear' : 'matrix.baseline.noise')"
        data-testid="matrix-cell-baseline-delta"
      >{{ baselineDelta > 0 ? '+' : baselineDelta < 0 ? '−' : '±' }}{{ Math.abs(baselineDelta).toFixed(1) }}</span>
      <span
        v-else-if="previousDelta !== undefined && Math.abs(previousDelta) >= 0.05"
        :class="['inline-flex items-center text-xs font-medium tabular-nums', previousDelta > 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400']"
        :title="t('matrix.view.deltaTitle', { delta: `${previousDelta > 0 ? '+' : ''}${previousDelta.toFixed(1)}` })"
        data-testid="matrix-cell-delta"
      >
        <span :class="[previousDelta > 0 ? 'i-mingcute-arrow-up-line' : 'i-mingcute-arrow-down-line']" aria-hidden="true" />{{ Math.abs(previousDelta).toFixed(1) }}
      </span>
    </template>
    <!-- In place of "completed 96.8%": a full ring when every case settled, a gap when some are missing. -->
    <template #corner>
      <CompletionRing :completion="props.cell.progress" :size="18" />
    </template>
    <template v-if="scored" #bar>
      <ScoreBar :class="['w-full']" :scores="props.cell.caseScores" />
    </template>
    <span :class="['flex items-center gap-1.5 min-w-0']" :title="props.cell.members.map(member => `${attemptLabel(member.latest.attemptId)} · ${member.latest.runKey}`).join('\n')">
      <span :class="['truncate']">{{ startedText }} · {{ t('matrix.view.caseCount', { n: formatCount(caseTotal) }, caseTotal) }}<template v-if="single"> · {{ t('matrix.view.runCount', { n: formatCount(single.history.length) }, single.history.length) }}</template></span>
      <Sparkline
        v-if="single"
        :class="['ml-auto']" :values="single.history.map(point => point.score)" :coverage="single.history.map(point => point.coverage)" :titles="single.history.map(point => pointTitle(single!, point))"
        :label="t('matrix.view.sparkline', { n: formatCount(single.history.length), score: label }, single.history.length)" :width="48" :height="16"
      />
    </span>
    <span v-if="!single" :class="['truncate tabular-nums']" :title="props.cell.members.map(member => `${props.averagedNames.map(name => member.run[name] ?? member.eval[name] ?? '—').join(' · ')}: ${formatScore(headlineValue(headlineOf(member.latest.scoring)))}`).join('\n')" data-testid="matrix-cell-members">
      {{ t('matrix.averaged.members', { axes: props.averagedNames.join(' · '), n: formatCount(props.cell.members.length) }, props.cell.members.length) }}
      {{ props.cell.members.map(member => formatScore(headlineValue(headlineOf(member.latest.scoring)))).join(' / ') }}
    </span>
    <span v-for="member in partial" :key="member.runRowId" :class="['flex items-center gap-1.5 [color:var(--ink-errored)]']" data-testid="matrix-cell-partial">
      <span class="i-mingcute-alert-octagon-line" aria-hidden="true" />{{ t('matrix.view.partial', { measured: formatCount(member.latest.counts.passed + member.latest.counts.failed), total: formatCount(member.caseCount) }) }}
    </span>
  </ScoreCard>
</template>
