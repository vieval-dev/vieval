<script setup lang="ts">
import type { LogLine, RunListItem } from '../../../src/shared/contract'
import type { ViewTab } from '../components/ViewTabs.vue'
import type { Route } from '../router'

import { computed, toRef } from 'vue'

import CountsBar from '../components/CountsBar.vue'
import ExecutionTree from '../components/ExecutionTree.vue'
import ExperimentName from '../components/ExperimentName.vue'
import IdLabel from '../components/IdLabel.vue'
import LogView from '../components/LogView.vue'
import OtelPanel from '../components/OtelPanel.vue'
import PageHeader from '../components/PageHeader.vue'
import ProgressPanel from '../components/ProgressPanel.vue'
import RunDetails from '../components/RunDetails.vue'
import ScoresPanel from '../components/ScoresPanel.vue'
import StateView from '../components/StateView.vue'
import ViewTabs from '../components/ViewTabs.vue'

import { scoreRounds } from '../../../src/shared/reduce'
import { api } from '../api'
import { useCatalog } from '../composables/useCatalog'
import { useRunLive } from '../composables/useRunLive'
import { formatDateTime, formatScore } from '../format'
import { levelIcons } from '../hierarchy'
import { attemptLabel, runLabel } from '../labels'
import { href, navigate } from '../router'

/**
 * One run: live progress, ETA and current position, the execution tree, scores and metrics (with matrix rows),
 * console logs, and the OTEL panels.
 */
const props = defineProps<{ route: Extract<Route, { name: 'run' }>, run?: RunListItem }>()

const live = useRunLive(toRef(() => props.route.runKey))
type Tab = 'execution' | 'logs' | 'otel' | 'scores'
const tabs: ViewTab<Tab>[] = [
  { icon: 'i-mingcute-sitemap-line', label: 'Execution', value: 'execution' },
  { icon: 'i-mingcute-chart-horizontal-line', label: 'Scores & metrics', value: 'scores' },
  { icon: 'i-mingcute-terminal-box-line', label: 'Console logs', value: 'logs' },
  { icon: 'i-mingcute-heartbeat-line', label: 'OpenTelemetry', value: 'otel' },
]
const tabRoute = (value: Tab): Route => ({ name: 'run', runKey: props.route.runKey, tab: value === 'execution' ? undefined : value })
// An unknown `tab` in the address shows the default view.
const tab = computed<Tab>({
  get: () => tabs.find(item => item.value === props.route.tab)?.value ?? 'execution',
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
 * Exact score and case counts of the whole run from the live snapshot, so they move with the run (the catalog entry
 * of the run is read once per page). The score follows the task scores: every settled round of every case counts.
 */
const score = computed(() => {
  const snapshot = live.snapshot.value
  if (snapshot == null)
    return undefined
  const counts = { failed: 0, passed: 0, running: 0, skipped: 0, timeout: 0, total: 0 }
  for (const task of snapshot.tasks) {
    for (const key of Object.keys(counts) as (keyof typeof counts)[])
      counts[key] += task.caseCounts[key]
  }
  return { counts, exact: scoreRounds(snapshot.tasks.flatMap(task => task.cases.flatMap(node => node.rounds))).exact }
})
const caseHref = (line: LogLine) => href({ caseId: line.caseId!, name: 'case', runKey: runKey.value, taskId: line.taskId! })
</script>

<template>
  <PageHeader :id="props.route.runKey" :loading="!live.snapshot.value && !live.error.value" level="run" :position="position" :title="props.route.runKey">
    <template #title>
      <IdLabel :id="props.route.runKey" :label="runLabel({ runKey: props.route.runKey, startedAt: live.snapshot.value?.startedAt })" />
    </template>
    <template #subtitle>
      <span v-if="position.experiment" :class="['inline-flex items-center gap-1.5 mr-1 align-middle']">
        <span :class="[levelIcons.experiment]" aria-hidden="true" />
        <ExperimentName :experiment-id="position.experiment" :matrix="experimentMatrix" :href="position.workspace && position.project ? href({ experiment: position.experiment, name: 'scope', project: position.project, workspace: position.workspace }) : undefined" />
        <template v-if="position.attempt">
          · {{ attemptLabel(position.attempt) }}
        </template>
      </span>
      <!-- The start is the title already; only the end (or the interruption) adds a fact. -->
      <template v-if="live.snapshot.value?.endedAt || live.snapshot.value?.interruptSignal">
        <br><template v-if="live.snapshot.value.endedAt">
          ended {{ formatDateTime(live.snapshot.value.endedAt) }}
        </template>
        <template v-if="live.snapshot.value.interruptSignal">
          · interrupted by {{ live.snapshot.value.interruptSignal }}
        </template>
      </template>
      <RunDetails :run-id="props.route.runKey" :report-path="props.run?.reportPath" :report-root="props.run?.reportRoot" />
    </template>
    <template #actions>
      <!-- The run's score at a glance, like a matrix cell: exact score and case counts (hover for each count). -->
      <span v-if="score" :class="['flex flex-col gap-1 w-40 mr-2', 'max-md:(w-full mr-0)']" data-testid="run-score">
        <span :class="['flex items-baseline gap-1.5']">
          <span :class="['text-2xl font-semibold tabular-nums leading-none']">{{ formatScore(score.exact) }}</span>
          <span :class="['text-xs muted']">exact</span>
        </span>
        <CountsBar :counts="score.counts" labels="hover" />
      </span>
      <a v-if="position.workspace && position.project && position.experiment" :class="['btn']" :href="href({ name: 'compare', query: { experiment: position.experiment, project: position.project, view: 'attempts', workspace: position.workspace } })">
        <span class="i-mingcute-git-compare-line" aria-hidden="true" />Compare attempts
      </a>
    </template>
  </PageHeader>

  <StateView :error="live.error.value && !live.snapshot.value ? live.error.value : undefined" :loading="!live.snapshot.value" loading-text="Reading the run…" skeleton="run" @retry="live.reload">
    <template v-if="live.snapshot.value">
      <ProgressPanel :snapshot="live.snapshot.value" :connection="live.connection.value" :received-at="live.receivedAt.value" :event-count="live.eventCount.value" />
      <div v-if="live.error.value" role="alert" :class="['mt-2 text-xs rounded state-failed px-2 py-1']">
        Refresh failed: {{ live.error.value.message }} — showing the last snapshot.
      </div>
      <div :class="['mt-4']">
        <ViewTabs v-model="tab" :items="tabs" :href="value => href(tabRoute(value))" label="Run views">
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
