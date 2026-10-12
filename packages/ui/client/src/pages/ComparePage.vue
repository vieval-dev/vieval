<script setup lang="ts">
import type { ComparisonResponse, RunSnapshot } from '../../../src/shared/contract'
import type { BarDatum } from '../components/BarChart.vue'
import type { Route } from '../router'

import { useQuery } from '@pinia/colada'
import { computed, shallowRef } from 'vue'

import BarChart from '../components/BarChart.vue'
import ExperimentName from '../components/ExperimentName.vue'
import IdLabel from '../components/IdLabel.vue'
import PageHeader from '../components/PageHeader.vue'
import ScoreCard from '../components/ScoreCard.vue'
import StateBadge from '../components/StateBadge.vue'
import StateView from '../components/StateView.vue'

import { api } from '../api'
import { useCatalog } from '../composables/useCatalog'
import { formatScore } from '../format'
import { levelIcons } from '../hierarchy'
import { attemptLabel, experimentLabel, runLabel } from '../labels'
import { href } from '../router'

/**
 * Comparisons: between experiments of a project, between attempts (runs) of an experiment, between chosen runs,
 * and between the matrix rows (tasks such as `model=…, repeat=…`) of one run.
 *
 * Without a `view`, lists every comparison the report roots allow.
 */
const props = defineProps<{ route: Extract<Route, { name: 'compare' }> }>()
const query = computed(() => props.route.query)
const catalog = useCatalog()

const view = computed(() => query.value.view as 'attempts' | 'experiments' | 'matrix' | 'runs' | undefined)

/** Readable name of a column: the experiment, the attempt, or both (chosen runs); matrix rows keep their label. */
function columnLabel(column: ComparisonResponse['columns'][number]): string {
  const run = column.runs[0]
  if (run == null || view.value === 'matrix')
    return column.label
  const experiment = experimentLabel(run.experimentId, catalog.matrixOf({ experiment: run.experimentId, project: query.value.project, workspace: query.value.workspace })).text
  if (view.value === 'experiments')
    return experiment
  if (view.value === 'attempts')
    return attemptLabel(run.attemptId)
  return `${experiment} · ${attemptLabel(run.attemptId)}`
}

// The list of comparisons (no `view`) needs the hierarchy; the runs come from the shared catalog.
const tree = useQuery({ enabled: () => view.value == null, key: ['tree'], query: () => api.tree() })
/** Runs with more than one task: their matrix rows can be compared. */
const matrixRuns = computed(() => catalog.runs.value.filter(run => run.counts.total > 0).slice(0, 50))

/**
 * Matrix rows of one eval entry of a run as a {@link ComparisonResponse}: one column per task (matrix row such as
 * `model=…, repeat=…`), one row per case name. Only tasks of the same entry share cases, so each entry is compared
 * on its own.
 */
function compareMatrixRows(snapshot: RunSnapshot, entryId: string | undefined): ComparisonResponse {
  const tasks = snapshot.tasks.filter(task => (task.entryId ?? task.id) === entryId)
  const columns = tasks.map(task => ({
    id: task.id,
    label: task.matrix == null ? task.displayName : Object.entries({ ...task.matrix.run, ...task.matrix.eval }).map(([key, value]) => `${key}=${value}`).join(', ') || task.displayName,
    runs: [{ attemptId: snapshot.identity.attemptId, counts: task.caseCounts, exactAverage: task.scores.exact, experimentId: snapshot.identity.experimentId, hybridAverage: task.scores.hybrid, judgeAverage: task.scores.judge, runKey: snapshot.runKey, startedAt: task.startedAt, state: snapshot.state }],
  }))
  const rows = new Map<string, ComparisonResponse['rows'][number]>()
  for (const task of tasks) {
    for (const node of task.cases) {
      const row = rows.get(node.name) ?? { caseName: node.name, cells: {}, changed: false }
      row.cells[task.id] = { exact: node.scores.exact, judge: node.scores.judge, roundCount: node.rounds.length, state: node.state }
      rows.set(node.name, row)
    }
  }
  for (const row of rows.values()) {
    const cells = Object.values(row.cells)
    row.changed = cells.length !== columns.length || new Set(cells.map(cell => `${cell.state}:${cell.exact}`)).size > 1
  }
  const list = [...rows.values()]
  return { columns, rows: list, summary: { changed: list.filter(row => row.changed).length, rows: list.length }, view: 'runs' }
}

// Same entry as the run page's snapshot (`useRunLive`): a run opened there compares at once.
const matrixSnapshot = useQuery({
  enabled: () => view.value === 'matrix' && query.value.run != null,
  key: () => ['runs', query.value.run ?? '', 'snapshot'],
  query: () => api.snapshot(query.value.run!),
})
/** Eval entries of the run with their task and case counts; the entry with the most matrix rows (then cases) is the default. */
const entries = computed(() => {
  const counts = new Map<string, { cases: number, count: number }>()
  for (const task of matrixSnapshot.data.value?.tasks ?? []) {
    const id = task.entryId ?? task.id
    const current = counts.get(id) ?? { cases: 0, count: 0 }
    counts.set(id, { cases: current.cases + task.cases.length, count: current.count + 1 })
  }
  return [...counts.entries()].map(([id, value]) => ({ id, ...value }))
})
const entry = computed(() => query.value.entry ?? entries.value.toSorted((a, b) => b.count - a.count || b.cases - a.cases)[0]?.id)

const comparison = useQuery({
  enabled: () => view.value != null && view.value !== 'matrix',
  // Only the set parameters: a query key holds JSON values, and an unset one must not change the key.
  key: () => ['compare', Object.fromEntries(Object.entries(query.value).filter(([, value]) => value != null)) as Record<string, string>],
  query: () => api.compare(view.value as 'attempts' | 'experiments' | 'runs', query.value),
})
const result = computed(() => (view.value === 'matrix'
  ? (matrixSnapshot.data.value == null ? undefined : compareMatrixRows(matrixSnapshot.data.value, entry.value))
  : comparison.data.value))
const resultError = computed(() => (view.value === 'matrix' ? matrixSnapshot.error.value : comparison.error.value))
const resultLoading = computed(() => (view.value === 'matrix' ? matrixSnapshot.isPending.value : comparison.isPending.value))
function reloadResult(): void {
  void (view.value === 'matrix' ? matrixSnapshot.refetch() : comparison.refetch())
}

const onlyChanged = shallowRef(false)
const search = shallowRef('')
const rows = computed(() => (result.value?.rows ?? []).filter(row => (!onlyChanged.value || row.changed) && row.caseName.toLowerCase().includes(search.value.toLowerCase())))

const chart = computed<BarDatum[]>(() => (result.value?.columns ?? []).map((column) => {
  const run = column.runs.at(-1)
  const passRate = run == null || run.counts.total === 0 ? null : run.counts.passed / run.counts.total
  return { href: run && view.value !== 'matrix' ? href({ name: 'run', runKey: run.runKey }) : undefined, label: columnLabel(column), values: [run?.exactAverage ?? null, passRate] }
}))

const title = computed(() => ({ attempts: 'Attempts of an experiment', experiments: 'Experiments of a project', matrix: 'Matrix rows of a run', runs: 'Chosen runs' } as Record<string, string>)[view.value ?? ''] ?? 'Comparisons')
const position = computed(() => ({ experiment: query.value.experiment, project: query.value.project, runKey: query.value.run, workspace: query.value.workspace }))
</script>

<template>
  <PageHeader level="comparison" :position="position" :title="title" :subtitle="view == null ? 'Pick what to compare' : `${result?.columns.length ?? 0} columns · ${result?.summary.rows ?? 0} cases · ${result?.summary.changed ?? 0} differ`" />

  <template v-if="view == null">
    <StateView :error="tree.error.value ?? catalog.query.error.value" :loading="tree.isPending.value" :empty="tree.data.value?.workspaces.length === 0" empty-text="No runs to compare" skeleton="rows" @retry="tree.refetch()">
      <section v-for="workspace in tree.data.value?.workspaces" :key="workspace.id" :class="['card mb-4']">
        <h2 class="card-title">
          <span :class="levelIcons.workspace" aria-hidden="true" />{{ workspace.id }}
        </h2>
        <div v-for="project in workspace.projects" :key="project.id" :class="['px-3 py-2 border-b last:border-b-0 border-neutral-100/70 dark:border-neutral-900']">
          <div :class="['flex items-center flex-wrap gap-2 mb-1']">
            <span :class="[levelIcons.project, 'muted']" aria-hidden="true" /><span class="font-medium">{{ project.id }}</span>
            <a :class="['btn text-xs ml-auto']" :href="href({ name: 'compare', query: { project: project.id, view: 'experiments', workspace: workspace.id } })">
              <span :class="levelIcons.experiment" aria-hidden="true" />Compare {{ project.experiments.length }} experiments
            </a>
          </div>
          <ul :class="['pl-6 max-md:pl-2 text-sm']">
            <li v-for="experiment in project.experiments" :key="experiment.id" :class="['flex items-center flex-wrap gap-x-2 py-0.5 max-md:py-1']">
              <ExperimentName :experiment-id="experiment.id" :matrix="catalog.matrixOf({ experiment: experiment.id, project: project.id, workspace: workspace.id })" />
              <a :class="['link text-xs ml-auto whitespace-nowrap']" :href="href({ name: 'compare', query: { experiment: experiment.id, project: project.id, view: 'attempts', workspace: workspace.id } })">compare {{ experiment.attempts.length }} attempts<span class="i-mingcute-arrow-right-line ml-0.5 align-[-0.15em]" aria-hidden="true" /></a>
            </li>
          </ul>
        </div>
      </section>
      <section :class="['card']">
        <h2 class="card-title">
          <span class="i-mingcute-layout-grid-line" aria-hidden="true" />Matrix rows inside one run
        </h2>
        <ul :class="['p-3 text-sm']">
          <li v-for="run in matrixRuns" :key="run.runKey" :class="['flex items-center gap-2 py-0.5']">
            <StateBadge :state="run.state" icon-only />
            <IdLabel :id="run.runKey" :label="runLabel(run)" :href="href({ name: 'compare', query: { run: run.runKey, view: 'matrix' } })" />
            <span class="text-xs muted truncate">{{ experimentLabel(run.experimentId, run.matrix).text }}</span>
          </li>
        </ul>
      </section>
    </StateView>
  </template>

  <StateView v-else :error="resultError" :loading="resultLoading" :empty="result?.columns.length === 0" empty-text="Nothing to compare" empty-hint="This level has no runs with cases yet." skeleton="panel" @retry="reloadResult">
    <div v-if="view === 'matrix'" :class="['flex items-center gap-2 mb-3 text-sm flex-wrap']">
      <span class="muted">Eval entry</span>
      <a
        v-for="item in entries" :key="item.id"
        :href="href({ name: 'compare', query: { ...query, entry: item.id } })"
        :class="['btn text-xs py-0.5', item.id === entry && 'btn-active']"
      >{{ item.id.split('/').at(-1) }} · {{ item.count }} rows</a>
    </div>
    <section :class="['grid gap-3 mb-4']" :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(min(240px, 100%), 1fr))` }">
      <ScoreCard
        v-for="column in result?.columns"
        :key="column.id"
        :href="column.runs.at(-1) && view !== 'matrix' ? href({ name: 'run', runKey: column.runs.at(-1)!.runKey }) : undefined"
        :score="column.runs.at(-1)?.exactAverage"
        :state="column.runs.at(-1)?.state"
        :counts="column.runs.at(-1)?.counts"
        :title="columnLabel(column)"
      >
        <template v-for="run in column.runs.slice(-1)" :key="run.runKey">
          <span v-if="view !== 'matrix'" :title="run.runKey">{{ runLabel(run) }}</span>
        </template>
        <span v-if="column.runs.length > 1">newest of {{ column.runs.length }} runs</span>
      </ScoreCard>
    </section>

    <section :class="['card mb-4']">
      <h2 class="card-title">
        <span class="i-mingcute-chart-horizontal-line" aria-hidden="true" />Exact score and pass rate per column
      </h2>
      <div class="p-3">
        <BarChart :data="chart" :series="['exact score', 'pass rate']" />
      </div>
    </section>

    <section :class="['card']">
      <h2 :class="['card-title flex-wrap']">
        <span class="i-mingcute-table-line" aria-hidden="true" />Cases
        <label :class="['ml-auto flex items-center gap-1 text-xs font-normal']"><input v-model="onlyChanged" type="checkbox"> only differing</label>
        <input v-model="search" type="search" placeholder="Filter cases…" :class="['rounded border border-neutral-300/60 dark:border-neutral-700/40 bg-transparent px-2 py-0.5 text-xs font-normal w-48', 'max-md:(w-full py-1)']">
      </h2>
      <StateView :empty="rows.length === 0" empty-text="No case matches the filter">
        <div :class="['overflow-auto max-h-[70vh]']">
          <table :class="['w-full']">
            <thead :class="['sticky top-0 bg-white dark:bg-neutral-900 z-1']">
              <tr :class="['border-b border-neutral-200/50 dark:border-neutral-800/50']">
                <th class="th">
                  Case
                </th>
                <th v-for="column in result?.columns" :key="column.id" :class="['th text-xs max-w-40 truncate']" :title="column.label">
                  {{ columnLabel(column) }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.caseName" :class="['border-b border-neutral-100/70 dark:border-neutral-900', row.changed && 'bg-amber-50/60 dark:bg-amber-950/30']">
                <td :class="['td mono text-xs break-all max-md:min-w-40']">
                  <span v-if="row.changed" class="i-mingcute-git-compare-line text-amber-600 mr-1" title="Differs between columns" />{{ row.caseName }}
                </td>
                <td v-for="column in result?.columns" :key="column.id" class="td">
                  <span v-if="row.cells[column.id]" :class="['inline-flex items-center gap-1']">
                    <StateBadge :state="row.cells[column.id]!.state" icon-only />
                    <span class="text-xs mono">{{ formatScore(row.cells[column.id]!.exact) }}</span>
                    <span v-if="row.cells[column.id]!.roundCount > 1" class="text-xs muted">×{{ row.cells[column.id]!.roundCount }}</span>
                  </span>
                  <span v-else class="text-xs muted">not run</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </StateView>
    </section>
  </StateView>
</template>
