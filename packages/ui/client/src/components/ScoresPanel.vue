<script setup lang="ts">
import type { CaseScoring, RunSnapshot, ScoreSummary } from '../../../src/shared/contract'
import type { CaseFilters, CaseRow } from '../caseMetrics'
import type { BarDatum } from './BarChart.vue'
import type { LinePoint } from './LineChart.vue'

import { useQuery } from '@pinia/colada'
import { computed, reactive, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import BarChart from './BarChart.vue'
import CaseCartesian from './CaseCartesian.vue'
import CaseMetricsPanel from './CaseMetricsPanel.vue'
import CountsBar from './CountsBar.vue'
import HeadlineScore from './HeadlineScore.vue'
import LineChart from './LineChart.vue'
import MetricInfo from './MetricInfo.vue'
import PairsHeatmap from './PairsHeatmap.vue'
import ScatterMatrix from './ScatterMatrix.vue'
import SegmentedControl from './SegmentedControl.vue'
import StateView from './StateView.vue'

import { api } from '../api'
import { buildCaseTable, columnDefinitions, metricLabel, metricScale, separationOf } from '../caseMetrics'
import { formatScore, previewValue } from '../format'
import { levelIcons } from '../hierarchy'
import { href, navigate } from '../router'
import { graderText, headlineOf, scoreColumn, scoreDefinition, scoreLabel, unscoredText } from '../scores'

/**
 * Scores and metrics of a run: the completion rate and every score over the whole run (label, mean, counted cases,
 * unscored reasons, formula, grader; the primary score marked), scores per matrix row (task) and per auto-attempt
 * round, numeric metrics as small multiples, and the other recorded values.
 */
const props = defineProps<{
  /** Changes when the run advanced, at most once per refetch interval (`useRunLive().refreshKey`). */
  refreshKey: number | undefined
  snapshot: RunSnapshot
}>()
const { t } = useI18n()
const runKey = computed(() => props.snapshot.runKey)

// Refetch whenever the run advanced (throttled seq), so live runs keep their charts current.
const scores = useQuery({ key: () => ['runs', runKey.value, 'scores'], query: () => api.scores(runKey.value) })
const metrics = useQuery({ key: () => ['runs', runKey.value, 'metrics'], query: () => api.metrics(runKey.value) })
// The run advanced: re-read the same entries, so the charts keep showing the previous data meanwhile.
watch(() => props.refreshKey, () => {
  void scores.refetch()
  void metrics.refetch()
})

const matrixKeys = computed(() => [...new Set(props.snapshot.tasks.flatMap(task => Object.keys({ ...task.matrix?.run, ...task.matrix?.eval })))])
const scoreDefinitions = computed(() => scores.data.value?.definitions ?? props.snapshot.scoreDefinitions)
/** Every score of the run in the order the summary lists them; the series of the bar charts and the table columns. */
const scoreNames = computed(() => (scores.data.value?.overall.scores ?? []).map(summary => summary.name))
/** Primary scores of the run: the one of the headline, or each task's under a `per-task` headline. */
const primaries = computed(() => {
  const headline = scores.data.value?.overall.headline?.headline
  if (headline == null || headline.kind === 'passed-cases')
    return new Set<string>()
  return new Set(headline.kind === 'score' ? [headline.score.name] : headline.tasks.map(task => task.score.name))
})
/**
 * Rows of the scores table: the completion rate first (how many cases produced a result, so a score is never read
 * without it), then every score with its definition, formula, and grader.
 */
const scoreRows = computed(() => {
  const overall = scores.data.value?.overall
  if (overall == null)
    return []
  const completion: ScoreSummary | undefined = overall.headline?.completion
  const rows = overall.scores.map((summary) => {
    const definition = scoreDefinition(summary.name, scoreDefinitions.value)
    return {
      column: definition == null ? undefined : scoreColumn(definition, scoreDefinitions.value),
      // Cases that counted toward the mean.
      counted: summary.n,
      grader: definition?.grader == null ? undefined : graderText(definition.grader),
      label: scoreLabel(summary.name, scoreDefinitions.value),
      primary: primaries.value.has(summary.name),
      summary,
    }
  }).toSorted((a, b) => Number(b.primary) - Number(a.primary))
  if (completion == null)
    return rows
  // Every settled case counts toward the completion rate as 1 or 0, so its count is the cases that produced a result.
  return [{ column: undefined, counted: completion.sum, grader: undefined, label: t('scores.completion.label'), primary: false, summary: completion }, ...rows]
})
const meanOf = (scoring: CaseScoring, name: string) => scoring.scores.find(summary => summary.name === name)?.mean ?? null
const byTask = computed<BarDatum[]>(() => (scores.data.value?.byTask ?? []).map(task => ({ href: href({ name: 'task', runKey: runKey.value, taskId: task.taskId }), label: task.displayName, values: scoreNames.value.map(name => meanOf(task.scoring, name)) })))
const byRound = computed<BarDatum[]>(() => (scores.data.value?.byRound ?? []).map(round => ({ label: t('scores.panel.round', { round: round.roundIndex, task: props.snapshot.tasks.find(task => task.id === round.taskId)?.displayName ?? round.taskId }), values: scoreNames.value.map(name => meanOf(round.scoring, name)) })))
const taskLabel = (taskId: string) => props.snapshot.tasks.find(task => task.id === taskId)?.displayName ?? taskId
/** Names of the "Other metrics" rows that are expanded; every row starts collapsed to one line. */
const expanded = reactive(new Set<string>())
/** One line for a collapsed row: the distinct values, each cut short. */
function distinctPreview(values: readonly { value: unknown }[]): string {
  return [...new Set(values.map(entry => previewValue(entry.value, 60)))].join(' · ')
}
/** Full value of an expanded row: strings as they are, everything else as indented JSON. */
function fullValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value)
}
function toggleMetric(name: string): void {
  if (!expanded.delete(name))
    expanded.add(name)
}
const definitions = computed(() => columnDefinitions(metrics.data.value?.definitions ?? [], metrics.data.value?.scoreDefinitions ?? []))
const labelOf = (name: string) => metricLabel(name, definitions.value)

/**
 * The numeric metrics of the whole run, three ways: each metric over the recording order, every pair of metrics as
 * small scatterplots (matrix), or every pair as one cell colored by correlation with a picked pair's scatterplot
 * (pairs). The matrix and pairs views use one row per case of every task (metrics joined by task and case), the
 * metrics that carry their own signal (repeats folded, constants dropped), most telling of failure first.
 */
type NumericView = 'matrix' | 'pairs' | 'time'
const numericView = shallowRef<NumericView>('time')
const numericViews = computed(() => [
  { icon: 'i-mingcute-chart-line-line', label: t('metrics.run.views.time'), value: 'time' as const },
  { icon: 'i-mingcute-grid-line', label: t('metrics.run.views.matrix'), value: 'matrix' as const },
  { icon: 'i-mingcute-layout-grid-line', label: t('metrics.run.views.pairs'), value: 'pairs' as const },
])
/** A matrix of scatterplots stays legible up to five metrics; the pairs heatmap up to a dozen. */
const RUN_MATRIX_METRICS = 5
const RUN_PAIRS_METRICS = 12
const runTable = computed(() => buildCaseTable(props.snapshot.tasks.flatMap(task => task.cases), metrics.data.value))
const runSeparation = computed(() => separationOf(runTable.value))
const runMetrics = computed(() => runTable.value.groups.map(group => group.representative)
  .toSorted((a, b) => (runSeparation.value.get(b)?.auc ?? 0) - (runSeparation.value.get(a)?.auc ?? 0)))
const runScales = computed(() => Object.fromEntries(runMetrics.value.map(name => [name, metricScale(runTable.value, name)])))
// Nothing is filtered on this page: every case is selected and colored by how it ended.
const everyCase = computed(() => new Set(runTable.value.rows.map(row => row.key)))
const noFilters: CaseFilters = { box: null, categories: {}, ranges: {} }
const byState = (row: CaseRow) => `var(--mark-${row.state})`
const runPair = shallowRef<[string, string]>()
// A dot opens its case, the way a case row of the tables does.
function openCase(row: CaseRow | null): void {
  if (row != null)
    navigate({ caseId: row.caseId, name: 'case', runKey: runKey.value, taskId: row.taskId })
}

const numeric = computed(() => (metrics.data.value?.numeric ?? []).map(metric => ({
  ...metric,
  points: metric.points.map<LinePoint>((point, index) => ({ label: `#${index + 1} ${point.caseId ?? ''}`, x: index, y: point.value as number })),
})))
</script>

<template>
  <div :class="['flex flex-col gap-4']">
    <StateView :error="scores.error.value" :loading="scores.isPending.value" skeleton="panel" @retry="scores.refetch()">
      <section :class="['card']">
        <h2 class="card-title">
          <span class="i-mingcute-target-line" aria-hidden="true" />{{ t('scores.panel.title') }}
        </h2>
        <div :class="['overflow-x-auto']">
          <table :class="['w-full']" data-testid="score-rows">
            <thead>
              <tr :class="['border-b border-neutral-200/50 dark:border-neutral-800/50']">
                <th class="th">
                  {{ t('scores.panel.columns.score') }}
                </th>
                <th class="th text-right">
                  {{ t('scores.panel.columns.mean') }}
                </th>
                <th class="th text-right">
                  {{ t('scores.panel.columns.counted') }}
                </th>
                <th class="th">
                  {{ t('scores.panel.columns.notCounted') }}
                </th>
                <th class="th">
                  {{ t('scores.panel.columns.formula') }}
                </th>
                <th class="th">
                  {{ t('scores.panel.columns.grader') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in scoreRows" :key="row.summary.name" :class="['border-b border-neutral-100/70 dark:border-neutral-900']" data-testid="score-row">
                <td :class="['td text-sm whitespace-nowrap']">
                  <MetricInfo :name="row.summary.name" :definition="row.column" :values="[]" :summary="row.summary">
                    <span :class="['cursor-help', row.column?.label == null && row.column != null && 'mono']">{{ row.label }}</span>
                  </MetricInfo>
                  <span v-if="row.primary" :class="['badge state-neutral ml-1.5']" data-testid="score-row-primary">{{ t('scores.panel.primary') }}</span>
                </td>
                <td :class="['td text-right tabular-nums font-semibold']">
                  {{ formatScore(row.summary.mean) }}
                </td>
                <td :class="['td text-right mono text-xs whitespace-nowrap']">
                  {{ row.counted }} / {{ row.summary.total }}
                </td>
                <td :class="['td text-xs muted']">
                  {{ unscoredText(row.summary.unscored) || '—' }}
                </td>
                <td :class="['td text-xs']">
                  {{ row.column?.formula ?? '—' }}
                </td>
                <td :class="['td text-xs mono']">
                  {{ row.grader ?? '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="scoreRows.length <= 1" :class="['px-3 py-2 text-xs muted']">
          {{ t('scores.panel.noScore', { code: 'context.recordScore(score, value)' }) }}
        </p>
        <div v-if="scores.data.value?.summary" :class="['flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-xs']">
          <span class="muted">{{ t('scores.panel.officialSummary', { file: 'run-summary.json' }) }}</span>
          <HeadlineScore :result="scores.data.value.summary" :definitions="scoreDefinitions" size="sm" :task-label="taskLabel" />
        </div>
      </section>

      <!-- Every case of the run against the matrix axes and its metrics: where the score is lost across tasks. -->
      <CaseMetricsPanel :cases="props.snapshot.tasks.flatMap(task => task.cases)" :refresh-key="props.refreshKey" :run-key="runKey" />

      <section :class="['card']" data-testid="matrix-rows">
        <h2 :class="['card-title flex-wrap']">
          <span class="i-mingcute-layout-grid-line" aria-hidden="true" />{{ t('scores.panel.matrixRows') }}
          <a :class="['btn text-xs ml-auto font-normal']" :href="href({ name: 'compare', query: { run: runKey, view: 'matrix' } })"><span class="i-mingcute-git-compare-line" aria-hidden="true" />{{ t('scores.panel.compareRows') }}</a>
        </h2>
        <div :class="['overflow-x-auto']">
          <table :class="['w-full']">
            <thead>
              <tr :class="['border-b border-neutral-200/50 dark:border-neutral-800/50']">
                <th class="th">
                  {{ t('scores.panel.matrixColumns.task') }}
                </th>
                <th v-for="key in matrixKeys" :key="key" class="th">
                  {{ key }}
                </th>
                <th class="th">
                  {{ t('scores.panel.matrixColumns.cases') }}
                </th>
                <th class="th text-right">
                  {{ t('scores.panel.matrixColumns.headline') }}
                </th>
                <th v-for="name in scoreNames" :key="name" class="th text-right">
                  {{ scoreLabel(name, scoreDefinitions) }}
                </th>
                <th class="th text-right">
                  {{ t('scores.panel.matrixColumns.rounds') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="task in props.snapshot.tasks" :key="task.id" :class="['border-b border-neutral-100/70 dark:border-neutral-900']">
                <td class="td">
                  <a :class="['link']" :href="href({ name: 'task', runKey, taskId: task.id })">{{ task.displayName }}</a>
                </td>
                <td v-for="key in matrixKeys" :key="key" :class="['td mono text-xs']">
                  {{ task.matrix?.run[key] ?? task.matrix?.eval[key] ?? '—' }}
                </td>
                <td :class="['td min-w-48']">
                  <CountsBar :counts="task.caseCounts" />
                </td>
                <td :class="['td text-right']">
                  <HeadlineScore :result="headlineOf(task.scoring)" :definitions="scoreDefinitions" size="sm" align="end" />
                </td>
                <td v-for="name in scoreNames" :key="name" :class="['td text-right mono text-xs']">
                  {{ formatScore(meanOf(task.scoring, name)) }}
                </td>
                <td :class="['td text-right mono text-xs']">
                  {{ task.roundCount }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="byTask.length > 0 && scoreNames.length > 0" class="p-3">
          <BarChart :data="byTask" :series="scoreNames.map(name => scoreLabel(name, scoreDefinitions))" />
        </div>
      </section>

      <section v-if="byRound.length > 1 && scoreNames.length > 0" :class="['card']">
        <h2 class="card-title">
          <span :class="levelIcons.round" aria-hidden="true" />{{ t('scores.panel.byRound') }}
        </h2>
        <div class="p-3">
          <BarChart :data="byRound" :series="scoreNames.map(name => scoreLabel(name, scoreDefinitions))" />
        </div>
      </section>
    </StateView>

    <StateView :error="metrics.error.value" :loading="metrics.isPending.value" :empty="metrics.data.value?.numeric.length === 0 && metrics.data.value?.nonNumeric.length === 0" :empty-text="t('metrics.run.empty')" :empty-hint="t('metrics.run.emptyHint', { code: 'context.recordMetric(name, value)' })" skeleton="panel" @retry="metrics.refetch()">
      <section v-if="numeric.length > 0" :class="['card']" data-testid="metric-charts">
        <h2 class="card-title flex-wrap">
          <span class="i-mingcute-chart-line-line" aria-hidden="true" />{{ t('metrics.run.numeric') }}
          <span class="text-xs muted font-normal">{{ numericView === 'time' ? t('metrics.run.inRecordingOrder') : t('metrics.run.casesOfEveryTask', { n: runTable.rows.length }, runTable.rows.length) }}</span>
          <span :class="['ml-auto font-normal']"><SegmentedControl v-model="numericView" :items="numericViews" :label="t('metrics.run.viewLabel')" /></span>
        </h2>
        <div v-if="numericView === 'time'" :class="['grid gap-4 p-3']" style="grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr))">
          <div v-for="metric in numeric" :key="metric.name">
            <LineChart :name="metric.name" :points="metric.points">
              <template #caption>
                <MetricInfo :name="metric.name" :definition="definitions.get(metric.name)" :values="metric.points.map(point => point.y)">
                  <span :class="['cursor-help underline decoration-dotted decoration-neutral-400/60 underline-offset-2']">{{ labelOf(metric.name) }}</span>
                </MetricInfo>
              </template>
            </LineChart>
            <div class="text-xs muted tabular-nums">
              {{ t('metrics.run.stats', { avg: Math.round(metric.summary.avg * 1000) / 1000, max: metric.summary.max, min: metric.summary.min, n: metric.summary.count }) }}
            </div>
          </div>
        </div>
        <div v-else-if="runMetrics.length < 2" :class="['p-3 text-sm muted']">
          {{ t('metrics.run.pairsNeedTwo') }}
        </div>
        <div v-else-if="numericView === 'matrix'" :class="['grid gap-1 p-3']">
          <div :class="['text-xs muted']">
            {{ t('metrics.run.matrixHint', { n: Math.min(RUN_MATRIX_METRICS, runMetrics.length) }) }}
          </div>
          <ScatterMatrix :color-of="byState" :filters="noFilters" :label-of="labelOf" :metrics="runMetrics.slice(0, RUN_MATRIX_METRICS)" :rows="runTable.rows" :scales="runScales" :selected="everyCase" @pin="openCase" />
        </div>
        <div v-else :class="['grid gap-3 p-3']">
          <PairsHeatmap :label-of="labelOf" :metrics="runMetrics.slice(0, RUN_PAIRS_METRICS)" :rows="runTable.rows" :selected-pair="runPair" :separation="runSeparation" @select="pair => runPair = pair" />
          <CaseCartesian
            v-if="runPair"
            :axes="runPair.map(name => ({ kind: 'numeric' as const, name }))" :category-values="{}" :color-of="byState" :filters="noFilters" :label-of="labelOf" :rows="runTable.rows" :scales="runScales" :selected="everyCase"
            @pin="openCase"
          />
        </div>
      </section>
      <section v-if="(metrics.data.value?.nonNumeric.length ?? 0) > 0" :class="['card']">
        <h2 class="card-title">
          <span class="i-mingcute-list-check-line" aria-hidden="true" />{{ t('metrics.run.other') }}
        </h2>
        <ul :class="['divide-y divide-neutral-100/70 dark:divide-neutral-900']">
          <li v-for="metric in metrics.data.value?.nonNumeric" :key="metric.name" :class="['text-xs']">
            <button
              type="button"
              :aria-expanded="expanded.has(metric.name)"
              :class="['flex items-center gap-2 w-full min-w-0 px-2 py-1.5 text-left hover:bg-neutral-500/5']"
              :data-testid="`metric-toggle-${metric.name}`"
              @click="toggleMetric(metric.name)"
            >
              <span :class="['i-mingcute-right-line shrink-0 muted transition-transform', expanded.has(metric.name) && 'rotate-90']" aria-hidden="true" />
              <MetricInfo :name="metric.name" :definition="definitions.get(metric.name)" :values="metric.values.map(entry => entry.value)">
                <span :class="['whitespace-nowrap cursor-help', definitions.get(metric.name)?.label == null && 'mono']">{{ labelOf(metric.name) }}</span>
              </MetricInfo>
              <span :class="['mono muted shrink-0']">{{ metric.values.length }}×</span>
              <span v-if="!expanded.has(metric.name)" :class="['mono truncate min-w-0 muted']">{{ distinctPreview(metric.values) }}</span>
            </button>
            <ol v-if="expanded.has(metric.name)" :class="['flex flex-col gap-1 pl-8 pr-2 pb-2']" :data-testid="`metric-values-${metric.name}`">
              <li v-for="entry in metric.values" :key="entry.seq" :class="['flex items-start gap-3 min-w-0']">
                <a
                  v-if="entry.taskId && entry.caseId"
                  :href="href({ caseId: entry.caseId, name: 'case', runKey, taskId: entry.taskId })"
                  :class="['link mono shrink-0 max-w-64 max-md:max-w-32 truncate']"
                  :title="entry.caseId"
                >{{ entry.caseId }}</a>
                <span v-else :class="['mono muted shrink-0']">{{ t('metrics.run.runValue') }}</span>
                <span :class="['mono whitespace-pre-wrap break-all min-w-0']">{{ fullValue(entry.value) }}</span>
              </li>
            </ol>
          </li>
        </ul>
      </section>
      <section v-if="metrics.data.value && metrics.data.value.inference.requests > 0" :class="['card p-3 text-sm']">
        {{ t('metrics.run.inference', { failed: metrics.data.value.inference.failed, requests: metrics.data.value.inference.requests, responses: metrics.data.value.inference.responses }) }}
        <span v-for="(value, key) in metrics.data.value.inference.totals" :key="key" class="ml-3 tabular-nums">{{ key }}={{ value }}</span>
      </section>
    </StateView>
  </div>
</template>
