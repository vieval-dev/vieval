<script setup lang="ts">
import type { ViewTab } from '../components/ViewTabs.vue'
import type { ExperimentEntry } from '../composables/useCatalog'
import type { Route } from '../router'

import { computed } from 'vue'

import CountsBar from '../components/CountsBar.vue'
import ExperimentName from '../components/ExperimentName.vue'
import MatrixView from '../components/MatrixView.vue'
import PageHeader from '../components/PageHeader.vue'
import Sparkline from '../components/Sparkline.vue'
import StateBadge from '../components/StateBadge.vue'
import StateView from '../components/StateView.vue'
import TimeAgo from '../components/TimeAgo.vue'
import ViewTabs from '../components/ViewTabs.vue'

import { useCatalog } from '../composables/useCatalog'
import { formatScore } from '../format'
import { levelIcons } from '../hierarchy'
import { mergeMatrices } from '../labels'
import { href, navigate } from '../router'

/**
 * One project: its experiments as list rows (what was measured, how its latest run went, the trend over attempts) and
 * the matrix of all its runs.
 */
const props = defineProps<{ project: string, tab?: string, workspace: string }>()

type Tab = 'experiments' | 'matrix'
const tabs: ViewTab<Tab>[] = [
  { icon: levelIcons.experiment, label: 'Experiments', value: 'experiments' },
  { icon: 'i-mingcute-layout-grid-line', label: 'Matrix', value: 'matrix' },
]
const tabRoute = (value: Tab): Route => ({ name: 'scope', project: props.project, tab: value === 'experiments' ? undefined : value, workspace: props.workspace })
const tab = computed<Tab>({
  get: () => tabs.find(item => item.value === props.tab)?.value ?? 'experiments',
  set: value => navigate(tabRoute(value)),
})

const catalog = useCatalog()
const project = computed(() => catalog.workspaces.value.find(workspace => workspace.id === props.workspace)?.projects.find(entry => entry.id === props.project))

/** Row data of an experiment: its matrix, the trend of exact scores (oldest run first), and its newest run. */
function toRow(experiment: ExperimentEntry) {
  return {
    ...experiment,
    matrix: mergeMatrices(experiment.runs.map(run => run.matrix)),
    trend: experiment.runs.map(run => run.exactAverage).toReversed(),
  }
}
const rows = computed(() => (project.value?.experiments ?? []).map(toRow))
/** Columns of a row: name, latest run, trend, cases, exact score, attempts; the header uses the same template. */
const rowColumns = 'minmax(14rem, 2fr) minmax(12rem, 1.2fr) 4.5rem minmax(16rem, 1.8fr) 4rem 4rem'
</script>

<template>
  <PageHeader :id="props.project" level="project" :position="{ project: props.project, workspace: props.workspace }" :title="props.project">
    <template #subtitle>
      {{ project?.experiments.length ?? 0 }} experiment(s) · {{ project?.runs.length ?? 0 }} run(s)
    </template>
  </PageHeader>

  <StateView :error="catalog.resource.error.value" :loading="catalog.resource.loading.value" :empty="project == null" empty-text="No runs in this project" empty-hint="Runs appear here once `vieval run` writes a report below the viewer's report roots." @retry="catalog.resource.reload">
    <ViewTabs v-model="tab" :items="tabs" label="Project views" :href="value => href(tabRoute(value))">
      <section v-if="tab === 'experiments'" :class="['card']">
        <div :class="['grid items-center gap-x-4 px-3 py-1.5 border-b border-neutral-200/50 dark:border-neutral-800/50', 'text-xs font-medium muted']" :style="{ gridTemplateColumns: rowColumns }" aria-hidden="true">
          <span>Experiment</span><span>Latest run</span><span>Trend</span><span>Cases (latest)</span><span class="text-right">
            Exact
          </span><span class="text-right">
            Attempts
          </span>
        </div>
        <ul>
          <li
            v-for="row in rows"
            :key="row.id"
            :class="['relative grid items-center gap-x-4 px-3 py-2 text-sm transition-colors', 'border-b last:border-b-0 border-neutral-100/70 dark:border-neutral-900 hover:bg-primary-500/5']"
            :style="{ gridTemplateColumns: rowColumns }"
            data-testid="experiment-row"
          >
            <span :class="['flex items-center gap-2 min-w-0']">
              <span :class="[levelIcons.experiment, 'muted shrink-0']" aria-hidden="true" />
              <ExperimentName :experiment-id="row.id" :matrix="row.matrix" :href="href({ experiment: row.id, name: 'scope', project: row.project, workspace: row.workspace })" stretch />
            </span>
            <span :class="['flex items-center gap-2 min-w-0']">
              <StateBadge :state="row.latest.state" />
              <TimeAgo :time="row.latest.startedAt" :class="['text-xs muted truncate']" />
            </span>
            <Sparkline :values="row.trend" :label="`exact score of ${row.runs.length} runs`" :width="72" />
            <CountsBar :counts="row.latest.counts" />
            <span :class="['text-right tabular-nums font-semibold']">{{ formatScore(row.latest.exactAverage) }}</span>
            <span :class="['text-right tabular-nums muted']">{{ row.attempts.length }}</span>
          </li>
        </ul>
      </section>
      <MatrixView v-else :project="props.project" :workspace="props.workspace" />
    </ViewTabs>
  </StateView>
</template>
