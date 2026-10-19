<script setup lang="ts">
import type { ViewTab } from '../components/ViewTabs.vue'
import type { Route } from '../router'

import { computed, nextTick, shallowRef, watch } from 'vue'

import CountsBar from '../components/CountsBar.vue'
import ExperimentName from '../components/ExperimentName.vue'
import IdLabel from '../components/IdLabel.vue'
import IdMenu from '../components/IdMenu.vue'
import MatrixView from '../components/MatrixView.vue'
import PageHeader from '../components/PageHeader.vue'
import Sparkline from '../components/Sparkline.vue'
import StateBadge from '../components/StateBadge.vue'
import StateView from '../components/StateView.vue'
import TimeAgo from '../components/TimeAgo.vue'
import ViewTabs from '../components/ViewTabs.vue'

import { useCatalog } from '../composables/useCatalog'
import { formatDuration, formatScore } from '../format'
import { levelIcons } from '../hierarchy'
import { attemptDate, attemptLabel, differingAxes, experimentLabel, formatAxisValues, mergeMatrices, shortRunHash } from '../labels'
import { href, navigate } from '../router'

/**
 * One experiment: its attempts newest first as list rows (one per run: state, duration, cases, score) and the matrix
 * of its runs.
 *
 * With `attempt`, that attempt is highlighted and scrolled into view (the attempt level has no page of its own).
 */
const props = defineProps<{ attempt?: string, experiment: string, project: string, tab?: string, workspace: string }>()

type Tab = 'attempts' | 'matrix'
const tabs: ViewTab<Tab>[] = [
  { icon: levelIcons.attempt, label: 'Attempts', value: 'attempts' },
  { icon: 'i-mingcute-layout-grid-line', label: 'Matrix', value: 'matrix' },
]
const tabRoute = (value: Tab): Route => ({ experiment: props.experiment, name: 'scope', project: props.project, tab: value === 'attempts' ? undefined : value, workspace: props.workspace })
const tab = computed<Tab>({
  get: () => tabs.find(item => item.value === props.tab)?.value ?? 'attempts',
  set: value => navigate(tabRoute(value)),
})

const catalog = useCatalog()
const scope = computed(() => ({ experiment: props.experiment, project: props.project, workspace: props.workspace }))
const runs = computed(() => catalog.runsIn(scope.value))
const matrix = computed(() => mergeMatrices(runs.value.map(run => run.matrix)))
const title = computed(() => experimentLabel(props.experiment, matrix.value).text)
const trend = computed(() => runs.value.map(run => run.exactAverage).toReversed())

/** Attempts newest first, each with its runs (one per attempt unless a run was repeated under the same label). */
const attempts = computed(() => {
  const byAttempt = new Map<string, typeof runs.value>()
  for (const run of runs.value) {
    const list = byAttempt.get(run.attemptId)
    if (list == null)
      byAttempt.set(run.attemptId, [run])
    else
      list.push(run)
  }
  return [...byAttempt.entries()].map(([id, list]) => ({ date: attemptDate(id), id, label: attemptLabel(id), runs: list }))
})

/** Run and eval axes of a run in one record; what an attempt ran with. */
const axesOf = (run: (typeof runs.value)[number]) => ({ ...run.matrix, ...run.evalMatrix })
/** Axes whose values differ between the runs of this experiment: each run row names its values of them. */
const changedAxes = computed(() => differingAxes(runs.value.map(axesOf)))
/** Expected cases of a run in the case bar, so cases an interrupted or partial run never ran show as "not run". */
const expectedCounts = (run: (typeof runs.value)[number]) => ({ ...run.counts, total: Math.max(run.counts.total, run.caseTotal ?? 0) })
/** A finished run that settled fewer cases than it was expected to: interrupted, or a re-run of some cases. */
const isPartial = (run: (typeof runs.value)[number]) => run.state !== 'running' && run.caseTotal != null && run.counts.total < run.caseTotal

/**
 * Grid of a run row. Wide screens: one line with select, attempt, run, duration, cases, exact score, menu (the header
 * uses the same columns). Narrow screens: select, attempt, exact score, and menu on the first line, the run and its
 * duration below the attempt, then the cases.
 */
const rowGrid = [
  'grid items-center gap-x-3 gap-y-1.5 grid-cols-[1rem_minmax(0,1fr)_auto_1.75rem]',
  'md:(gap-x-4 grid-cols-[1rem_minmax(14rem,1.6fr)_minmax(9rem,1fr)_5rem_minmax(12rem,2fr)_4rem_1.75rem])',
]
const selected = shallowRef<string[]>([])
function duration(run: { endedAt?: string, startedAt?: string }): number | undefined {
  return run.startedAt == null || run.endedAt == null ? undefined : Date.parse(run.endedAt) - Date.parse(run.startedAt)
}
function toggle(runKey: string): void {
  selected.value = selected.value.includes(runKey) ? selected.value.filter(key => key !== runKey) : [...selected.value, runKey]
}

// The attempt of the address is highlighted; bring it into view once the list rendered.
watch([() => props.attempt, () => attempts.value.length], async ([attempt]) => {
  if (attempt == null)
    return
  await nextTick()
  document.querySelector(`[data-attempt="${CSS.escape(attempt)}"]`)?.scrollIntoView({ block: 'center' })
}, { immediate: true })
</script>

<template>
  <PageHeader :id="props.experiment" :loading="catalog.query.isPending.value" level="experiment" :position="{ attempt: props.attempt, experiment: props.experiment, project: props.project, workspace: props.workspace }" :title="title">
    <template #title>
      <ExperimentName :experiment-id="props.experiment" :matrix="matrix" />
    </template>
    <template #subtitle>
      {{ attempts.length }} attempt(s) · {{ runs.length }} run(s)
    </template>
    <template #actions>
      <!-- Phones need the width for the name; every attempt row below shows its score. -->
      <Sparkline :class="['max-md:hidden']" :values="trend" :label="`exact score of ${runs.length} runs`" :width="140" :height="32" />
    </template>
  </PageHeader>

  <StateView :error="catalog.query.error.value" :loading="catalog.query.isPending.value" :empty="runs.length === 0" empty-text="No runs in this experiment" empty-hint="Runs appear here once `vieval run` writes a report below the viewer's report roots." skeleton="rows" @retry="catalog.query.refetch()">
    <ViewTabs v-model="tab" :items="tabs" label="Experiment views" :href="value => href(tabRoute(value))">
      <template v-if="tab === 'attempts'">
        <div :class="['flex items-center flex-wrap gap-2 mb-2 text-xs muted']">
          Newest first. Select two or more runs to compare them case by case.
          <button type="button" :class="['btn ml-auto text-xs']" :disabled="selected.length < 2" @click="navigate({ name: 'compare', query: { runs: selected.join(','), view: 'runs' } })">
            <span :class="levelIcons.comparison" aria-hidden="true" />Compare {{ selected.length }} runs
          </button>
        </div>
        <section :class="['card']">
          <div :class="[...rowGrid, 'max-md:hidden px-3 py-1.5 border-b border-neutral-200/50 dark:border-neutral-800/50', 'text-xs font-medium muted']" aria-hidden="true">
            <span /><span>Attempt</span><span>Run</span><span>Duration</span><span>Cases</span><span class="text-right">
              Exact
            </span><span />
          </div>
          <ol>
            <li
              v-for="entry in attempts"
              :key="entry.id"
              :data-attempt="entry.id"
              :class="['border-b last:border-b-0 border-neutral-100/70 dark:border-neutral-900', entry.id === props.attempt && 'selected']"
              data-testid="attempt-row"
            >
              <div
                v-for="(run, index) in entry.runs"
                :key="run.runKey"
                :class="[...rowGrid, 'relative px-3 text-sm transition-colors hover:bg-primary-500/5', index === 0 ? 'py-2.5 md:py-2' : 'pb-2.5 md:pb-2 pt-0']"
              >
                <input type="checkbox" :checked="selected.includes(run.runKey)" :aria-label="`Select ${run.runKey} for comparison`" :class="['relative z-1 accent-[var(--series-1)]']" @change="toggle(run.runKey)">
                <!-- The attempt (its time) once per attempt; further runs of the same attempt are sub-rows. -->
                <span v-if="index === 0" :class="['flex flex-col gap-1 min-w-0']">
                  <span :class="['flex items-center gap-2 min-w-0']">
                    <span :class="[levelIcons.attempt, 'muted shrink-0']" aria-hidden="true" />
                    <IdLabel :id="entry.id" :label="entry.label" :href="href({ name: 'run', runKey: run.runKey })" stretch />
                    <TimeAgo v-if="entry.date" :time="entry.date" relative-only :class="['text-xs muted truncate']" />
                  </span>
                  <!-- What this run ran with where the runs of the experiment differ (an eval axis changed between attempts). -->
                  <span v-if="changedAxes.length > 0" :class="['flex flex-wrap gap-1 pl-6']">
                    <span v-for="axis in changedAxes" :key="axis" :class="['badge state-neutral font-normal']" data-testid="attempt-axis">
                      <span class="muted">{{ axis }}</span>{{ axesOf(run)[axis] ? formatAxisValues(axesOf(run)[axis]!) : '—' }}
                    </span>
                  </span>
                </span>
                <span v-else :class="['text-xs muted pl-6']">another run of this attempt</span>
                <span :class="['flex items-center gap-2 min-w-0 max-md:(row-start-2 col-start-2)']">
                  <StateBadge :state="run.state" />
                  <a v-if="index > 0" :href="href({ name: 'run', runKey: run.runKey })" :class="['link mono text-xs stretched-link']" :title="run.runKey">{{ shortRunHash(run.runKey) }}</a>
                  <span v-else :class="['mono text-xs muted']" :title="run.runKey">{{ shortRunHash(run.runKey) }}</span>
                </span>
                <span :class="['text-xs muted tabular-nums whitespace-nowrap max-md:(row-start-2 col-start-3 col-span-2 text-right)']">{{ formatDuration(duration(run)) }}</span>
                <span :class="['flex items-center gap-2 min-w-0', 'max-md:(row-start-3 col-start-2 col-span-3)']">
                  <CountsBar :class="['flex-1']" :counts="expectedCounts(run)" />
                  <span v-if="isPartial(run)" :class="['badge state-interrupted shrink-0']" :title="`${run.counts.total} of ${run.caseTotal} expected cases ran`" data-testid="attempt-partial">{{ run.counts.total }} / {{ run.caseTotal }}</span>
                </span>
                <span :class="['text-right tabular-nums font-semibold max-md:(row-start-1 col-start-3)']">{{ formatScore(run.exactAverage) }}</span>
                <!-- IdMenu renders no element of its own; the wrapper carries the grid placement. -->
                <span :class="['flex max-md:(row-start-1 col-start-4)']"><IdMenu :id="run.runKey" kind="run" /></span>
              </div>
            </li>
          </ol>
        </section>
      </template>
      <MatrixView v-else :experiment="props.experiment" :project="props.project" :workspace="props.workspace" />
    </ViewTabs>
  </StateView>
</template>
