<script setup lang="ts">
import type { CaseNode, CaseRound, RunSnapshot } from '../../../src/shared/contract'
import type { Segment } from './SegmentedControl.vue'

import { useVirtualizer } from '@tanstack/vue-virtual'
import { useMediaQuery } from '@vueuse/core'
import { computed, reactive, shallowRef, useTemplateRef, watch } from 'vue'

import IconButton from './IconButton.vue'
import SegmentedControl from './SegmentedControl.vue'
import StateBadge from './StateBadge.vue'

import { formatDuration, formatScore } from '../format'
import { levelIcons, levelLabels } from '../hierarchy'
import { href } from '../router'

/**
 * Live execution tree `run → project → task → round → case → try`, virtualized so tasks with hundreds of cases
 * stay fast. Running cases are highlighted; rows whose state changed since the last update flash once.
 */
const props = defineProps<{ snapshot: RunSnapshot }>()

/** One visible line of the flattened tree. */
interface Row {
  caseNode?: CaseNode
  /** Case counts of a task row, rendered with pass/fail icons before `detail`. */
  counts?: { failed: number, passed: number, running: number, total: number }
  depth: number
  detail?: string
  expandable: boolean
  href?: string
  key: string
  kind: 'case' | 'project' | 'round' | 'task' | 'try'
  label: string
  round?: CaseRound
  running?: boolean
  state: string
}

const open = reactive(new Set<string>())
type Filter = 'all' | 'failed' | 'passed' | 'running'
const filter = shallowRef<Filter>('all')
const filters: Segment<Filter>[] = [{ label: 'all', value: 'all' }, { label: 'running', value: 'running' }, { label: 'failed', value: 'failed' }, { label: 'passed', value: 'passed' }]
const search = shallowRef('')

// Open projects and tasks by default; cases stay closed.
watch(() => props.snapshot, (snapshot) => {
  for (const project of snapshot.projects)
    open.add(`p:${project.id}`)
  for (const task of snapshot.tasks)
    open.add(`t:${task.id}`)
}, { immediate: true })

function matches(state: string, name: string): boolean {
  if (search.value !== '' && !name.toLowerCase().includes(search.value.toLowerCase()))
    return false
  if (filter.value === 'all')
    return true
  if (filter.value === 'failed')
    return state === 'failed' || state === 'timeout' || state === 'unfinished'
  return state === filter.value
}

const rows = computed<Row[]>(() => {
  const list: Row[] = []
  const snapshot = props.snapshot
  const projectIds = snapshot.projects.length > 0 ? snapshot.projects.map(project => project.id) : [...new Set(snapshot.tasks.map(task => task.projectId))]
  for (const projectId of projectIds) {
    const project = snapshot.projects.find(item => item.id === projectId)
    const tasks = snapshot.tasks.filter(task => task.projectId === projectId)
    list.push({ depth: 0, detail: `${tasks.length}${project?.taskCount == null ? '' : ` / ${project.taskCount}`} tasks`, expandable: true, key: `p:${projectId}`, kind: 'project', label: projectId, state: project?.failed || tasks.some(task => task.state === 'failed') ? 'failed' : project?.state ?? 'queued' })
    if (!open.has(`p:${projectId}`))
      continue
    for (const task of tasks) {
      const taskKey = `t:${task.id}`
      list.push({ counts: { failed: task.caseCounts.failed + task.caseCounts.timeout, passed: task.caseCounts.passed, running: task.caseCounts.running, total: task.caseTotal ?? task.cases.length }, depth: 1, detail: `exact ${formatScore(task.scores.exact)}`, expandable: true, href: href({ name: 'task', runKey: snapshot.runKey, taskId: task.id }), key: taskKey, kind: 'task', label: task.displayName, state: task.state })
      if (!open.has(taskKey))
        continue
      const pushCase = (node: CaseNode, depth: number, round: CaseRound | undefined) => {
        const state = round?.state ?? node.state
        if (!matches(state, node.name))
          return
        const caseKey = `c:${node.key}:${round?.roundIndex ?? 'last'}`
        const last = round ?? node.rounds.at(-1)
        const retries = (last?.tries.length ?? 1) - 1
        list.push({
          caseNode: node,
          depth,
          detail: [node.durationMs == null ? undefined : formatDuration(node.durationMs), retries > 0 ? `${retries} retr${retries === 1 ? 'y' : 'ies'}` : undefined, node.rounds.length > 1 && round == null ? `${node.rounds.length} rounds` : undefined, node.artifactCount > 0 ? `${node.artifactCount} artifacts` : undefined, node.evidenceLinkCount > 0 ? 'evidence' : undefined].filter(Boolean).join(' · '),
          expandable: (last?.tries.length ?? 0) > 0,
          href: href({ caseId: node.caseId, name: 'case', runKey: snapshot.runKey, taskId: node.taskId }),
          key: caseKey,
          kind: 'case',
          label: node.name,
          round: last,
          running: state === 'running',
          state,
        })
        if (open.has(caseKey) && last != null) {
          for (const attempt of last.tries)
            list.push({ depth: depth + 1, detail: `${attempt.endedAt == null ? 'running' : formatDuration(Date.parse(attempt.endedAt) - Date.parse(attempt.startedAt))}`, expandable: false, key: `${caseKey}:try:${attempt.retryIndex}`, kind: 'try', label: `try ${attempt.retryIndex + 1}${attempt.retryIndex > 0 ? ` (retry ${attempt.retryIndex})` : ''}`, state: attempt.state })
        }
      }
      if (task.roundCount > 1) {
        for (let roundIndex = 0; roundIndex < task.roundCount; roundIndex += 1) {
          const roundKey = `r:${task.id}:${roundIndex}`
          const inRound = task.cases.flatMap(node => node.rounds.filter(round => round.roundIndex === roundIndex).map(round => ({ node, round })))
          const passed = inRound.filter(item => item.round.state === 'passed').length
          const running = inRound.some(item => item.round.state === 'running')
          list.push({ depth: 2, detail: `${passed}/${inRound.length} passed`, expandable: true, key: roundKey, kind: 'round', label: `round ${roundIndex} (auto attempt)`, state: running ? 'running' : passed === inRound.length ? 'passed' : 'failed' })
          if (open.has(roundKey)) {
            for (const item of inRound)
              pushCase(item.node, 3, item.round)
          }
        }
      }
      else {
        for (const node of task.cases)
          pushCase(node, 2, undefined)
      }
    }
  }
  return list
})

/** Rows whose state changed since the previous snapshot flash once. */
const previous = new Map<string, string>()
const flashing = shallowRef(new Set<string>())
watch(rows, (list) => {
  const changed = new Set<string>()
  for (const row of list) {
    const before = previous.get(row.key)
    if (before != null && before !== row.state)
      changed.add(row.key)
    previous.set(row.key, row.state)
  }
  if (changed.size > 0)
    flashing.value = changed
})

/**
 * Wide screens show a row on one line; narrow screens put the counts and details under the label, so long case names
 * keep most of the width. Rows have a fixed height either way (the list is virtualized without measuring).
 */
const wide = useMediaQuery('(min-width: 768px)')
const scroller = useTemplateRef<HTMLElement>('scroller')
const virtualizer = useVirtualizer(computed(() => ({
  count: rows.value.length,
  estimateSize: () => (wide.value ? 28 : 44),
  getScrollElement: () => scroller.value ?? null,
  overscan: 12,
})))
// NOTICE: TanStack Virtual caches sizes and does not recompute them when only `estimateSize` changes; `measure()`
// drops the cache. Removal condition: none while the row height depends on the screen width.
watch(wide, () => virtualizer.value.measure())

function jumpToCurrent(): void {
  const index = rows.value.findIndex(row => row.running)
  if (index >= 0)
    virtualizer.value.scrollToIndex(index, { align: 'center' })
}

function toggle(key: string): void {
  if (open.has(key))
    open.delete(key)
  else
    open.add(key)
}

const counts = computed(() => props.snapshot.tasks.reduce((sum, task) => sum + task.cases.length, 0))
</script>

<template>
  <section :class="['card flex flex-col']" data-testid="execution-tree">
    <h2 :class="['card-title flex-wrap']">
      <span class="i-mingcute-sitemap-line" aria-hidden="true" />Execution tree
      <span class="text-xs muted font-normal">{{ counts }} cases · {{ rows.length }} rows</span>
      <div :class="['ml-auto flex items-center flex-wrap gap-1 font-normal', 'max-md:w-full']">
        <SegmentedControl v-model="filter" :items="filters" label="Show cases" />
        <input v-model="search" type="search" placeholder="Filter cases…" :class="['rounded border border-neutral-300/60 dark:border-neutral-700/40 bg-transparent px-2 py-0.5 text-xs w-40', 'max-md:(flex-1 min-w-24 py-1)']">
        <IconButton icon="i-mingcute-aiming-2-line" label="Scroll to the first running case" :disabled="!rows.some(row => row.running)" @click="jumpToCurrent" />
      </div>
    </h2>
    <div ref="scroller" :class="['overflow-auto h-[60vh] min-h-64 max-md:h-[70vh]']">
      <div v-if="rows.length === 0" :class="['muted text-sm p-6 text-center']" data-testid="state-empty">
        {{ props.snapshot.tasks.length === 0 ? 'No task started yet.' : 'No case matches the filter.' }}
      </div>
      <div :style="{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }">
        <div
          v-for="item in virtualizer.getVirtualItems()" :key="rows[item.index]!.key"
          :class="[
            'absolute left-0 right-0 flex items-center gap-1.5 pr-3 text-[13px] border-l-2',
            rows[item.index]!.running ? 'border-blue-500/60 bg-blue-50 dark:bg-blue-950/40' : 'border-transparent hover:bg-neutral-50 dark:hover:bg-neutral-800/50',
            flashing.has(rows[item.index]!.key) && 'vv-flash',
          ]"
          :style="{ height: `${item.size}px`, transform: `translateY(${item.start}px)`, paddingLeft: `${(wide ? 8 : 4) + rows[item.index]!.depth * (wide ? 18 : 10)}px` }"
          :data-kind="rows[item.index]!.kind" :data-state="rows[item.index]!.state"
        >
          <button v-if="rows[item.index]!.expandable" type="button" :class="['i-mingcute-right-line shrink-0 muted transition-transform', open.has(rows[item.index]!.key) && 'rotate-90']" :aria-label="`Toggle ${rows[item.index]!.label}`" @click="toggle(rows[item.index]!.key)" />
          <span v-else class="shrink-0 w-[1.1em]" />
          <span :class="[levelIcons[rows[item.index]!.kind], 'shrink-0 muted max-md:hidden']" :title="levelLabels[rows[item.index]!.kind]" aria-hidden="true" />
          <StateBadge :state="rows[item.index]!.state" icon-only />
          <span :class="['flex-1 min-w-0 flex md:items-center max-md:(flex-col justify-center gap-0.5)']">
            <span :class="['flex items-center gap-1.5 min-w-0']">
              <a v-if="rows[item.index]!.href" :href="rows[item.index]!.href" :class="['link truncate', rows[item.index]!.kind !== 'case' && 'font-medium']" :title="rows[item.index]!.label">{{ rows[item.index]!.label }}</a>
              <span v-else :class="['truncate']">{{ rows[item.index]!.label }}</span>
              <span v-if="rows[item.index]!.running" :class="['badge state-running']"><span class="i-mingcute-aiming-2-line" aria-hidden="true" />now</span>
            </span>
            <span :class="['md:(ml-auto pl-2) flex items-center gap-1.5 min-w-0', 'muted mono text-xs whitespace-nowrap max-md:text-[11px]']">
              <template v-if="rows[item.index]!.counts">
                <span :class="['inline-flex items-center gap-0.5', 'text-green-700 dark:text-green-400']" :title="`${rows[item.index]!.counts!.passed} passed`">{{ rows[item.index]!.counts!.passed }}<span class="i-mingcute-check-line" aria-label="passed" /></span>
                <span :class="['inline-flex items-center gap-0.5', 'text-red-700 dark:text-red-400']" :title="`${rows[item.index]!.counts!.failed} failed`">{{ rows[item.index]!.counts!.failed }}<span class="i-mingcute-close-line" aria-label="failed" /></span>
                <span v-if="rows[item.index]!.counts!.running" :class="['inline-flex items-center gap-0.5', 'text-blue-700 dark:text-blue-400']" :title="`${rows[item.index]!.counts!.running} running`">{{ rows[item.index]!.counts!.running }}<span class="i-mingcute-loading-line" aria-label="running" /></span>
                <span>/ {{ rows[item.index]!.counts!.total }} ·</span>
              </template>
              <span :class="['truncate']">{{ rows[item.index]!.detail }}</span>
            </span>
          </span>
        </div>
      </div>
    </div>
  </section>
</template>
