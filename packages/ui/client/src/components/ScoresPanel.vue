<script setup lang="ts">
import type { MetricDefinition, RunSnapshot } from '../../../src/shared/contract'
import type { CaseFilters, CaseRow } from '../caseMetrics'
import type { BarDatum } from './BarChart.vue'
import type { LinePoint } from './LineChart.vue'

import { useQuery } from '@pinia/colada'
import { computed, reactive, shallowRef, watch } from 'vue'

import BarChart from './BarChart.vue'
import CaseCartesian from './CaseCartesian.vue'
import CountsBar from './CountsBar.vue'
import LineChart from './LineChart.vue'
import MetricInfo from './MetricInfo.vue'
import PairsHeatmap from './PairsHeatmap.vue'
import ScatterMatrix from './ScatterMatrix.vue'
import SegmentedControl from './SegmentedControl.vue'
import StateView from './StateView.vue'

import { api } from '../api'
import { buildCaseTable, metricScale, separationOf } from '../caseMetrics'
import { formatScore, previewValue } from '../format'
import { levelIcons } from '../hierarchy'
import { localize } from '../localize'
import { href, navigate } from '../router'

/**
 * Scores and metrics of a run: overall scores, scores per matrix row (task) and per auto-attempt round, numeric
 * metrics as small multiples, and the other recorded values.
 */
const props = defineProps<{
  /** Changes when the run advanced, at most once per refetch interval (`useRunLive().refreshKey`). */
  refreshKey: number | undefined
  snapshot: RunSnapshot
}>()
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
const byTask = computed<BarDatum[]>(() => (scores.data.value?.byTask ?? []).map(task => ({ href: href({ name: 'task', runKey: runKey.value, taskId: task.taskId }), label: task.displayName, values: [task.exact, task.judge] })))
const byRound = computed<BarDatum[]>(() => (scores.data.value?.byRound ?? []).map(round => ({ label: `${props.snapshot.tasks.find(task => task.id === round.taskId)?.displayName ?? round.taskId} · round ${round.roundIndex}`, values: [round.exact, round.judge] })))
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
const definitions = computed(() => new Map<string, MetricDefinition>((metrics.data.value?.definitions ?? []).map(definition => [definition.name, definition])))
const labelOf = (name: string) => localize(definitions.value.get(name)?.label) ?? name

/**
 * The numeric metrics of the whole run, three ways: each metric over the recording order, every pair of metrics as
 * small scatterplots (matrix), or every pair as one cell colored by correlation with a picked pair's scatterplot
 * (pairs). The matrix and pairs views use one row per case of every task (metrics joined by task and case), the
 * metrics that carry their own signal (repeats folded, constants dropped), most telling of failure first.
 */
type NumericView = 'matrix' | 'pairs' | 'time'
const numericView = shallowRef<NumericView>('time')
const numericViews = [
  { icon: 'i-mingcute-chart-line-line', label: 'Over time', value: 'time' as const },
  { icon: 'i-mingcute-grid-line', label: 'Matrix', value: 'matrix' as const },
  { icon: 'i-mingcute-layout-grid-line', label: 'Pairs', value: 'pairs' as const },
]
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
          <span class="i-mingcute-target-line" aria-hidden="true" />Scores
        </h2>
        <dl :class="['flex flex-wrap gap-x-8 gap-y-2 px-3 py-2 text-sm']">
          <div v-for="kind in (['exact', 'judge', 'hybrid'] as const)" :key="kind">
            <dt class="text-xs muted">
              {{ kind }} (events)
            </dt>
            <dd class="text-xl font-semibold tabular-nums">
              {{ formatScore(scores.data.value?.overall[kind]) }}
            </dd>
          </div>
          <div v-if="scores.data.value?.summary">
            <dt class="text-xs muted">
              exact (run-summary.json)
            </dt>
            <dd class="text-xl font-semibold tabular-nums">
              {{ formatScore(scores.data.value.summary.exact) }}
            </dd>
          </div>
        </dl>
      </section>

      <section :class="['card']" data-testid="matrix-rows">
        <h2 :class="['card-title flex-wrap']">
          <span class="i-mingcute-layout-grid-line" aria-hidden="true" />Matrix rows (tasks)
          <a :class="['btn text-xs ml-auto font-normal']" :href="href({ name: 'compare', query: { run: runKey, view: 'matrix' } })"><span class="i-mingcute-git-compare-line" aria-hidden="true" />Compare cases across rows</a>
        </h2>
        <div :class="['overflow-x-auto']">
          <table :class="['w-full']">
            <thead>
              <tr :class="['border-b border-neutral-200/50 dark:border-neutral-800/50']">
                <th class="th">
                  Task
                </th>
                <th v-for="key in matrixKeys" :key="key" class="th">
                  {{ key }}
                </th>
                <th class="th">
                  Cases
                </th>
                <th class="th text-right">
                  Exact
                </th>
                <th class="th text-right">
                  Judge
                </th>
                <th class="th text-right">
                  Rounds
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
                <td :class="['td text-right mono text-xs']">
                  {{ formatScore(task.scores.exact) }}
                </td>
                <td :class="['td text-right mono text-xs']">
                  {{ formatScore(task.scores.judge) }}
                </td>
                <td :class="['td text-right mono text-xs']">
                  {{ task.roundCount }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="byTask.length > 0" class="p-3">
          <BarChart :data="byTask" :series="['exact', 'judge']" />
        </div>
      </section>

      <section v-if="byRound.length > 1" :class="['card']">
        <h2 class="card-title">
          <span :class="levelIcons.round" aria-hidden="true" />Scores per auto-attempt round
        </h2>
        <div class="p-3">
          <BarChart :data="byRound" :series="['exact', 'judge']" />
        </div>
      </section>
    </StateView>

    <StateView :error="metrics.error.value" :loading="metrics.isPending.value" :empty="metrics.data.value?.numeric.length === 0 && metrics.data.value?.nonNumeric.length === 0" empty-text="No metrics recorded" empty-hint="Cases record metrics with context.recordMetric(name, value)." skeleton="panel" @retry="metrics.refetch()">
      <section v-if="numeric.length > 0" :class="['card']" data-testid="metric-charts">
        <h2 class="card-title flex-wrap">
          <span class="i-mingcute-chart-line-line" aria-hidden="true" />Numeric metrics
          <span class="text-xs muted font-normal">{{ numericView === 'time' ? 'in recording order' : `${runTable.rows.length} cases of every task` }}</span>
          <span :class="['ml-auto font-normal']"><SegmentedControl v-model="numericView" :items="numericViews" label="Numeric metrics view" /></span>
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
              n={{ metric.summary.count }} · min {{ metric.summary.min }} · avg {{ Math.round(metric.summary.avg * 1000) / 1000 }} · max {{ metric.summary.max }}
            </div>
          </div>
        </div>
        <div v-else-if="runMetrics.length < 2" :class="['p-3 text-sm muted']">
          Pairs need two numeric metrics that vary across cases.
        </div>
        <div v-else-if="numericView === 'matrix'" :class="['grid gap-1 p-3']">
          <div :class="['text-xs muted']">
            Every pair of the {{ Math.min(RUN_MATRIX_METRICS, runMetrics.length) }} metrics that best tell failed from passed cases · click a dot to open its case
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
          <span class="i-mingcute-list-check-line" aria-hidden="true" />Other metrics
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
                <span v-else :class="['mono muted shrink-0']">run</span>
                <span :class="['mono whitespace-pre-wrap break-all min-w-0']">{{ fullValue(entry.value) }}</span>
              </li>
            </ol>
          </li>
        </ul>
      </section>
      <section v-if="metrics.data.value && metrics.data.value.inference.requests > 0" :class="['card p-3 text-sm']">
        Inference: {{ metrics.data.value.inference.requests }} requests · {{ metrics.data.value.inference.responses }} responses · {{ metrics.data.value.inference.failed }} failed
        <span v-for="(value, key) in metrics.data.value.inference.totals" :key="key" class="ml-3 tabular-nums">{{ key }}={{ value }}</span>
      </section>
    </StateView>
  </div>
</template>
