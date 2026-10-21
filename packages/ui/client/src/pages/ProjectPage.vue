<script setup lang="ts">
import type { ViewTab } from '../components/ViewTabs.vue'
import type { ExperimentEntry } from '../composables/useCatalog'
import type { Route } from '../router'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import CountsBar from '../components/CountsBar.vue'
import ExperimentName from '../components/ExperimentName.vue'
import HeadlineScore from '../components/HeadlineScore.vue'
import MatrixView from '../components/MatrixView.vue'
import PageHeader from '../components/PageHeader.vue'
import Sparkline from '../components/Sparkline.vue'
import StateBadge from '../components/StateBadge.vue'
import StateView from '../components/StateView.vue'
import TimeAgo from '../components/TimeAgo.vue'
import ViewTabs from '../components/ViewTabs.vue'

import { useCatalog } from '../composables/useCatalog'
import { levelIcons } from '../hierarchy'
import { mergeMatrices } from '../labels'
import { href, navigate } from '../router'
import { headlineValue, headlineView } from '../scores'

/**
 * One project: its experiments as list rows (what was measured, how its latest run went, the trend over attempts) and
 * the matrix of all its runs.
 */
const props = defineProps<{ project: string, tab?: string, workspace: string }>()

const { t } = useI18n()

type Tab = 'experiments' | 'matrix'
const tabs = computed<ViewTab<Tab>[]>(() => [
  { icon: levelIcons.experiment, label: t('runs.project.tabs.experiments'), value: 'experiments' },
  { icon: 'i-mingcute-layout-grid-line', label: t('runs.project.tabs.matrix'), value: 'matrix' },
])
const tabRoute = (value: Tab): Route => ({ name: 'scope', project: props.project, tab: value === 'experiments' ? undefined : value, workspace: props.workspace })
const tab = computed<Tab>({
  get: () => tabs.value.find(item => item.value === props.tab)?.value ?? 'experiments',
  set: value => navigate(tabRoute(value)),
})

const catalog = useCatalog()
const project = computed(() => catalog.workspaces.value.find(workspace => workspace.id === props.workspace)?.projects.find(entry => entry.id === props.project))

/**
 * Row data of an experiment: its matrix, the trend of its headline scores (oldest run first) named by the newest run's
 * headline, and its newest run.
 */
function toRow(experiment: ExperimentEntry) {
  const latest = experiment.latest
  return {
    ...experiment,
    matrix: mergeMatrices(experiment.runs.map(run => run.matrix)),
    trend: experiment.runs.map(run => headlineValue(run.headline)).toReversed(),
    trendLabel: latest.headline == null ? t('runs.trend.score') : headlineView(latest.headline, latest.headlineDefinitions).label,
  }
}
const rows = computed(() => (project.value?.experiments ?? []).map(toRow))
/**
 * Grid of a row. Wide lists: one line with name, latest run, trend, cases, headline score, attempts (the header
 * uses the same columns). Narrow lists: the name on top, the latest run below it, then the cases with the score
 * below them; the trend and the attempt count are left out (both are on the experiment page). "Wide" is the width of
 * the list card (a container query, 65rem), not of the window, so an open sidebar cannot push the columns out of it.
 */
const rowGrid = [
  'grid items-center gap-x-4 gap-y-1.5 grid-cols-[minmax(0,1fr)]',
  '@[65rem]:grid-cols-[minmax(14rem,2fr)_minmax(12rem,1.2fr)_4.5rem_minmax(16rem,1.8fr)_8rem_4rem]',
]
</script>

<template>
  <PageHeader :id="props.project" :loading="catalog.query.isPending.value" level="project" :position="{ project: props.project, workspace: props.workspace }" :title="props.project">
    <template #subtitle>
      {{ t('runs.count.experiments', { n: project?.experiments.length ?? 0 }, project?.experiments.length ?? 0) }} · {{ t('runs.count.runs', { n: project?.runs.length ?? 0 }, project?.runs.length ?? 0) }}
    </template>
  </PageHeader>

  <StateView :error="catalog.query.error.value" :loading="catalog.query.isPending.value" :empty="project == null" :empty-text="t('runs.project.empty')" :empty-hint="t('runs.emptyHint')" skeleton="rows" @retry="catalog.query.refetch()">
    <ViewTabs v-model="tab" :items="tabs" :label="t('runs.project.tabs.label')" :href="value => href(tabRoute(value))">
      <section v-if="tab === 'experiments'" :class="['card @container']">
        <!-- The wrapper hides the header on narrow lists; the row grid itself sets `display: grid`. -->
        <div :class="['hidden @[65rem]:block']" aria-hidden="true">
          <div :class="[...rowGrid, 'px-3 py-1.5 border-b border-neutral-200/50 dark:border-neutral-800/50', 'text-xs font-medium muted']">
            <span>{{ t('runs.project.columns.experiment') }}</span><span>{{ t('runs.project.columns.latestRun') }}</span><span>{{ t('runs.project.columns.trend') }}</span><span>{{ t('runs.project.columns.casesLatest') }}</span><span class="text-right">
              {{ t('runs.project.columns.score') }}
            </span><span class="text-right">
              {{ t('runs.project.columns.attempts') }}
            </span>
          </div>
        </div>
        <ul>
          <li
            v-for="row in rows"
            :key="row.id"
            :class="[...rowGrid, 'relative px-3 py-2.5 @[65rem]:py-2 text-sm transition-colors', 'border-b last:border-b-0 border-neutral-100/70 dark:border-neutral-900 hover:bg-primary-500/5']"
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
            <!-- The cell stays even when the trend draws nothing (fewer than two scored runs), so later columns keep their place. -->
            <span :class="['hidden @[65rem]:flex']"><Sparkline :values="row.trend" :label="t('runs.trend.label', { n: row.runs.length, score: row.trendLabel }, row.runs.length)" :width="72" /></span>
            <CountsBar :counts="row.latest.counts" />
            <HeadlineScore :class="['relative z-1 justify-self-end min-w-0 max-w-full']" :result="row.latest.headline" :definitions="row.latest.headlineDefinitions" size="sm" align="end" />
            <span :class="['hidden @[65rem]:block text-right tabular-nums muted']">{{ row.attempts.length }}</span>
          </li>
        </ul>
      </section>
      <MatrixView v-else :project="props.project" :workspace="props.workspace" />
    </ViewTabs>
  </StateView>
</template>
