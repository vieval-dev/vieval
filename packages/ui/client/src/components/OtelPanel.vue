<script setup lang="ts">
import type { OtelSpan, RunSnapshot } from '../../../src/shared/contract'
import type { LinePoint } from './LineChart.vue'
import type { ViewTab } from './ViewTabs.vue'

import { useQuery } from '@pinia/colada'
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import LineChart from './LineChart.vue'
import ObjectTree from './ObjectTree.vue'
import SegmentedControl from './SegmentedControl.vue'
import StateBadge from './StateBadge.vue'
import StateView from './StateView.vue'
import ViewTabs from './ViewTabs.vue'

import { api } from '../api'
import { extent } from '../extent'
import { formatDuration, formatTime } from '../format'
import { levelLabel } from '../hierarchy'

/**
 * Simple OpenTelemetry views of a run, rebuilt from its events by the server: a span waterfall
 * (`run → project → task → round → case → try`), log records, and gauges. Also shows the raw `otlp/*.json`
 * vieval wrote when the run ended.
 *
 * Limits (also in the package README): no OTLP receiver, no user-defined spans, no cross-process traces, no
 * sampling or querying.
 */
const props = defineProps<{
  /** Changes when the run advanced, at most once per refetch interval (`useRunLive().refreshKey`). */
  refreshKey: number | undefined
  snapshot: RunSnapshot
}>()
const { t } = useI18n()
const runKey = computed(() => props.snapshot.runKey)
type Tab = 'logs' | 'metrics' | 'raw' | 'traces'
const tab = shallowRef<Tab>('traces')
const tabItems = computed<ViewTab<Tab>[]>(() => (['traces', 'logs', 'metrics', 'raw'] as const).map(value => ({ label: t(`runs.otel.tabs.${value}`), value })))

const traces = useQuery({ key: () => ['runs', runKey.value, 'otel', 'traces'], query: () => api.otelTraces(runKey.value) })
const logs = useQuery({ key: () => ['runs', runKey.value, 'otel', 'logs'], query: () => api.otelLogs(runKey.value) })
const gauges = useQuery({ key: () => ['runs', runKey.value, 'otel', 'metrics'], query: () => api.otelMetrics(runKey.value) })
// The run advanced: re-read the same entries, so the panels keep showing the previous data meanwhile.
watch(() => props.refreshKey, () => {
  void traces.refetch()
  void logs.refetch()
  void gauges.refetch()
})
const rawSignal = shallowRef<'logs' | 'metrics' | 'traces'>('traces')
const raw = useQuery({ key: () => ['runs', runKey.value, 'otel', 'raw', rawSignal.value], query: () => api.otelRaw(runKey.value, rawSignal.value) })

/** Spans in tree order with depth, and their position on the run's time axis. */
const waterfall = computed(() => {
  const spans = traces.data.value?.spans ?? []
  const children = new Map<string | undefined, OtelSpan[]>()
  for (const span of spans) {
    const siblings = children.get(span.parentSpanId)
    if (siblings == null)
      children.set(span.parentSpanId, [span])
    else
      siblings.push(span)
  }
  const start = extent(spans.map(span => Date.parse(span.startTime ?? '')).filter(Number.isFinite)).min
  const end = Math.max(extent(spans.map(span => Date.parse(span.endTime ?? span.startTime ?? '')).filter(Number.isFinite)).max, Date.now() * (props.snapshot.state === 'running' ? 1 : 0))
  const list: Array<{ depth: number, left: number, span: OtelSpan, width: number }> = []
  const visit = (parent: string | undefined, depth: number) => {
    for (const span of children.get(parent) ?? []) {
      const from = Date.parse(span.startTime ?? '')
      const to = span.endTime == null ? end : Date.parse(span.endTime)
      list.push({ depth, left: ((from - start) / (end - start || 1)) * 100, span, width: Math.max(0.3, ((to - from) / (end - start || 1)) * 100) })
      visit(span.spanId, depth + 1)
    }
  }
  visit(undefined, 0)
  return { end, list, start }
})
/** Label of a span: its OTEL name plus the entity it covers (case name, task, round, try). */
function spanLabel(span: OtelSpan): string {
  const attributes = span.attributes
  const detail = attributes['vieval.case.name'] ?? attributes['vieval.task.display_name'] ?? attributes['vieval.project.name']
    ?? (attributes['vieval.round.index'] != null ? t('runs.position.round', { n: String(attributes['vieval.round.index']) }) : undefined)
    ?? (attributes['vieval.case.retry_index'] != null ? t('runs.position.try', { n: Number(attributes['vieval.case.retry_index']) + 1 }) : undefined)
  return detail == null ? span.name : `${span.name} · ${String(detail)}`
}
const spanColors: Record<OtelSpan['kind'], string> = { case: 'var(--series-1)', project: 'var(--series-3)', round: 'var(--series-2)', run: '#737373', task: 'var(--series-3)', try: 'var(--series-2)' }
const gaugeCharts = computed(() => (gauges.data.value?.metrics ?? []).map(metric => ({ name: metric.name, points: metric.dataPoints.map<LinePoint>(point => ({ label: formatTime(point.time), x: Date.parse(point.time), y: point.value })) })))
</script>

<template>
  <section :class="['card']" data-testid="otel-panel">
    <ViewTabs v-model="tab" :items="tabItems" :label="t('runs.otel.tabs.label')" in-card>
      <template #extra>
        <span :class="['ml-auto muted text-xs px-2 whitespace-nowrap max-md:hidden']" :title="t('runs.otel.limitsTitle')">{{ t('runs.otel.limits') }}</span>
      </template>

      <StateView v-if="tab === 'traces'" :error="traces.error.value" :loading="traces.isPending.value" :empty="waterfall.list.length === 0" :empty-text="t('runs.otel.noSpans')" skeleton="lines" @retry="traces.refetch()">
        <div :class="['px-3 py-1.5 text-xs muted']">
          <i18n-t keypath="runs.otel.trace" scope="global">
            <template #id>
              <span class="font-medium">{{ traces.data.value?.traceId }}</span>
            </template>
            <template #spans>
              {{ t('runs.otel.spans', { n: waterfall.list.length }, waterfall.list.length) }}
            </template>
            <template #duration>
              {{ formatDuration(waterfall.end - waterfall.start) }}
            </template>
          </i18n-t>
        </div>
        <div :class="['overflow-auto max-h-[60vh]']">
          <div v-for="row in waterfall.list" :key="row.span.spanId" :class="['flex items-center text-xs h-6 border-b border-neutral-100/70 dark:border-neutral-900']">
            <div :class="['w-40 md:w-96 shrink-0 flex items-center gap-1 truncate pr-2']" :style="{ paddingLeft: `${8 + row.depth * 14}px` }" :title="JSON.stringify(row.span.attributes, null, 2)">
              <StateBadge :state="row.span.status === 'unset' ? 'running' : row.span.status" icon-only />
              <span class="muted">{{ levelLabel(row.span.kind).toLowerCase() }}</span>
              <span class="text-xs mono truncate">{{ spanLabel(row.span) }}</span>
            </div>
            <div :class="['relative flex-1 h-3 mr-3']">
              <div :class="['absolute h-full rounded-sm']" :style="{ left: `${row.left}%`, width: `${row.width}%`, background: row.span.status === 'error' ? '#e34948' : spanColors[row.span.kind] }" :title="`${row.span.name}: ${formatTime(row.span.startTime)} → ${row.span.endTime ? formatTime(row.span.endTime) : t('runs.otel.running')}`" />
            </div>
          </div>
        </div>
      </StateView>

      <StateView v-else-if="tab === 'logs'" :error="logs.error.value" :loading="logs.isPending.value" :empty="logs.data.value?.records.length === 0" :empty-text="t('runs.otel.noLogs')" skeleton="lines" @retry="logs.refetch()">
        <div :class="['overflow-auto max-h-[60vh]']">
          <table :class="['w-full']">
            <tbody>
              <tr v-for="(record, index) in logs.data.value?.records" :key="index" :class="['border-b border-neutral-100/70 dark:border-neutral-900']">
                <td :class="['td mono text-xs muted whitespace-nowrap']">
                  {{ formatTime(record.time) }}
                </td>
                <td class="td">
                  <span :class="['badge', record.severity === 'ERROR' ? 'state-failed' : record.severity === 'WARN' ? 'state-interrupted' : 'state-neutral']">{{ record.severity }}</span>
                </td>
                <td :class="['td mono text-xs break-all whitespace-pre-wrap']">
                  {{ record.body }}
                </td>
                <td :class="['td mono text-xs muted break-all']">
                  {{ record.attributes['vieval.case.id'] ?? '' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </StateView>

      <StateView v-else-if="tab === 'metrics'" :error="gauges.error.value" :loading="gauges.isPending.value" :empty="gaugeCharts.length === 0" :empty-text="t('runs.otel.noGauges')" skeleton="panel" @retry="gauges.refetch()">
        <div :class="['grid gap-4 p-3']" style="grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr))">
          <div v-for="chart in gaugeCharts" :key="chart.name">
            <LineChart :name="t('runs.otel.gauge', { name: chart.name, n: chart.points.length }, chart.points.length)" :points="chart.points" />
          </div>
        </div>
      </StateView>

      <template v-else>
        <div :class="['px-3 py-2']">
          <SegmentedControl v-model="rawSignal" :items="(['traces', 'logs', 'metrics'] as const).map(signal => ({ label: `otlp/${signal}.json`, value: signal }))" :label="t('runs.otel.file')" />
        </div>
        <StateView :error="raw.error.value" :loading="raw.isPending.value" skeleton="lines" @retry="raw.refetch()">
          <div :class="['p-3 overflow-auto max-h-[60vh]']">
            <ObjectTree :value="raw.data.value" :expand-depth="3" />
          </div>
        </StateView>
      </template>
    </ViewTabs>
  </section>
</template>
