<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'

import type { RunListItem } from '../../../src/shared/contract'
import type { BarDatum } from '../components/BarChart.vue'
import type { BesideTarget } from '../components/MetricBesideCard.vue'
import type { Route } from '../router'

import { useQuery } from '@pinia/colada'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useIntervalFn, useMediaQuery, useTimestamp } from '@vueuse/core'
import { DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItemIndicator, DropdownMenuPortal, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import { computed, shallowRef, toRef, useTemplateRef, watch } from 'vue'

import AnimatedContent from '../components/AnimatedContent.vue'
import BarChart from '../components/BarChart.vue'
import CaseMetricsPanel from '../components/CaseMetricsPanel.vue'
import CountsBar from '../components/CountsBar.vue'
import MetricBesideCard from '../components/MetricBesideCard.vue'
import PageHeader from '../components/PageHeader.vue'
import ScoreBar from '../components/ScoreBar.vue'
import StateBadge from '../components/StateBadge.vue'
import StateView from '../components/StateView.vue'

import { api } from '../api'
import { buildCaseTable, metricDefinition, metricLabel } from '../caseMetrics'
import { useRunLive } from '../composables/useRunLive'
import { useStatusFavicon } from '../composables/useStatusFavicon'
import { formatDuration, formatScore, formatTick, formatTime } from '../format'
import { levelIcons } from '../hierarchy'
import { href } from '../router'
import { runSwitcherOptions } from '../switcher'

/**
 * One task (a matrix row of an eval entry): matrix values, scores per auto-attempt round, and all its cases.
 */
const props = defineProps<{ route: Extract<Route, { name: 'task' }>, run?: RunListItem }>()

const live = useRunLive(toRef(() => props.route.runKey))
// The tab follows the run, like the run page: a task page is one step into the same run.
useStatusFavicon(() => live.snapshot.value?.state)
const task = computed(() => live.snapshot.value?.tasks.find(item => item.id === props.route.taskId))
const timeline = useQuery({
  key: () => ['runs', props.route.runKey, 'task', props.route.taskId, 'timeline'],
  query: () => api.timeline(props.route.runKey, { taskId: props.route.taskId }),
})
// The run advanced: re-read the same entry, so the rounds keep showing meanwhile.
watch(live.refreshKey, () => void timeline.refetch())
const rounds = computed(() => timeline.data.value?.rounds.find(item => item.taskId === props.route.taskId)?.rounds ?? [])
const roundChart = computed<BarDatum[]>(() => rounds.value.map(round => ({ label: `round ${round.roundIndex}`, values: [round.passed / Math.max(1, round.passed + round.failed + round.running)] })))

const filter = shallowRef('')
/** Cases picked in the case metrics charts; `undefined` while nothing is picked there. Clearing it clears the charts. */
const picked = shallowRef<ReadonlySet<string>>()

// The same query as the case metrics panel (one cache entry): the list shows and sorts by the cases' metrics.
const metrics = useQuery({
  key: () => ['runs', props.route.runKey, 'task', props.route.taskId, 'metrics'],
  query: () => api.metrics(props.route.runKey, { taskId: props.route.taskId }),
})
watch(live.refreshKey, () => void metrics.refetch())
const table = computed(() => buildCaseTable(task.value?.cases ?? [], metrics.data.value))
const rowsByKey = computed(() => new Map(table.value.rows.map(row => [row.key, row])))
const definitions = computed(() => new Map((metrics.data.value?.definitions ?? []).map(definition => [definition.name, definition])))
const labelOf = (name: string) => metricLabel(name, definitions.value)

/** Built-in values the list always shows (state, exact, duration) or that no column needs. */
const BUILT_IN_COLUMNS = new Set(['duration_s', 'exact', 'group', 'judge', 'state'])
/**
 * Metrics the list can show as columns: every string metric (a stratum, but also a case id with a value per case, too
 * many values for a chart axis) and every numeric one, as long as it is not the same for every case (a matrix value of
 * the task).
 */
const columnOptions = computed(() => [
  ...new Set(table.value.rows.flatMap(row => Object.keys(row.categories))),
  ...table.value.groups.flatMap(group => [group.representative, ...group.members.map(member => member.name)]),
].filter(name => !BUILT_IN_COLUMNS.has(name) && new Set(table.value.rows.map(row => row.numbers[name] ?? row.categories[name])).size > 1))
const pickedColumns = shallowRef<string[]>([])
/** The column option under the pointer or the keyboard, described beside the open menu. */
const highlightedColumn = shallowRef<BesideTarget>()
const columnMenu = useTemplateRef<ComponentPublicInstance>('columnMenu')
const columnMenuElement = computed(() => (columnMenu.value?.$el instanceof HTMLElement ? columnMenu.value.$el : undefined))
const valuesOf = (name: string) => table.value.rows.map(row => row.numbers[name] ?? row.categories[name])
/** Columns on the list, in the order of the options; past the width of the card, the list scrolls sideways. */
const columns = computed(() => columnOptions.value.filter(name => pickedColumns.value.includes(name)))
/** Width of one metric column and of the name with the score; a row needs at least their sum on wide screens. */
const COLUMN_PX = 112
const ROW_BASE_PX = 480
const rowMinWidth = computed(() => (columns.value.length === 0 ? undefined : `${ROW_BASE_PX + columns.value.length * COLUMN_PX}px`))
/**
 * Order of the list: as recorded, by score, by duration, or by a numeric column. Cases without the value go last
 * either way, so "lowest first" never opens on cases that have no score.
 */
type SortKey = 'duration:desc' | 'exact:asc' | 'exact:desc' | 'index' | `metric:${string}:asc` | `metric:${string}:desc`
/** Phones put the picked columns on the line under the name, after the score. */
function columnLine(key: string): string {
  return columns.value.map(name => `${labelOf(name)} ${columnValue(key, name)}`).join(' · ')
}

function columnValue(key: string, name: string): string {
  const row = rowsByKey.value.get(key)
  const value = row?.numbers[name] ?? row?.categories[name]
  return value == null ? '—' : typeof value === 'number' ? formatTick(value) : value
}
const sortKey = shallowRef<SortKey>('index')
const sortOptions = computed<{ label: string, value: SortKey }[]>(() => [
  { label: 'Recorded order', value: 'index' },
  { label: 'Score, lowest first', value: 'exact:asc' },
  { label: 'Score, highest first', value: 'exact:desc' },
  { label: 'Duration, longest first', value: 'duration:desc' },
  ...columns.value.filter(name => table.value.groups.some(group => group.representative === name || group.members.some(member => member.name === name))).flatMap(name => [
    { label: `${labelOf(name)}, lowest first`, value: `metric:${name}:asc` as const },
    { label: `${labelOf(name)}, highest first`, value: `metric:${name}:desc` as const },
  ]),
])
const sortLabel = computed(() => sortOptions.value.find(option => option.value === sortKey.value)?.label ?? 'Recorded order')
function sortValue(node: { durationMs?: number, key: string, scores: { exact?: number } }): number | undefined {
  const key = sortKey.value
  if (key.startsWith('exact'))
    return node.scores.exact
  if (key.startsWith('duration'))
    return node.durationMs
  if (key.startsWith('metric:'))
    return rowsByKey.value.get(node.key)?.numbers[key.slice('metric:'.length, key.lastIndexOf(':'))]
  return undefined
}

const cases = computed(() => {
  const list = (task.value?.cases ?? []).filter(node => (picked.value == null || picked.value.has(node.key)) && node.name.toLowerCase().includes(filter.value.toLowerCase()))
  if (sortKey.value === 'index')
    return list
  const direction = sortKey.value.endsWith(':desc') ? -1 : 1
  return list.toSorted((a, b) => {
    const left = sortValue(a)
    const right = sortValue(b)
    if (left == null || right == null)
      return left == null ? (right == null ? a.index - b.index : 1) : -1
    return (left - right) * direction || a.index - b.index
  })
})
// Once per second: running cases show how long they have run, in whole seconds.
const now = useTimestamp({ scheduler: callback => useIntervalFn(callback, 1000) })

/** Narrow screens put the score and duration of a case under its name (fixed row heights, see `ExecutionTree`). */
const wide = useMediaQuery('(min-width: 768px)')
const scroller = useTemplateRef<HTMLElement>('scroller')
const virtualizer = useVirtualizer(computed(() => ({ count: cases.value.length, estimateSize: () => (wide.value ? 32 : 54), getScrollElement: () => scroller.value ?? null, overscan: 10 })))
// NOTICE: TanStack Virtual keeps cached sizes when only `estimateSize` changes; `measure()` drops them.
// Removal condition: none while the row height depends on the screen width.
watch(wide, () => virtualizer.value.measure())

const position = computed(() => ({
  attempt: props.run?.attemptId,
  experiment: props.run?.experimentId,
  project: props.run?.projectSegment,
  runKey: props.route.runKey,
  taskId: props.route.taskId,
  taskName: task.value?.displayName,
  workspace: props.run?.workspaceId,
}))
</script>

<template>
  <PageHeader :loading="!live.snapshot.value && !live.error.value" :siblings="runSwitcherOptions(live.snapshot.value, 'task')" level="task" :position="position" :title="task?.displayName ?? props.route.taskId" :subtitle="task?.entryId" />
  <StateView :error="live.error.value" :loading="!live.snapshot.value" :empty="live.snapshot.value != null && task == null" empty-text="This run has no such task (yet)" skeleton="task" @retry="live.reload">
    <template v-if="task">
      <section :class="['card p-3 mb-4 flex flex-wrap gap-x-8 gap-y-2 text-sm', 'max-md:(gap-x-6 gap-y-3)']">
        <div>
          <div class="text-xs muted">
            State
          </div><StateBadge :state="task.state" />
        </div>
        <div v-for="(value, key) in { ...task.matrix?.run, ...task.matrix?.eval }" :key="key">
          <div class="text-xs muted">
            matrix · {{ key }}
          </div><b>{{ value }}</b>
        </div>
        <div>
          <div class="text-xs muted">
            Executor
          </div><span>{{ task.inferenceExecutorId ?? '—' }}</span>
        </div>
        <div>
          <div class="text-xs muted">
            {{ task.scores.judge == null ? 'Exact' : 'Exact / judge / hybrid' }}
          </div><b class="tabular-nums">{{ formatScore(task.scores.exact) }}<template v-if="task.scores.judge != null"> / {{ formatScore(task.scores.judge) }} / {{ formatScore(task.scores.hybrid) }}</template></b>
        </div>
        <!-- Where the mean comes from: how many cases scored what. -->
        <div v-if="task.cases.some(node => node.scores.exact != null)" :class="['min-w-40 max-md:(min-w-0 w-full)']">
          <div class="text-xs muted">
            Scores per case
          </div>
          <div :class="['flex items-center h-6']">
            <ScoreBar :class="['w-full']" :scores="task.cases.map(node => node.scores.exact)" />
          </div>
        </div>
        <div :class="['min-w-64 max-md:(min-w-0 w-full)']">
          <div class="text-xs muted">
            Cases ({{ task.caseTotal ?? '?' }} expected)
          </div>
          <!-- On the values' line (counts in the tooltip); gray is the expected cases that did not start yet. -->
          <div :class="['flex items-center h-6']">
            <CountsBar :class="['w-full']" :counts="{ ...task.caseCounts, total: task.caseTotal ?? task.caseCounts.total }" />
          </div>
        </div>
        <div>
          <div class="text-xs muted">
            Rounds (auto attempts)
          </div><b class="tabular-nums">{{ task.roundCount }}</b><span v-if="task.autoAttemptMax != null" class="muted"> of {{ task.autoAttemptMax + 1 }}</span>
        </div>
      </section>

      <section v-if="rounds.length > 1" :class="['card mb-4']">
        <h2 class="card-title">
          <span :class="levelIcons.round" aria-hidden="true" />Rounds
        </h2>
        <div :class="['grid gap-4 p-3 grid-cols-1 md:grid-cols-2']">
          <table :class="['w-full']">
            <tbody>
              <tr v-for="round in rounds" :key="round.roundIndex" :class="['border-b border-neutral-100/70 dark:border-neutral-900 text-sm']">
                <td class="td">
                  round {{ round.roundIndex }}
                </td>
                <td :class="['td mono text-xs']">
                  <span :class="['inline-flex items-center gap-1.5']">
                    <span :class="['inline-flex items-center gap-0.5', '[color:var(--ink-passed)]']">{{ round.passed }}<span class="i-mingcute-check-line" aria-label="passed" /></span>
                    <span :class="['inline-flex items-center gap-0.5', '[color:var(--ink-failed)]']">{{ round.failed }}<span class="i-mingcute-close-line" aria-label="failed" /></span>
                    <span v-if="round.errored" :class="['inline-flex items-center gap-0.5', '[color:var(--ink-errored)]']">{{ round.errored }}<span class="i-mingcute-alert-octagon-line" aria-label="no result" /></span>
                    <span v-if="round.running" :class="['inline-flex items-center gap-0.5', '[color:var(--ink-running)]']">{{ round.running }}<span class="i-mingcute-loading-line" aria-label="running" /></span>
                  </span>
                </td>
                <td :class="['td mono text-xs muted']">
                  {{ formatTime(round.startedAt) }} → {{ formatTime(round.endedAt) }}
                </td>
              </tr>
            </tbody>
          </table>
          <BarChart :data="roundChart" :series="['pass rate']" />
        </div>
      </section>

      <CaseMetricsPanel v-model:selection="picked" :cases="task.cases" :refresh-key="live.refreshKey.value" :run-key="props.route.runKey" :task-id="props.route.taskId" />

      <section :class="['card']">
        <h2 :class="['card-title flex-wrap']">
          <span :class="levelIcons.case" aria-hidden="true" />Cases <span class="text-xs muted font-normal">{{ cases.length }}</span>
          <!-- The charts' selection narrows the list; the chip says so and clears it there too. -->
          <button v-if="picked" type="button" :class="['btn btn-active text-xs py-0.5! font-normal']" data-testid="case-list-picked" @click="picked = undefined">
            <span class="i-mingcute-filter-line" aria-hidden="true" />{{ picked.size }} picked in the charts<span class="i-mingcute-close-line" aria-label="Clear the selection" />
          </button>
          <span :class="['flex flex-wrap items-center gap-2 ml-auto font-normal', 'max-md:(w-full ml-0)']">
            <DropdownMenuRoot>
              <DropdownMenuTrigger :class="['option-trigger text-xs! py-1!']" data-testid="case-list-sort">
                <span class="muted">Sort</span><span :class="['truncate max-w-48']">{{ sortLabel }}</span><span class="i-mingcute-down-line muted" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent as-child align="end" :side-offset="6" :collision-padding="12" :class="['floating min-w-52 p-1 text-sm']">
                  <AnimatedContent>
                    <DropdownMenuRadioGroup v-model="sortKey" :class="['max-h-[min(24rem,var(--reka-dropdown-menu-content-available-height))] overflow-y-auto']">
                      <DropdownMenuRadioItem v-for="option in sortOptions" :key="option.value" :value="option.value" :class="['menu-item']">
                        <span :class="['size-4 shrink-0 grid place-items-center']">
                          <DropdownMenuItemIndicator><span class="i-mingcute-check-line" aria-hidden="true" /></DropdownMenuItemIndicator>
                        </span>
                        <span :class="['truncate']">{{ option.label }}</span>
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </AnimatedContent>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>
            <DropdownMenuRoot v-if="columnOptions.length > 0" @update:open="open => { if (!open) highlightedColumn = undefined }">
              <DropdownMenuTrigger :class="['option-trigger text-xs! py-1!']" data-testid="case-list-columns">
                <span class="muted">Columns</span><span :class="['tabular-nums']">{{ columns.length }}</span><span class="i-mingcute-down-line muted" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent as-child align="end" :side-offset="6" :collision-padding="12" :class="['floating min-w-52 p-1 text-sm']">
                  <AnimatedContent ref="columnMenu">
                    <div :class="['max-h-[min(24rem,var(--reka-dropdown-menu-content-available-height))] overflow-y-auto']">
                      <DropdownMenuCheckboxItem
                        v-for="name in columnOptions" :key="name" :class="['menu-item']"
                        :model-value="pickedColumns.includes(name)"
                        @select.prevent
                        @focus="(event: FocusEvent) => highlightedColumn = { item: event.currentTarget as Element, name }"
                        @update:model-value="on => pickedColumns = on ? [...pickedColumns, name] : pickedColumns.filter(item => item !== name)"
                      >
                        <span :class="['size-4 shrink-0 grid place-items-center']">
                          <DropdownMenuItemIndicator><span class="i-mingcute-check-line" aria-hidden="true" /></DropdownMenuItemIndicator>
                        </span>
                        <span :class="['truncate']" :title="name">{{ labelOf(name) }}</span>
                      </DropdownMenuCheckboxItem>
                    </div>
                  </AnimatedContent>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>
            <MetricBesideCard :anchor="columnMenuElement" :target="highlightedColumn" :definition-of="name => metricDefinition(name, definitions)" :values-of="valuesOf" />
            <input v-model="filter" type="search" placeholder="Filter cases…" :class="['rounded border border-neutral-300/60 dark:border-neutral-700/40 bg-transparent px-2 py-0.5 text-xs font-normal w-56', 'max-md:(flex-1 py-1)']">
          </span>
        </h2>
        <StateView :empty="cases.length === 0" empty-text="No cases">
          <div ref="scroller" :class="['overflow-auto max-h-[60vh] max-md:max-h-[70vh]']">
            <!-- Column titles scroll sideways with the rows and stay on top while the list scrolls down (wide screens). -->
            <div v-if="columns.length > 0" :class="['sticky top-0 z-1 flex items-center gap-x-2 px-3 py-1 text-xs muted bg-white dark:bg-neutral-900 border-b border-neutral-100/70 dark:border-neutral-900', 'max-md:hidden']" :style="{ minWidth: rowMinWidth }">
              <span :class="['flex-1']" />
              <span v-for="name in columns" :key="name" :class="['shrink-0 truncate text-right']" :style="{ width: `${COLUMN_PX}px` }" :title="name">{{ labelOf(name) }}</span>
              <span :class="['w-36 shrink-0 text-right']">exact · duration</span>
            </div>
            <div :style="{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', minWidth: wide ? rowMinWidth : undefined }">
              <a
                v-for="item in virtualizer.getVirtualItems()" :key="cases[item.index]!.key"
                :href="href({ caseId: cases[item.index]!.caseId, name: 'case', runKey: props.route.runKey, taskId: props.route.taskId })"
                :class="['absolute left-0 right-0 flex items-center gap-x-2 px-3 text-sm border-b border-neutral-100/70 dark:border-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800/50', 'max-md:(grid grid-cols-[auto_auto_minmax(0,1fr)] content-center gap-y-1)', cases[item.index]!.state === 'running' && 'bg-blue-50 dark:bg-blue-950/40']"
                :style="{ height: `${item.size}px`, transform: `translateY(${item.start}px)` }"
              >
                <span :class="['text-xs muted mono text-right w-10 shrink-0', 'max-md:(w-auto min-w-5)']">{{ cases[item.index]!.index + 1 }}</span>
                <StateBadge :state="cases[item.index]!.state" icon-only />
                <span :class="['flex items-center gap-2 min-w-0']">
                  <span :class="['text-xs max-md:text-[13px] link mono truncate']">{{ cases[item.index]!.name }}</span>
                  <span v-if="cases[item.index]!.rounds.length > 1" class="badge state-neutral">{{ cases[item.index]!.rounds.length }} rounds</span>
                  <span v-if="(cases[item.index]!.rounds.at(-1)?.tries.length ?? 1) > 1" class="badge state-interrupted">{{ cases[item.index]!.rounds.at(-1)!.tries.length - 1 }} {{ cases[item.index]!.rounds.at(-1)!.tries.length === 2 ? 'retry' : 'retries' }}</span>
                </span>
                <span v-for="name in columns" :key="name" :class="['shrink-0 truncate text-right text-xs mono', 'max-md:hidden', name === columns[0] && 'ml-auto']" :style="{ width: `${COLUMN_PX}px` }" :title="columnValue(cases[item.index]!.key, name)">{{ columnValue(cases[item.index]!.key, name) }}</span>
                <!-- Phones: under the name (third grid column), aligned with it, with the picked columns after the score. -->
                <span :class="['text-xs muted mono whitespace-nowrap', columns.length === 0 ? 'ml-auto' : 'w-36 shrink-0 text-right', 'max-md:(col-start-3 ml-0 w-auto text-left truncate)']" :title="columns.length > 0 ? columnLine(cases[item.index]!.key) : undefined"><template v-if="cases[item.index]!.state === 'running'"><span class="[color:var(--ink-running)]">running {{ formatDuration(Math.max(0, now - Date.parse(cases[item.index]!.rounds.at(-1)?.startedAt ?? cases[item.index]!.startedAt))) }}</span></template><template v-else>exact {{ formatScore(cases[item.index]!.scores.exact) }} · {{ formatDuration(cases[item.index]!.durationMs) }}<span v-if="!wide && columns.length > 0"> · {{ columnLine(cases[item.index]!.key) }}</span></template></span>
              </a>
            </div>
          </div>
        </StateView>
      </section>
    </template>
  </StateView>
</template>
