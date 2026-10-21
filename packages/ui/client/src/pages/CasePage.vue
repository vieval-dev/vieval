<script setup lang="ts">
import type { RunListItem } from '../../../src/shared/contract'
import type { ViewTab } from '../components/ViewTabs.vue'
import type { Route } from '../router'

import { useQuery } from '@pinia/colada'
import { computed, toRef, watch } from 'vue'
import { I18nT, useI18n } from 'vue-i18n'

import ArtifactsPanel from '../components/ArtifactsPanel.vue'
import CaseTimeline from '../components/CaseTimeline.vue'
import EvidencePanel from '../components/EvidencePanel.vue'
import InferencePanel from '../components/InferencePanel.vue'
import LogView from '../components/LogView.vue'
import MetricInfo from '../components/MetricInfo.vue'
import ObjectTree from '../components/ObjectTree.vue'
import PageHeader from '../components/PageHeader.vue'
import ScoreBadge from '../components/ScoreBadge.vue'
import StateBadge from '../components/StateBadge.vue'
import StateView from '../components/StateView.vue'
import ViewTabs from '../components/ViewTabs.vue'

import { groupInferenceCalls } from '../../../src/shared/inference'
import { api } from '../api'
import { columnDefinitions, metricLabel } from '../caseMetrics'
import { useRunLive } from '../composables/useRunLive'
import { useStatusFavicon } from '../composables/useStatusFavicon'
import { formatDateTime, formatDuration, formatTime, previewValue } from '../format'
import { href, navigate } from '../router'
import { caseScoreText, isGraderCall, primaryScoreName, scoreDefinition } from '../scores'
import { runSwitcherOptions } from '../switcher'

/**
 * One case: rounds and retries on a timeline, console output, input and output, metrics, artifacts, external
 * evidence, and inference events. Refreshes while the run is live.
 */
const props = defineProps<{ route: Extract<Route, { name: 'case' }>, run?: RunListItem }>()

const { t } = useI18n()

const live = useRunLive(toRef(() => props.route.runKey))
const ref = computed(() => ({ caseId: props.route.caseId, taskId: props.route.taskId }))
const detail = useQuery({
  key: () => ['runs', props.route.runKey, 'case', props.route.taskId, props.route.caseId],
  query: () => api.case(props.route.runKey, ref.value),
})
// Every case's metrics of this task, for the distribution behind each metric of this case (shared with the task page).
const taskMetrics = useQuery({
  key: () => ['runs', props.route.runKey, 'task', props.route.taskId, 'metrics'],
  query: () => api.metrics(props.route.runKey, { taskId: props.route.taskId }),
})
const definitions = computed(() => columnDefinitions(detail.data.value?.metricDefinitions ?? [], detail.data.value?.scoreDefinitions ?? []))
const labelOf = (name: string) => metricLabel(name, definitions.value)
function taskValuesOf(name: string): unknown[] {
  const data = taskMetrics.data.value
  return [
    ...(data?.numeric.find(series => series.name === name)?.points ?? []),
    ...(data?.nonNumeric.find(series => series.name === name)?.values ?? []),
    ...(data?.scores.find(series => series.name === name)?.points ?? []),
  ].map(entry => entry.value)
}

/**
 * Every score of the case, the primary first: the scores its task defined and the ones it recorded, each with the
 * last record of the last round (rationale, grader, metadata) and the grader's model calls in this case.
 */
const caseScores = computed(() => {
  const data = detail.data.value
  if (data == null)
    return []
  const names = [...new Set([...data.scoreDefinitions.map(definition => definition.name), ...Object.keys(data.scores.values), ...Object.keys(data.scores.unscored)])]
  const primary = primaryScoreName(data.scoreDefinitions, names)
  const lastRound = data.rounds.at(-1)?.roundIndex ?? 0
  const calls = groupInferenceCalls(data.inference)
  return names.toSorted((a, b) => Number(b === primary) - Number(a === primary)).map((name) => {
    const record = data.scoreRecords.findLast(entry => entry.record.name === name && (entry.roundIndex ?? 0) === lastRound)?.record
    const graderId = record?.grader?.id ?? scoreDefinition(name, data.scoreDefinitions)?.grader?.id
    return {
      callCount: graderId == null ? 0 : calls.filter(call => isGraderCall(call, graderId)).length,
      callsHref: graderId == null ? undefined : href({ ...props.route, grader: graderId, tab: 'inference' }),
      name,
      record,
      text: caseScoreText(data.scores, name),
    }
  })
})
const timeline = useQuery({
  key: () => ['runs', props.route.runKey, 'case', props.route.taskId, props.route.caseId, 'timeline'],
  query: () => api.timeline(props.route.runKey, ref.value),
})
// Re-read the case whenever the run advanced; finished cases do not change, so the cost is one request per refresh.
watch(live.refreshKey, () => {
  void detail.refetch()
  void timeline.refetch()
})

type Tab = 'artifacts' | 'evidence' | 'inference' | 'logs' | 'overview'
const tabs = computed<ViewTab<Tab>[]>(() => [
  { icon: 'i-mingcute-layout-4-line', label: t('cases.case.tabs.overview'), value: 'overview' },
  { count: detail.data.value?.logLineCount, icon: 'i-mingcute-terminal-box-line', label: t('cases.case.tabs.logs'), value: 'logs' },
  { count: detail.data.value?.artifacts.length, icon: 'i-mingcute-attachment-line', label: t('cases.case.tabs.artifacts'), value: 'artifacts' },
  { count: detail.data.value?.evidence.length, icon: 'i-mingcute-file-search-line', label: t('cases.case.tabs.evidence'), value: 'evidence' },
  // Calls, not events: every call writes a request, a response, and two events per tool call.
  { count: detail.data.value == null ? undefined : detail.data.value.inference.filter(entry => entry.event === 'inference.requested').length, icon: 'i-mingcute-robot-line', label: t('cases.case.tabs.inference'), value: 'inference' },
])
// Switching tabs drops the grader filter of the inference tab.
const tabRoute = (value: Tab): Route => ({ ...props.route, grader: undefined, tab: value === 'overview' ? undefined : value })
// An unknown `tab` in the address shows the overview.
const tab = computed<Tab>({
  get: () => tabs.value.find(item => item.value === props.route.tab)?.value ?? 'overview',
  set: value => navigate(tabRoute(value)),
})
const loadLogs = computed(() => {
  const runKey = props.route.runKey
  const caseRef = ref.value
  return (offset: number, limit: number) => api.logs(runKey, { ...caseRef, limit, offset })
})
const position = computed(() => ({
  attempt: props.run?.attemptId,
  caseId: props.route.caseId,
  caseName: detail.data.value?.name,
  experiment: props.run?.experimentId,
  project: props.run?.projectSegment,
  runKey: props.route.runKey,
  taskId: props.route.taskId,
  taskName: detail.data.value?.taskDisplayName,
  workspace: props.run?.workspaceId,
}))
// The tab follows the case itself: its own outcome is what the page is about.
useStatusFavicon(() => detail.data.value?.state)
const running = computed(() => detail.data.value?.state === 'running')
/** Tries of every round of the case: immediate retries and requeued reruns. */
const tryCount = computed(() => detail.data.value?.rounds.reduce((sum, round) => sum + round.tries.length, 0) ?? 0)
</script>

<template>
  <PageHeader :loading="detail.isPending.value" :siblings="runSwitcherOptions(live.snapshot.value, 'case', props.route.taskId)" level="case" :position="position" :title="detail.data.value?.name ?? props.route.caseId">
    <template #subtitle>
      <template v-if="detail.data.value">
        <I18nT keypath="cases.case.subtitle" scope="global">
          <template #index>
            <span>{{ detail.data.value.index + 1 }}</span>
          </template>
          <template #task>
            <a :class="['link']" :href="href({ name: 'task', runKey: props.route.runKey, taskId: props.route.taskId })">{{ detail.data.value.taskDisplayName }}</a>
          </template>
          <template #time>
            <span>{{ formatDateTime(detail.data.value.startedAt) }}</span>
          </template>
        </I18nT>
      </template>
    </template>
    <template #actions>
      <template v-if="detail.data.value">
        <StateBadge :state="detail.data.value.state" />
        <ScoreBadge v-for="score in caseScores" :key="score.name" :call-count="score.callCount" :calls-href="score.callsHref" :definitions="detail.data.value.scoreDefinitions" :name="score.name" :record="score.record" :text="score.text" />
        <span class="badge state-neutral">{{ formatDuration(detail.data.value.durationMs) }}</span>
        <span v-if="running" class="badge state-running"><span class="vv-pulse i-mingcute-airdrop-line" aria-hidden="true" />{{ t('cases.case.live') }}</span>
      </template>
    </template>
  </PageHeader>

  <StateView :error="detail.error.value" :loading="detail.isPending.value" :loading-text="t('cases.case.loading')" skeleton="case" @retry="detail.refetch()">
    <template v-if="detail.data.value">
      <ViewTabs v-model="tab" :items="tabs" :href="value => href(tabRoute(value))" :label="t('cases.case.tabs.label')">
        <div v-if="tab === 'overview'" :class="['flex flex-col gap-4']">
          <!-- A wrong result (failed assertion) is red; an error without a result is the amber of `errored`. -->
          <div v-if="detail.data.value.errorMessage" role="alert" :class="['rounded px-3 py-2 text-sm whitespace-pre-wrap mono', detail.data.value.state === 'failed' ? 'state-failed' : 'state-interrupted']">
            <!-- A case waiting to rerun has not ended: the error is the reason it went back to the queue. -->
            <span v-if="detail.data.value.state === 'requeued'" :class="['font-sans font-medium']" data-testid="case-waiting">{{ t('cases.case.waitingToRerun', { index: (detail.data.value.rounds.at(-1)?.tries.at(-1)?.requeueIndex ?? 0) + 1, total: detail.data.value.rounds.at(-1)?.requeue ?? '?' }) }}</span><span v-if="detail.data.value.errorName" :class="['font-semibold']">{{ detail.data.value.errorName }}: </span>{{ detail.data.value.errorMessage }}
          </div>
          <section class="card">
            <h2 :class="['card-title flex-wrap']">
              <span class="i-mingcute-chart-horizontal-2-line" aria-hidden="true" />{{ t('cases.case.roundsAndRetries') }}
              <span class="text-xs muted font-normal">{{ t('cases.case.roundsCount', { n: detail.data.value.rounds.length }, detail.data.value.rounds.length) }} · {{ t('cases.case.triesCount', { n: tryCount }, tryCount) }}</span>
            </h2>
            <StateView :error="timeline.error.value" :loading="timeline.isPending.value" :empty="timeline.data.value?.entries.length === 0" skeleton="lines" :skeleton-count="2" @retry="timeline.refetch()">
              <div class="p-3">
                <CaseTimeline v-if="timeline.data.value" :timeline="timeline.data.value" />
              </div>
            </StateView>
          </section>
          <div :class="['grid gap-4']" style="grid-template-columns: repeat(auto-fit, minmax(min(380px, 100%), 1fr))">
            <section class="card">
              <h2 class="card-title">
                <span class="i-mingcute-file-import-line" aria-hidden="true" />{{ t('cases.case.input') }}
              </h2>
              <div :class="['p-3 overflow-auto max-h-96']">
                <ObjectTree v-if="detail.data.value.input !== undefined" :value="detail.data.value.input" />
                <span v-else class="text-sm muted">{{ t('cases.case.noInput') }}</span>
              </div>
            </section>
            <section class="card">
              <h2 class="card-title">
                <span class="i-mingcute-file-export-line" aria-hidden="true" />{{ t('cases.case.output') }}
              </h2>
              <div :class="['p-3 overflow-auto max-h-96']">
                <ObjectTree v-if="detail.data.value.output !== undefined" :value="detail.data.value.output" />
                <span v-else class="text-sm muted">{{ t('cases.case.noOutput') }}</span>
              </div>
            </section>
          </div>
          <section class="card">
            <h2 class="card-title">
              <span class="i-mingcute-dashboard-3-line" aria-hidden="true" />{{ t('cases.case.scoresAndMetrics') }} <span class="text-xs muted font-normal">{{ caseScores.length + detail.data.value.metrics.length }}</span>
            </h2>
            <StateView :empty="detail.data.value.metrics.length === 0 && caseScores.length === 0" :empty-text="t('cases.case.emptyScores')">
              <div :class="['overflow-auto max-h-96']">
                <table class="w-full">
                  <tbody>
                    <!-- Scores first, as percentages; the badges above open what graded them. -->
                    <tr v-for="score in caseScores" :key="`score:${score.name}`" :class="['border-b border-neutral-100/70 dark:border-neutral-900', 'max-md:(flex flex-wrap items-baseline py-1)']" data-testid="case-score-row">
                      <td :class="['td mono text-xs muted whitespace-nowrap max-md:hidden']">
                        {{ t('cases.case.score') }}
                      </td>
                      <td :class="['td text-xs whitespace-nowrap', definitions.get(score.name)?.label == null && 'mono', 'max-md:(flex-1 min-w-0 truncate py-0.5 font-medium)']">
                        <MetricInfo :name="score.name" :definition="definitions.get(score.name)" :values="taskValuesOf(score.name)" :current="detail.data.value.scores.values[score.name]">
                          <span :class="['cursor-help']">{{ labelOf(score.name) }}</span>
                        </MetricInfo>
                      </td>
                      <td :class="['td mono text-xs break-all', 'max-md:(order-last basis-full py-0.5)']">
                        {{ score.text }}
                      </td>
                      <td :class="['td mono muted text-xs whitespace-nowrap', 'max-md:py-0.5']">
                        {{ t('cases.round', { n: detail.data.value.rounds.at(-1)?.roundIndex ?? 0 }) }}
                      </td>
                    </tr>
                    <!-- Phones: name and round on one line, the value below it at full width. -->
                    <tr v-for="metric in detail.data.value.metrics" :key="metric.seq" :class="['border-b border-neutral-100/70 dark:border-neutral-900', 'max-md:(flex flex-wrap items-baseline py-1)']">
                      <td :class="['td mono text-xs muted whitespace-nowrap max-md:hidden']">
                        {{ formatTime(metric.time) }}
                      </td>
                      <td :class="['td text-xs whitespace-nowrap', definitions.get(metric.name)?.label == null && 'mono', 'max-md:(flex-1 min-w-0 truncate py-0.5 font-medium)']">
                        <MetricInfo :name="metric.name" :definition="definitions.get(metric.name)" :values="taskValuesOf(metric.name)" :current="typeof metric.value === 'number' || typeof metric.value === 'string' ? metric.value : typeof metric.value === 'boolean' ? String(metric.value) : undefined">
                          <span :class="['cursor-help']">{{ labelOf(metric.name) }}</span>
                        </MetricInfo>
                      </td>
                      <td :class="['td mono text-xs break-all', 'max-md:(order-last basis-full py-0.5)']">
                        {{ previewValue(metric.value, 200) }}
                      </td>
                      <td :class="['td mono muted text-xs whitespace-nowrap', 'max-md:py-0.5']">
                        {{ t('cases.round', { n: metric.roundIndex ?? 0 }) }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </StateView>
          </section>
        </div>

        <section v-else-if="tab === 'logs'" class="card">
          <LogView :load="loadLogs" :follow="running" />
        </section>

        <section v-else-if="tab === 'artifacts'" :class="['card p-3']">
          <ArtifactsPanel :artifacts="detail.data.value.artifacts" :run-key="props.route.runKey" />
        </section>

        <template v-else-if="tab === 'evidence'">
          <StateView :empty="detail.data.value.evidence.length === 0" :empty-text="t('cases.case.emptyEvidence')" :empty-hint="t('cases.case.emptyEvidenceHint')">
            <EvidencePanel :links="detail.data.value.evidence" :run-key="props.route.runKey" :case-ref="ref" />
          </StateView>
        </template>

        <StateView v-else-if="tab === 'inference'" :empty="detail.data.value.inference.length === 0" :empty-text="t('cases.case.emptyInference')" :empty-hint="t('cases.case.emptyInferenceHint')">
          <InferencePanel :events="detail.data.value.inference" :grader="props.route.grader" @clear-grader="navigate({ ...props.route, grader: undefined })" />
        </StateView>
      </ViewTabs>
    </template>
  </StateView>
</template>
