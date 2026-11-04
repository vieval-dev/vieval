<script setup lang="ts">
import type { ComparisonResponse, RunListItem, RunSnapshot } from '../../../src/shared/contract'
import type { CompareAxis, Interval, PairedDelta } from '../comparison'
import type { Choice } from '../components/ChoiceMenu.vue'
import type { AxisPreviewRow } from '../components/CompareAxisPreview.vue'
import type { DeltaRow } from '../components/CompareDelta.vue'
import type { PlanePoint, ScaleKind } from '../components/ComparePlane.vue'
import type { Route } from '../router'

import { useQuery } from '@pinia/colada'
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import ChoiceMenu from '../components/ChoiceMenu.vue'
import CompareAxisPreview from '../components/CompareAxisPreview.vue'
import CompareDelta from '../components/CompareDelta.vue'
import ComparePlane from '../components/ComparePlane.vue'
import CompareScoreTable from '../components/CompareScoreTable.vue'
import ComparisonPreview from '../components/ComparisonPreview.vue'
import PageHeader from '../components/PageHeader.vue'
import ScoreCard from '../components/ScoreCard.vue'
import StateBadge from '../components/StateBadge.vue'
import StateView from '../components/StateView.vue'
import TimeAgo from '../components/TimeAgo.vue'

import { countedScores, countingDefinitions } from '../../../src/shared/reduce'
import { api } from '../api'
import { columnDefinitions } from '../caseMetrics'
import { canLogScale, columnIntervals, compareAxes, distinctLabels, formatAxisDelta, formatAxisValue, pairedDeltas, paretoFront, rowKey } from '../comparison'
import { useCatalog } from '../composables/useCatalog'
import { formatCount } from '../format'
import { levelIcons } from '../hierarchy'
import { attemptLabel, experimentLabel, formatAxisValues, runLabel, shortRunHash } from '../labels'
import { localize } from '../localize'
import { href } from '../router'
import { caseScoreText, gradersDiffer, graderText, headlineOf, scoreLabel } from '../scores'

/**
 * Comparisons: between experiments of a project, between attempts (runs) of an experiment, between chosen runs,
 * and between the matrix rows (tasks such as `model=…, repeat=…`) of one run.
 *
 * Without a `view`, lists every comparison the report roots allow.
 */
const props = defineProps<{ route: Extract<Route, { name: 'compare' }> }>()
const query = computed(() => props.route.query)
const catalog = useCatalog()
const { t } = useI18n()

const view = computed(() => query.value.view as 'attempts' | 'experiments' | 'matrix' | 'runs' | undefined)

/** What the runs can be compared by (the list without a `view`); only comparisons of two or more things. */
const comparable = computed(() => catalog.comparisons.value)
const nothingToCompare = computed(() => {
  const { acrossWorkspaces, attempts, experiments, matrixRuns } = comparable.value
  return acrossWorkspaces.length + attempts.length + experiments.length + matrixRuns.length === 0
})
/** Matrix axes of a run that have two or more values: what its matrix rows differ in. */
function varyingAxes(run: RunListItem): { axis: string, values: string }[] {
  return Object.entries({ ...run.matrix, ...run.evalMatrix }).filter(([, values]) => values.length > 1).map(([axis, values]) => ({ axis, values: formatAxisValues(values) }))
}
const listRow = 'flex items-center gap-3 rounded-md px-1.5 py-1 text-sm hover:bg-neutral-500/8'
const listHeading = 'flex items-center gap-2 mb-2 text-sm font-semibold'

/**
 * Matrix rows of one eval entry of a run as a {@link ComparisonResponse}: one column per task (matrix row such as
 * `model=…, repeat=…`), one row per case name. Only tasks of the same entry share cases, so each entry is compared
 * on its own. The rows compare the tasks' primary score when they share one (as the comparison endpoints do), else
 * the case state alone.
 */
function compareMatrixRows(snapshot: RunSnapshot, entryId: string | undefined): ComparisonResponse {
  const tasks = snapshot.tasks.filter(task => (task.entryId ?? task.id) === entryId)
  const columns = tasks.map(task => ({
    id: task.id,
    label: task.matrix == null ? task.displayName : Object.entries({ ...task.matrix.run, ...task.matrix.eval }).map(([key, value]) => `${key}=${value}`).join(', ') || task.displayName,
    runs: [{ attemptId: snapshot.identity.attemptId, counts: task.caseCounts, experimentId: snapshot.identity.experimentId, headline: headlineOf(task.scoring), project: task.projectId, runKey: snapshot.runKey, startedAt: task.startedAt, state: snapshot.state, workspaceId: snapshot.identity.workspaceId }],
    scoreGraders: task.scoreGraders,
  }))
  const primaries = new Set(tasks.map(task => task.scoring.primary))
  const primary = primaries.size === 1 ? [...primaries][0] : undefined
  const definitions = new Map(snapshot.scoreDefinitions.map(definition => [definition.name, definition]))
  const rows = new Map<string, ComparisonResponse['rows'][number]>()
  for (const task of tasks) {
    const taskDefinitions = countingDefinitions(task.scoring, definitions)
    for (const node of task.cases) {
      const row = rows.get(node.name) ?? { caseName: node.name, cells: {}, changed: false }
      const round = node.rounds.at(-1)
      // The snapshot carries no per-case metrics; the charts offer the scores and the duration.
      row.cells[task.id] = {
        counted: round == null ? {} : countedScores(round, taskDefinitions),
        ...(node.durationMs == null ? {} : { durationMs: node.durationMs }),
        metrics: {},
        roundCount: node.rounds.length,
        scores: node.scores,
        state: node.state,
      }
      rows.set(node.name, row)
    }
  }
  for (const row of rows.values()) {
    const cells = Object.values(row.cells)
    row.changed = cells.length !== columns.length || new Set(cells.map(cell => `${cell.state}:${primary == null ? '' : cell.scores.values[primary]}`)).size > 1
  }
  const list = [...rows.values()]
  return { columns, metricDefinitions: [], primary, rows: list, scoreDefinitions: snapshot.scoreDefinitions, summary: { changed: list.filter(row => row.changed).length, rows: list.length }, view: 'runs' }
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
/**
 * Readable name of each column: the experiment or the attempt; chosen runs by the levels that tell them apart (the
 * workspace when they come from several, else the experiment, else the attempt); matrix rows keep their label.
 */
const columnLabels = computed(() => {
  const columns = result.value?.columns ?? []
  const experimentText = (run: ComparisonResponse['columns'][number]['runs'][number]) =>
    experimentLabel(run.experimentId, catalog.matrixOf({ experiment: run.experimentId, project: run.project, workspace: run.workspaceId })).text
  const labels = view.value === 'runs'
    ? distinctLabels(columns.map((column) => {
        const run = column.runs[0]
        return run == null ? [column.label] : [run.workspaceId, run.project, experimentText(run), `${attemptLabel(run.attemptId)} · ${runLabel(run)}`]
      }))
    : columns.map((column) => {
        const run = column.runs[0]
        if (run == null || view.value === 'matrix')
          return column.label
        return view.value === 'experiments' ? experimentText(run) : attemptLabel(run.attemptId)
      })
  return new Map(columns.map((column, index) => [column.id, labels[index] ?? column.label]))
})
const columnLabel = (column: ComparisonResponse['columns'][number]) => columnLabels.value.get(column.id) ?? column.label
const resultError = computed(() => (view.value === 'matrix' ? matrixSnapshot.error.value : comparison.error.value))
const resultLoading = computed(() => (view.value === 'matrix' ? matrixSnapshot.isPending.value : comparison.isPending.value))
function reloadResult(): void {
  void (view.value === 'matrix' ? matrixSnapshot.refetch() : comparison.refetch())
}

const onlyChanged = shallowRef(false)
const search = shallowRef('')
const rows = computed(() => (result.value?.rows ?? []).filter(row => (!onlyChanged.value || row.changed) && `${row.caseName} ${row.variant ?? ''}`.toLowerCase().includes(search.value.toLowerCase())))

const scoreDefinitions = computed(() => result.value?.scoreDefinitions ?? [])
/** Label of the score the columns are compared by: the shared primary score, else the headline of passed cases. */
const primaryLabel = computed(() => (result.value?.primary == null ? t('compare.result.passedCases') : scoreLabel(result.value.primary, scoreDefinitions.value)))
const definitionMap = computed(() => columnDefinitions(result.value?.metricDefinitions ?? [], scoreDefinitions.value))
const formatValue = (value: number, axis: CompareAxis) => formatAxisValue(value, axis, definitionMap.value)
const formatDelta = (value: number, axis: CompareAxis) => formatAxisDelta(value, axis, definitionMap.value)
function columnHref(column: ComparisonResponse['columns'][number]) {
  const run = column.runs.at(-1)
  return run && view.value !== 'matrix' ? href({ name: 'run', runKey: run.runKey }) : undefined
}
/** A column whose newest run is still running: its means move as cases settle, and the charts say so. */
function isRunning(column: ComparisonResponse['columns'][number]): boolean {
  return column.runs.at(-1)?.state === 'running'
}

/** Scores, metrics, and the duration the charts can be read by (see {@link compareAxes}). */
const axes = computed(() => (result.value == null ? [] : compareAxes(result.value)))
const axisChoices = computed<Choice[]>(() => axes.value.map(axis => ({ group: t(`compare.chart.group.${axis.kind === 'score' ? 'scores' : 'metrics'}`), label: axis.label, value: axis.name })))
const pickedX = shallowRef<string>()
const pickedY = shallowRef<string>()
const pickedBaseline = shallowRef<string>()
/** Y defaults to the primary score (the first axis). */
const yAxis = computed(() => axes.value.find(axis => axis.name === pickedY.value) ?? axes.value[0])
/**
 * X defaults to a cost (a metric or the duration that is better lower), as harness benchmarks plot score against
 * cost, else to the next score.
 */
const xAxis = computed(() => axes.value.find(axis => axis.name === pickedX.value)
  ?? axes.value.find(axis => axis.kind !== 'score' && axis.better === 'lower')
  ?? axes.value.find(axis => axis !== yAxis.value)
  ?? yAxis.value)
/** Baseline defaults to the first column: the oldest attempt, or the first chosen run. */
const baseline = computed(() => result.value?.columns.find(column => column.id === pickedBaseline.value)?.id ?? result.value?.columns[0]?.id)
/**
 * Columns hidden from the charts (an outlier that squeezes the others onto one spot of the plane and the color scale).
 * The baseline is never hidden: every difference is read against it. The score cards and the cases table keep every
 * column.
 */
const hidden = shallowRef<ReadonlySet<string>>(new Set())
const hiddenColumns = computed(() => (result.value?.columns ?? []).filter(column => hidden.value.has(column.id) && column.id !== baseline.value))
function setHidden(id: string, hide: boolean): void {
  const next = new Set(hidden.value)
  if (hide)
    next.add(id)
  else
    next.delete(id)
  hidden.value = next
}
/**
 * The comparison the plane, the differences, and the axis previews draw: every column but the hidden ones. A column's
 * interval and its difference from the baseline do not depend on the other columns, so they are computed over every
 * column once; the score table keeps hidden columns as faded rows.
 */
const charted = computed(() => (result.value == null
  ? undefined
  : { ...result.value, columns: result.value.columns.filter(column => !hidden.value.has(column.id) || column.id === baseline.value) }))
const baselineChoices = computed<Choice[]>(() => (result.value?.columns ?? []).map(column => ({ label: columnLabel(column), value: column.id })))

/** Mean of every column on every axis, by axis name. */
const intervals = computed(() => new Map(axes.value.map(axis => [axis.name, result.value == null ? new Map<string, Interval>() : columnIntervals(result.value, axis)])))
/** Paired difference of every column from the baseline on every axis, by axis name. */
const deltas = computed(() => new Map(axes.value.map(axis => [axis.name, new Map<string, PairedDelta>(result.value == null || baseline.value == null
  ? []
  : pairedDeltas(result.value, axis, baseline.value).map(delta => [delta.columnId, delta]))])))

/**
 * Preview of an axis in the axis pickers: every column's mean on it with its difference from the baseline (shown
 * beside the menu, or in a drawer on phones), and how many columns differ from the baseline beyond noise on it (the
 * count at the end of the row). An axis that clears no column cannot tell the columns apart.
 */
function axisPreview(name: string): undefined | { clear: number, others: number, rows: AxisPreviewRow[] } {
  const means = intervals.value.get(name)
  if (means == null || means.size < 2)
    return undefined
  const deltaList = [...deltas.value.get(name)?.values() ?? []]
  return {
    clear: deltaList.filter(delta => delta.interval.low > 0 || delta.interval.high < 0).length,
    others: deltaList.length,
    rows: (charted.value?.columns ?? []).flatMap((column) => {
      const value = means.get(column.id)
      return value == null ? [] : [{ delta: deltas.value.get(name)?.get(column.id), id: column.id, isBaseline: column.id === baseline.value, label: columnLabel(column), value }]
    }),
  }
}
const axisOf = (name: string) => axes.value.find(axis => axis.name === name)

/**
 * Scale of each axis of the plane: linear, or log when every column mean on the axis is above 0. A log pick that no
 * longer fits its axis (another axis chosen) reads as linear.
 */
/** Whether the plane draws the 95% interval of each mean; without them its axes fit the means alone. */
const showWhiskers = shallowRef(true)
const pickedXScale = shallowRef<ScaleKind>('linear')
const pickedYScale = shallowRef<ScaleKind>('linear')
const logX = computed(() => xAxis.value != null && canLogScale(intervals.value.get(xAxis.value.name)?.values() ?? []))
const logY = computed(() => yAxis.value != null && canLogScale(intervals.value.get(yAxis.value.name)?.values() ?? []))
const scaleChoices = computed<Choice[]>(() => [
  { label: t('compare.chart.scale.linear'), value: 'linear' },
  { label: t('compare.chart.scale.log'), value: 'log' },
])
const xScaleKind = computed<ScaleKind>(() => (logX.value ? pickedXScale.value : 'linear'))
const yScaleKind = computed<ScaleKind>(() => (logY.value ? pickedYScale.value : 'linear'))

const planePoints = computed<PlanePoint[]>(() => {
  const x = xAxis.value
  const y = yAxis.value
  if (x == null || y == null)
    return []
  return (charted.value?.columns ?? []).flatMap((column) => {
    const xi = intervals.value.get(x.name)?.get(column.id)
    const yi = intervals.value.get(y.name)?.get(column.id)
    const delta = { x: deltas.value.get(x.name)?.get(column.id), y: deltas.value.get(y.name)?.get(column.id) }
    return xi == null || yi == null ? [] : [{ delta, href: columnHref(column), id: column.id, label: columnLabel(column), running: isRunning(column), x: xi, y: yi }]
  })
})
const front = computed(() => (xAxis.value == null || yAxis.value == null || xAxis.value === yAxis.value
  ? []
  : paretoFront(planePoints.value.map(point => ({ id: point.id, x: point.x.mean, y: point.y.mean })), xAxis.value, yAxis.value)))
/** Rows of the difference chart, best first by the y axis's direction. */
const deltaRows = computed<DeltaRow[]>(() => {
  const y = yAxis.value
  if (y == null)
    return []
  const sign = y.better === 'lower' ? 1 : -1
  return (result.value?.columns ?? []).flatMap((column) => {
    const delta = deltas.value.get(y.name)?.get(column.id)
    const value = intervals.value.get(y.name)?.get(column.id)
    return delta == null || value == null ? [] : [{ delta, hidden: hidden.value.has(column.id), href: columnHref(column), label: columnLabel(column), running: isRunning(column), value }]
  }).sort((left, right) => sign * (left.delta.interval.mean - right.delta.interval.mean))
})
/** The baseline's own row of the difference chart: its mean on the y axis. */
const deltaBaseline = computed(() => {
  const column = result.value?.columns.find(item => item.id === baseline.value)
  const value = yAxis.value == null || column == null ? undefined : intervals.value.get(yAxis.value.name)?.get(column.id)
  return column == null || value == null ? undefined : { href: columnHref(column), label: columnLabel(column), running: isRunning(column), value }
})
const caseLabels = computed(() => new Map((result.value?.rows ?? []).map(row => [rowKey(row), row.variant == null ? row.caseName : `${row.caseName} · ${row.variant}`])))
const tableColumns = computed(() => (result.value?.columns ?? []).map(column => ({ href: columnHref(column), id: column.id, label: columnLabel(column), running: isRunning(column) })))

/**
 * Graders of the primary score per column, when they differ in kind, model, or version: the values then do not
 * measure the same thing, so the comparison warns. Each column lists the graders its score records carried (a
 * record's own grader, for example a judge model set by a matrix axis, else the definition's), so the matrix view
 * warns about matrix rows judged by different models too.
 */
const graderWarning = computed(() => {
  const primary = result.value?.primary
  if (primary == null)
    return undefined
  const columns = (result.value?.columns ?? []).map(column => ({ graders: column.scoreGraders[primary] ?? [], label: columnLabel(column) }))
  const all = columns.flatMap(column => column.graders)
  if (!all.some(grader => gradersDiffer(grader, all[0])))
    return undefined
  return columns.filter(column => column.graders.length > 0).map(column => `${column.label}: ${column.graders.map(graderText).join(' / ')}`).join(' · ')
})

const title = computed(() => t(`compare.title.${view.value ?? 'list'}`))
const subtitle = computed(() => {
  if (view.value == null)
    return t('compare.list.subtitle')
  const columns = result.value?.columns.length ?? 0
  const cases = result.value?.summary.rows ?? 0
  return t('compare.result.subtitle', {
    cases: t('compare.result.subtitleCases', { n: formatCount(cases) }, cases),
    changed: formatCount(result.value?.summary.changed ?? 0),
    columns: t('compare.result.subtitleColumns', { n: formatCount(columns) }, columns),
  })
})
const position = computed(() => ({ experiment: query.value.experiment, project: query.value.project, runKey: query.value.run, workspace: query.value.workspace }))
</script>

<template>
  <PageHeader level="comparison" :position="position" :title="title" :subtitle="subtitle" />

  <template v-if="view == null">
    <StateView :error="catalog.query.error.value" :loading="catalog.query.isPending.value" :empty="nothingToCompare" :empty-text="t('compare.list.empty')" :empty-hint="t('compare.list.emptyHint')" skeleton="rows" @retry="catalog.query.refetch()">
      <section v-if="comparable.acrossWorkspaces.length > 0" :class="['mb-6']" data-testid="compare-across-workspaces">
        <h2 :class="[listHeading]">
          <span :class="[levelIcons.workspace, 'muted']" aria-hidden="true" />{{ t('compare.list.acrossWorkspaces') }}
          <span :class="['font-normal text-xs muted']">{{ t('compare.list.acrossWorkspacesHint') }}</span>
        </h2>
        <div :class="['grid gap-3']" style="grid-template-columns: repeat(auto-fill, minmax(min(560px, 100%), 1fr))">
          <ComparisonPreview v-for="group in comparable.acrossWorkspaces" :key="group.experimentId" :group="group" />
        </div>
      </section>

      <section v-if="comparable.experiments.length + comparable.attempts.length > 0" :class="['mb-6']" data-testid="compare-within-project">
        <h2 :class="[listHeading]">
          <span :class="[levelIcons.project, 'muted']" aria-hidden="true" />{{ t('compare.list.withinProject') }}
        </h2>
        <ul :class="['card p-1.5']">
          <li v-for="project in comparable.experiments" :key="`${project.workspace}/${project.id}`">
            <a :href="href({ name: 'compare', query: { project: project.id, view: 'experiments', workspace: project.workspace } })" :class="[listRow]">
              <span :class="[levelIcons.project, 'muted shrink-0']" aria-hidden="true" />
              <span :class="['truncate min-w-0']"><span class="muted">{{ project.workspace }} › </span>{{ project.id }}</span>
              <span :class="['ml-auto text-xs muted whitespace-nowrap']">{{ t('compare.list.compareExperiments', { n: project.experiments.length }, project.experiments.length) }}</span>
              <span class="i-mingcute-arrow-right-line muted shrink-0" aria-hidden="true" />
            </a>
          </li>
          <li v-for="experiment in comparable.attempts" :key="`${experiment.workspace}/${experiment.project}/${experiment.id}`">
            <a :href="href({ name: 'compare', query: { experiment: experiment.id, project: experiment.project, view: 'attempts', workspace: experiment.workspace } })" :class="[listRow]">
              <span :class="[levelIcons.experiment, 'muted shrink-0']" aria-hidden="true" />
              <span :class="['truncate min-w-0']"><span class="muted">{{ experiment.workspace }} › </span>{{ experiment.id }}</span>
              <span :class="['ml-auto text-xs muted whitespace-nowrap']">{{ t('compare.list.compareAttempts', { n: experiment.attempts.length }, experiment.attempts.length) }}</span>
              <span class="i-mingcute-arrow-right-line muted shrink-0" aria-hidden="true" />
            </a>
          </li>
        </ul>
      </section>

      <section v-if="comparable.matrixRuns.length > 0" data-testid="compare-matrix-runs">
        <h2 :class="[listHeading]">
          <span class="i-mingcute-layout-grid-line muted" aria-hidden="true" />{{ t('compare.list.matrixRuns') }}
          <span :class="['font-normal text-xs muted']">{{ t('compare.list.matrixRunsHint') }}</span>
        </h2>
        <ul :class="['card p-1.5']">
          <li v-for="run in comparable.matrixRuns.slice(0, 30)" :key="run.runKey">
            <a :href="href({ name: 'compare', query: { run: run.runKey, view: 'matrix' } })" :class="[listRow, 'flex-wrap gap-y-1']">
              <StateBadge :state="run.state" icon-only />
              <span :class="['truncate min-w-0']"><span class="muted">{{ run.workspaceId }} › </span>{{ run.experimentId }}</span>
              <!-- A long axis (a dozen models) is cut to the row; its full values are in the title. -->
              <span v-for="axis in varyingAxes(run)" :key="axis.axis" :class="['inline-flex items-center gap-1 text-xs min-w-0 max-w-[28rem]']" :title="`${axis.axis}: ${axis.values}`">
                <span class="muted shrink-0">{{ axis.axis }}</span><span :class="['truncate']">{{ axis.values }}</span>
              </span>
              <span :class="['ml-auto text-xs muted whitespace-nowrap']"><TimeAgo :time="run.startedAt" relative-only /> · {{ shortRunHash(run.runKey) }}</span>
              <span class="i-mingcute-arrow-right-line muted shrink-0" aria-hidden="true" />
            </a>
          </li>
        </ul>
      </section>
    </StateView>
  </template>

  <StateView v-else :error="resultError" :loading="resultLoading" :empty="result?.columns.length === 0" :empty-text="t('compare.result.empty')" :empty-hint="t('compare.result.emptyHint')" skeleton="panel" @retry="reloadResult">
    <div v-if="view === 'matrix'" :class="['flex items-center gap-2 mb-3 text-sm flex-wrap']">
      <span class="muted">{{ t('compare.result.entry') }}</span>
      <a
        v-for="item in entries" :key="item.id"
        :href="href({ name: 'compare', query: { ...query, entry: item.id } })"
        :class="['btn text-xs py-0.5', item.id === entry && 'btn-active']"
      >{{ t('compare.result.entryRows', { entry: item.id.split('/').at(-1), n: item.count }, item.count) }}</a>
    </div>
    <!-- No row gap: each card spans two subgrid rows (panel, tray) and carries its own bottom margin. -->
    <section :class="['grid gap-x-3 mb-1']" :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(min(240px, 100%), 1fr))` }">
      <ScoreCard
        v-for="column in result?.columns"
        :key="column.id"
        :href="column.runs.at(-1) && view !== 'matrix' ? href({ name: 'run', runKey: column.runs.at(-1)!.runKey }) : undefined"
        :headline="column.runs.at(-1)?.headline"
        :definitions="scoreDefinitions"
        :state="column.runs.at(-1)?.state"
        :counts="column.runs.at(-1)?.counts"
        :title="columnLabel(column)"
        subgrid :class="['mb-3']"
      >
        <template v-for="run in column.runs.slice(-1)" :key="run.runKey">
          <span v-if="view !== 'matrix'" :title="run.runKey">{{ runLabel(run) }}</span>
        </template>
        <span v-if="column.runs.length > 1">{{ t('compare.result.newestOf', { n: column.runs.length }) }}</span>
      </ScoreCard>
    </section>

    <div v-if="graderWarning" role="status" :class="['flex items-start gap-2 mb-4 rounded px-3 py-2 text-sm state-interrupted']" data-testid="compare-grader-warning">
      <span class="i-mingcute-warning-line mt-0.5 shrink-0" aria-hidden="true" />
      <span>{{ t('compare.result.graderWarning', { score: primaryLabel }) }} <span :class="['mono text-xs']">{{ graderWarning }}</span></span>
    </div>

    <template v-if="(result?.columns.length ?? 0) > 1 && xAxis && yAxis">
      <!-- One row of controls above the charts: they all read the same axes and baseline. -->
      <div :class="['flex items-center gap-2 mb-3 flex-wrap']">
        <ChoiceMenu
          v-for="picker in [{ axis: yAxis, label: t('compare.chart.y'), pick: (value: string) => pickedY = value, testId: 'compare-y' }, { axis: xAxis, label: t('compare.chart.x'), pick: (value: string) => pickedX = value, testId: 'compare-x' }]" :key="picker.testId"
          :model-value="picker.axis.name" :choices="axisChoices" :label="picker.label" :test-id="picker.testId" @update:model-value="picker.pick"
        >
          <template #suffix="{ choice }">
            <span v-if="axisPreview(choice.value)" :title="t('compare.chart.clearHint', { n: axisPreview(choice.value)!.clear, total: axisPreview(choice.value)!.others })">{{ axisPreview(choice.value)!.clear }}/{{ axisPreview(choice.value)!.others }}</span>
          </template>
          <template #details="{ value }">
            <CompareAxisPreview
              v-if="axisPreview(value) && axisOf(value)"
              :axis="axisOf(value)!" :rows="axisPreview(value)!.rows" :description="localize(definitionMap.get(value)?.description)"
              :format-value="number => formatValue(number, axisOf(value)!)" :format-delta="number => formatDelta(number, axisOf(value)!)"
            />
          </template>
        </ChoiceMenu>
        <ChoiceMenu v-if="baseline" :model-value="baseline" :choices="baselineChoices" :label="t('compare.chart.baseline')" test-id="compare-baseline" @update:model-value="value => pickedBaseline = value" />
        <!--
          Columns hidden from the charts, each one click away from coming back. They share the controls' row (pushed to
          its end) instead of a row of their own, so hiding or showing a column never moves the charts below.
        -->
        <span v-if="hiddenColumns.length > 0" :class="['ml-auto flex items-center gap-1.5 flex-wrap text-xs']" data-testid="compare-hidden">
          <span class="muted">{{ t('compare.chart.hidden') }}</span>
          <button
            v-for="column in hiddenColumns" :key="column.id" type="button" :class="['btn text-xs! py-0.5! px-2! bg-neutral-500/10']"
            :title="t('compare.chart.show', { column: columnLabel(column) })" @click="setHidden(column.id, false)"
          >
            <span class="i-mingcute-eye-line" aria-hidden="true" />{{ columnLabel(column) }}
          </button>
        </span>
      </div>

      <!--
        Wide screens put the charts side by side instead of stretching each one across the page: two columns from
        2000 px, three from 3400 px. Cards of a row stretch to one height (the grid's default), and the pairs are picked
        by height so little of a card stays empty: the plane beside the score table (both about 450 px), the short and
        wide differences on a row of their own; with three columns all three share a row. The cases table below stays
        full width: its case names and one column per compared run need the room.
      -->
      <div :class="['grid gap-x-4', 'min-[2000px]:grid-cols-2 min-[3400px]:grid-cols-3']" data-testid="compare-charts">
        <section :class="['card mb-4 min-w-0']">
          <h2 class="card-title">
            <span class="i-mingcute-dot-grid-line" aria-hidden="true" />{{ t('compare.chart.planeTitle') }}
            <!-- The chart's own options sit in its title bar, apart from the axes and baseline that every chart reads. -->
            <span :class="['ml-auto flex items-center gap-1 -my-1']" data-testid="compare-plane-toolbar">
              <ChoiceMenu v-if="logY" size="sm" :model-value="yScaleKind" :choices="scaleChoices" :label="t('compare.chart.scale.y')" test-id="compare-scale-y" @update:model-value="value => pickedYScale = value as ScaleKind" />
              <ChoiceMenu v-if="logX" size="sm" :model-value="xScaleKind" :choices="scaleChoices" :label="t('compare.chart.scale.x')" test-id="compare-scale-x" @update:model-value="value => pickedXScale = value as ScaleKind" />
              <button
                type="button" :class="['option-trigger gap-1! rounded-md! px-2! py-0.5! text-xs! font-normal']" :aria-pressed="showWhiskers"
                data-testid="compare-whiskers" @click="showWhiskers = !showWhiskers"
              >
                <span :class="[showWhiskers ? 'i-mingcute-check-line' : 'i-mingcute-close-line', 'muted']" aria-hidden="true" />{{ t('compare.chart.whiskers') }}
              </button>
            </span>
          </h2>
          <div class="p-3">
            <ComparePlane
              :points="planePoints" :x="xAxis" :y="yAxis" :x-scale-kind="xScaleKind" :y-scale-kind="yScaleKind" :whiskers="showWhiskers" :front="front" :baseline="baseline" :baseline-label="deltaBaseline?.label"
              :format-x="value => formatValue(value, xAxis!)" :format-y="value => formatValue(value, yAxis!)"
              :format-delta-x="value => formatDelta(value, xAxis!)" :format-delta-y="value => formatDelta(value, yAxis!)"
              @baseline="id => pickedBaseline = id" @hide="id => setHidden(id, true)"
            />
            <p :class="['mt-1 text-xs muted']">
              {{ [showWhiskers && t('compare.chart.planeNote.whiskers'), t('compare.chart.planeNote.hover'), front.length > 0 && t('compare.chart.planeNote.front')].filter(Boolean).join(' ') }}
            </p>
          </div>
        </section>

        <section v-if="axes.length > 2" :class="['card mb-4 min-w-0 flex flex-col']">
          <h2 class="card-title">
            <span class="i-mingcute-table-2-line" aria-hidden="true" />{{ t('compare.chart.tableTitle') }}
          </h2>
          <div :class="['p-2 flex-1 min-h-0']">
            <CompareScoreTable
              :sort-by="yAxis.name" :axes="axes" :columns="tableColumns" :hidden="hidden" :baseline="baseline" :intervals="intervals" :deltas="deltas"
              :format-value="formatValue" :format-delta="formatDelta"
              @update:sort-by="value => pickedY = value" @hide="(id, hide) => setHidden(id, hide)"
            />
          </div>
        </section>

        <section v-if="deltaRows.length > 0 && deltaBaseline" :class="['card mb-4 min-w-0', 'min-[2000px]:col-span-2 min-[3400px]:col-span-1']">
          <h2 class="card-title">
            <span class="i-mingcute-git-compare-line" aria-hidden="true" />{{ t('compare.chart.deltaTitle', { axis: yAxis.label, baseline: baselineChoices.find(choice => choice.value === baseline)?.label ?? '' }) }}
          </h2>
          <div class="p-3">
            <CompareDelta :rows="deltaRows" :baseline="deltaBaseline" :axis="yAxis" :case-labels="caseLabels" :format-delta="value => formatDelta(value, yAxis!)" :format-value="value => formatValue(value, yAxis!)" />
            <p :class="['mt-1 text-xs muted']">
              {{ t('compare.chart.deltaNote') }}
            </p>
          </div>
        </section>
      </div>
    </template>

    <section :class="['card']">
      <h2 :class="['card-title flex-wrap']">
        <span class="i-mingcute-table-line" aria-hidden="true" />{{ t('compare.result.cases') }}
        <label :class="['ml-auto flex items-center gap-1 text-xs font-normal']"><input v-model="onlyChanged" type="checkbox"> {{ t('compare.result.onlyDiffering') }}</label>
        <input v-model="search" type="search" :placeholder="t('compare.result.filterPlaceholder')" :class="['rounded border border-neutral-300/60 dark:border-neutral-700/40 bg-transparent px-2 py-0.5 text-xs font-normal w-48', 'max-md:(w-full py-1)']">
      </h2>
      <StateView :empty="rows.length === 0" :empty-text="t('compare.result.filterEmpty')">
        <div :class="['overflow-auto max-h-[70vh]']">
          <table :class="['w-full']">
            <thead :class="['sticky top-0 bg-white dark:bg-neutral-900 z-1']">
              <tr :class="['border-b border-neutral-200/50 dark:border-neutral-800/50']">
                <th class="th">
                  {{ t('compare.result.case') }} <span :class="['font-normal muted']">· {{ primaryLabel }}</span><span v-if="graderWarning" class="i-mingcute-warning-line text-amber-600 ml-1 align-[-0.15em]" :title="t('compare.result.gradersDiffer', { graders: graderWarning })" data-testid="compare-grader-warning-icon" />
                </th>
                <th v-for="column in result?.columns" :key="column.id" :class="['th text-xs max-w-40 truncate']" :title="column.label">
                  {{ columnLabel(column) }}
                </th>
              </tr>
            </thead>
            <tbody>
              <!-- A differing row is marked by its icon only: with several columns nearly every case differs somewhere, and a tint
                   on every row (it previously had one) pointed at nothing. "Only differing" narrows the list instead. -->
              <tr v-for="row in rows" :key="rowKey(row)" :class="['border-b border-neutral-100/70 dark:border-neutral-900']">
                <td :class="['td mono text-xs break-all max-md:min-w-40']">
                  <span v-if="row.changed" class="i-mingcute-git-compare-line text-amber-600 mr-1" :title="t('compare.result.differs')" />{{ row.caseName }}<span v-if="row.variant" :class="['ml-1.5 font-sans muted']">{{ row.variant }}</span>
                </td>
                <td v-for="column in result?.columns" :key="column.id" class="td">
                  <span v-if="row.cells[column.id]" :class="['inline-flex items-center gap-1']">
                    <StateBadge :state="row.cells[column.id]!.state" icon-only />
                    <span v-if="result?.primary" class="text-xs mono">{{ caseScoreText(row.cells[column.id]!.scores, result.primary) }}</span>
                    <span v-if="row.cells[column.id]!.roundCount > 1" class="text-xs muted">×{{ row.cells[column.id]!.roundCount }}</span>
                    <span v-if="row.cells[column.id]!.pooled" class="text-xs muted" :title="t('compare.result.pooledHint')">{{ t('compare.result.pooled', { n: row.cells[column.id]!.pooled }) }}</span>
                  </span>
                  <span v-else class="text-xs muted">{{ t('compare.result.notRun') }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </StateView>
    </section>
  </StateView>
</template>
