<script setup lang="ts">
import type { RunListItem } from '../../../src/shared/contract'
import type { BarDatum } from '../components/BarChart.vue'
import type { Route } from '../router'

import { useQuery } from '@pinia/colada'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useIntervalFn, useMediaQuery, useTimestamp } from '@vueuse/core'
import { computed, shallowRef, toRef, useTemplateRef, watch } from 'vue'

import BarChart from '../components/BarChart.vue'
import CountsBar from '../components/CountsBar.vue'
import PageHeader from '../components/PageHeader.vue'
import StateBadge from '../components/StateBadge.vue'
import StateView from '../components/StateView.vue'

import { api } from '../api'
import { useRunLive } from '../composables/useRunLive'
import { formatDuration, formatScore, formatTime } from '../format'
import { levelIcons } from '../hierarchy'
import { href } from '../router'
import { runSwitcherOptions } from '../switcher'

/**
 * One task (a matrix row of an eval entry): matrix values, scores per auto-attempt round, and all its cases.
 */
const props = defineProps<{ route: Extract<Route, { name: 'task' }>, run?: RunListItem }>()

const live = useRunLive(toRef(() => props.route.runKey))
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
const cases = computed(() => (task.value?.cases ?? []).filter(node => node.name.toLowerCase().includes(filter.value.toLowerCase())))
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
            Exact / judge / hybrid
          </div><b class="tabular-nums">{{ formatScore(task.scores.exact) }} / {{ formatScore(task.scores.judge) }} / {{ formatScore(task.scores.hybrid) }}</b>
        </div>
        <div :class="['min-w-64 max-md:(min-w-0 w-full)']">
          <div class="text-xs muted">
            Cases ({{ task.caseTotal ?? '?' }} expected)
          </div><CountsBar :counts="task.caseCounts" labels="below" />
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
                    <span :class="['inline-flex items-center gap-0.5', 'text-green-700 dark:text-green-400']">{{ round.passed }}<span class="i-mingcute-check-line" aria-label="passed" /></span>
                    <span :class="['inline-flex items-center gap-0.5', 'text-red-700 dark:text-red-400']">{{ round.failed }}<span class="i-mingcute-close-line" aria-label="failed" /></span>
                    <span v-if="round.running" :class="['inline-flex items-center gap-0.5', 'text-blue-700 dark:text-blue-400']">{{ round.running }}<span class="i-mingcute-loading-line" aria-label="running" /></span>
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

      <section :class="['card']">
        <h2 :class="['card-title flex-wrap']">
          <span :class="levelIcons.case" aria-hidden="true" />Cases <span class="text-xs muted font-normal">{{ cases.length }}</span>
          <input v-model="filter" type="search" placeholder="Filter cases…" :class="['ml-auto rounded border border-neutral-300/60 dark:border-neutral-700/40 bg-transparent px-2 py-0.5 text-xs font-normal w-56', 'max-md:(w-full ml-0 py-1)']">
        </h2>
        <StateView :empty="cases.length === 0" empty-text="No cases">
          <div ref="scroller" :class="['overflow-auto max-h-[60vh] max-md:max-h-[70vh]']">
            <div :style="{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }">
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
                <!-- Phones: under the name (third grid column), aligned with it. -->
                <span :class="['text-xs muted mono ml-auto whitespace-nowrap', 'max-md:(col-start-3 ml-0)']"><template v-if="cases[item.index]!.state === 'running'"><span class="text-blue-700 dark:text-blue-300">running {{ formatDuration(Math.max(0, now - Date.parse(cases[item.index]!.rounds.at(-1)?.startedAt ?? cases[item.index]!.startedAt))) }}</span></template><template v-else>exact {{ formatScore(cases[item.index]!.scores.exact) }} · {{ formatDuration(cases[item.index]!.durationMs) }}</template></span>
              </a>
            </div>
          </div>
        </StateView>
      </section>
    </template>
  </StateView>
</template>
