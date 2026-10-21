<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'

import type { LogLine, RunListItem } from '../../../src/shared/contract'
import type { ViewTab } from '../components/ViewTabs.vue'
import type { Route } from '../router'

import { DropdownMenuItem } from 'reka-ui'
import { computed, toRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import CountsBar from '../components/CountsBar.vue'
import ErrorGroupsPanel from '../components/ErrorGroupsPanel.vue'
import ExecutionTree from '../components/ExecutionTree.vue'
import ExperimentName from '../components/ExperimentName.vue'
import HeadlineScore from '../components/HeadlineScore.vue'
import IdLabel from '../components/IdLabel.vue'
import LogView from '../components/LogView.vue'
import OtelPanel from '../components/OtelPanel.vue'
import PageHeader from '../components/PageHeader.vue'
import ProgressPanel from '../components/ProgressPanel.vue'
import RunDetails from '../components/RunDetails.vue'
import ScoresPanel from '../components/ScoresPanel.vue'
import StateView from '../components/StateView.vue'
import ViewTabs from '../components/ViewTabs.vue'

import { api } from '../api'
import { useCatalog } from '../composables/useCatalog'
import { useRunLive } from '../composables/useRunLive'
import { useStatusFavicon } from '../composables/useStatusFavicon'
import { formatDateTime } from '../format'
import { levelIcons } from '../hierarchy'
import { runLabel } from '../labels'
import { href, navigate } from '../router'

/**
 * One run: live progress, ETA and current position, the execution tree, scores and metrics (with matrix rows),
 * console logs, and the OTEL panels.
 */
const props = defineProps<{ route: Extract<Route, { name: 'run' }>, run?: RunListItem }>()

const { t } = useI18n()
const live = useRunLive(toRef(() => props.route.runKey))
type Tab = 'execution' | 'logs' | 'otel' | 'scores'
const tabs = computed<ViewTab<Tab>[]>(() => [
  { icon: 'i-mingcute-sitemap-line', label: t('runs.run.tabs.execution'), value: 'execution' },
  { icon: 'i-mingcute-chart-horizontal-line', label: t('runs.run.tabs.scores'), value: 'scores' },
  { icon: 'i-mingcute-terminal-box-line', label: t('runs.run.tabs.logs'), value: 'logs' },
  { icon: 'i-mingcute-heartbeat-line', label: t('runs.run.tabs.otel'), value: 'otel' },
])
const tabRoute = (value: Tab): Route => ({ name: 'run', runKey: props.route.runKey, tab: value === 'execution' ? undefined : value })
// An unknown `tab` in the address shows the default view.
const tab = computed<Tab>({
  get: () => tabs.value.find(item => item.value === props.route.tab)?.value ?? 'execution',
  set: value => navigate(tabRoute(value)),
})

const position = computed(() => ({
  attempt: props.run?.attemptId ?? live.snapshot.value?.identity.attemptId,
  experiment: props.run?.experimentId ?? live.snapshot.value?.identity.experimentId,
  project: props.run?.projectSegment,
  runKey: props.route.runKey,
  workspace: props.run?.workspaceId ?? live.snapshot.value?.identity.workspaceId,
}))
const catalog = useCatalog()
const experimentMatrix = computed(() => catalog.matrixOf({ experiment: position.value.experiment, project: position.value.project, workspace: position.value.workspace }))
const runKey = computed(() => props.route.runKey)
const loadLogs = computed(() => {
  const key = runKey.value
  return (offset: number, limit: number) => api.logs(key, { limit, offset })
})
/**
 * Case counts of the whole run from the live snapshot, so they move with the run (the catalog entry of the run is read
 * once per page), beside the snapshot's headline (`resolveHeadline` over the tasks' events).
 */
const counts = computed(() => {
  const snapshot = live.snapshot.value
  if (snapshot == null)
    return undefined
  const sum = { errored: 0, failed: 0, passed: 0, requeued: 0, running: 0, skipped: 0, timeout: 0, total: 0 }
  for (const task of snapshot.tasks) {
    for (const key of Object.keys(sum) as (keyof typeof sum)[])
      sum[key] += task.caseCounts[key]
  }
  return sum
})
const taskLabel = (taskId: string) => live.snapshot.value?.tasks.find(task => task.id === taskId)?.displayName ?? taskId
// A completion rate below 100% leads to the cases without a result, grouped by their error.
const errorGroups = useTemplateRef<ComponentPublicInstance>('errorGroups')
function showErrors(): void {
  const element = errorGroups.value?.$el
  if (element instanceof Element)
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
useStatusFavicon(() => live.snapshot.value?.state)
const label = computed(() => runLabel({ runKey: props.route.runKey, startedAt: live.snapshot.value?.startedAt }))
/** The tab of a running run leads with its progress, so it can be followed from a background tab. */
const documentTitle = computed(() => {
  const ratio = live.snapshot.value?.progress.ratio
  return live.snapshot.value?.state === 'running' && ratio != null ? `${(Math.min(1, ratio) * 100).toFixed(1)}% · ${label.value}` : label.value
})
const caseHref = (line: LogLine) => href({ caseId: line.caseId!, name: 'case', runKey: runKey.value, taskId: line.taskId! })
const errorCaseHref = (target: { caseId: string, taskId: string }) => href({ ...target, name: 'case', runKey: runKey.value })
</script>

<template>
  <PageHeader :id="props.route.runKey" :loading="!live.snapshot.value && !live.error.value" level="run" :position="position" :title="documentTitle" title-size="sm">
    <template #title>
      <IdLabel :id="props.route.runKey" :label="label" />
      <!-- RunDetails renders no element of its own; the wrapper centers the button on the title's first line. -->
      <span :class="['flex shrink-0 mt-0.5']"><RunDetails :run-id="props.route.runKey" :report-path="props.run?.reportPath" :report-root="props.run?.reportRoot" /></span>
    </template>
    <template #subtitle>
      <span v-if="position.experiment" :class="['inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mr-1 align-middle']">
        <span :class="[levelIcons.experiment]" aria-hidden="true" />
        <ExperimentName :experiment-id="position.experiment" :matrix="experimentMatrix" :href="position.workspace && position.project ? href({ experiment: position.experiment, name: 'scope', project: position.project, workspace: position.workspace }) : undefined" />
        <!-- The attempt's time was printed here; it is the run's start (the title) to the second, and the breadcrumb
             names the attempt, so it only repeated the title. -->
      </span>
      <!-- The start is the title already; only the end (or the interruption) adds a fact. -->
      <template v-if="live.snapshot.value?.endedAt || live.snapshot.value?.interruptSignal">
        <br><template v-if="live.snapshot.value.endedAt">
          {{ t('runs.run.ended', { time: formatDateTime(live.snapshot.value.endedAt) }) }}
        </template>
        <template v-if="live.snapshot.value.interruptSignal">
          · {{ t('runs.run.interruptedBy', { signal: live.snapshot.value.interruptSignal }) }}
        </template>
      </template>
    </template>
    <template #actions>
      <!-- The run's score at a glance, on the title's line: the headline with its completion rate, and the case bar
           (counts in its tooltip). A score over part of the cases is not the score of the run, so the completion rate
           always stands next to it. The score leads the header (larger than the title); phones put the bar below it
           at the full width. -->
      <span v-if="counts && live.snapshot.value" :class="['flex items-center gap-3 mr-1', 'max-md:(w-full mr-0 flex-col items-stretch gap-2)']" data-testid="run-score">
        <HeadlineScore :result="live.snapshot.value.headline" :definitions="live.snapshot.value.scoreDefinitions" :task-label="taskLabel" size="lg" @errors="showErrors" />
        <CountsBar :class="['w-32 max-md:w-full']" :counts="counts" />
      </span>
    </template>
    <template v-if="position.workspace && position.project && position.experiment" #menu>
      <DropdownMenuItem as-child :class="['menu-item']">
        <a :href="href({ name: 'compare', query: { experiment: position.experiment, project: position.project, view: 'attempts', workspace: position.workspace } })">
          <span class="i-mingcute-git-compare-line" aria-hidden="true" />{{ t('runs.run.compareAttempts') }}
        </a>
      </DropdownMenuItem>
    </template>
  </PageHeader>

  <StateView :error="live.error.value && !live.snapshot.value ? live.error.value : undefined" :loading="!live.snapshot.value" :loading-text="t('runs.run.loading')" skeleton="run" @retry="live.reload">
    <template v-if="live.snapshot.value">
      <ProgressPanel :snapshot="live.snapshot.value" :connection="live.connection.value" :received-at="live.receivedAt.value" />
      <div v-if="live.error.value" role="alert" :class="['mt-2 text-xs rounded state-failed px-2 py-1']">
        {{ t('runs.run.refreshFailed', { message: live.error.value.message }) }}
      </div>
      <ErrorGroupsPanel ref="errorGroups" :tasks="live.snapshot.value.tasks" :case-href="errorCaseHref" />
      <div :class="['mt-4']">
        <ViewTabs v-model="tab" :items="tabs" :href="value => href(tabRoute(value))" :label="t('runs.run.tabs.label')">
          <ExecutionTree v-if="tab === 'execution'" :snapshot="live.snapshot.value" />
          <ScoresPanel v-else-if="tab === 'scores'" :snapshot="live.snapshot.value" :refresh-key="live.refreshKey.value" />
          <section v-else-if="tab === 'logs'" class="card">
            <LogView :load="loadLogs" :follow="live.snapshot.value.state === 'running'" show-case :case-href="caseHref" />
          </section>
          <OtelPanel v-else-if="tab === 'otel'" :snapshot="live.snapshot.value" :refresh-key="live.refreshKey.value" />
        </ViewTabs>
      </div>
    </template>
  </StateView>
</template>
