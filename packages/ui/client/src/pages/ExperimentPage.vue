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
import { attemptDate, attemptLabel, experimentLabel, mergeMatrices, shortRunHash } from '../labels'
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
                <span v-if="index === 0" :class="['flex items-center gap-2 min-w-0']">
                  <span :class="[levelIcons.attempt, 'muted shrink-0']" aria-hidden="true" />
                  <IdLabel :id="entry.id" :label="entry.label" :href="href({ name: 'run', runKey: run.runKey })" stretch />
                  <TimeAgo v-if="entry.date" :time="entry.date" relative-only :class="['text-xs muted truncate']" />
                </span>
                <span v-else :class="['text-xs muted pl-6']">another run of this attempt</span>
                <span :class="['flex items-center gap-2 min-w-0 max-md:(row-start-2 col-start-2)']">
                  <StateBadge :state="run.state" />
                  <a v-if="index > 0" :href="href({ name: 'run', runKey: run.runKey })" :class="['link mono text-xs stretched-link']" :title="run.runKey">{{ shortRunHash(run.runKey) }}</a>
                  <span v-else :class="['mono text-xs muted']" :title="run.runKey">{{ shortRunHash(run.runKey) }}</span>
                </span>
                <span :class="['text-xs muted tabular-nums whitespace-nowrap max-md:(row-start-2 col-start-3 col-span-2 text-right)']">{{ formatDuration(duration(run)) }}</span>
                <CountsBar :class="['max-md:(row-start-3 col-start-2 col-span-3)']" :counts="run.counts" />
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
