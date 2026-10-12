<script setup lang="ts">
import type { RunListItem } from '../../../src/shared/contract'

import { computed, reactive, watch } from 'vue'

import StateBadge from './StateBadge.vue'
import StateView from './StateView.vue'
import TimeAgo from './TimeAgo.vue'

import { useCatalog } from '../composables/useCatalog'
import { levelIcons } from '../hierarchy'
import { experimentLabel, mergeMatrices, shortRunHash } from '../labels'
import { currentRoute, href } from '../router'

/**
 * Navigation: projects and their experiments (readable names), plus the newest runs with the running ones first.
 *
 * Attempts and runs of an experiment are listed on the experiment page; the tree stays short. A workspace level only
 * appears when there is more than one.
 */
const props = defineProps<{ activeRun?: { attempt: string, experiment: string, project: string, runKey: string, workspace: string } }>()

/** Number of runs in "Recent runs". */
const RECENT_RUNS = 8

const catalog = useCatalog()
const workspaces = catalog.workspaces
const singleWorkspace = computed(() => workspaces.value.length === 1)

const closed = reactive(new Set<string>())
function toggle(key: string): void {
  if (!closed.delete(key))
    closed.add(key)
}

/** Scope of the current page, used to highlight its row and open its project. */
const scope = computed(() => {
  const route = currentRoute.value
  if (route.name === 'scope')
    return { experiment: route.experiment, project: route.project, runKey: undefined, workspace: route.workspace }
  return props.activeRun
})
watch(scope, (value) => {
  if (value?.workspace != null && value.project != null)
    closed.delete(`${value.workspace}/${value.project}`)
}, { immediate: true })

function experimentName(workspace: string, project: string, experiment: string): string {
  return experimentLabel(experiment, catalog.matrixOf({ experiment, project, workspace })).text
}

/** Newest runs, the ones still running (or stale) first. */
const recent = computed(() => {
  const order = (run: RunListItem) => (run.state === 'running' ? 0 : run.state === 'stale' ? 1 : 2)
  return catalog.runs.value.slice(0, 50).toSorted((a, b) => order(a) - order(b)).slice(0, RECENT_RUNS)
})
const recentLabel = (run: RunListItem) => experimentLabel(run.experimentId, mergeMatrices([run.matrix])).text

function rowClass(active: boolean) {
  return [
    'flex items-center gap-1.5 w-full rounded-md px-1.5 py-1 text-left text-[13px] min-w-0 transition-colors',
    active ? 'selected font-medium' : 'hover:bg-neutral-500/8',
  ]
}
</script>

<template>
  <nav aria-label="Projects and runs" :class="['flex flex-col gap-4 text-sm']">
    <StateView :error="catalog.query.error.value" :loading="catalog.query.isPending.value" :empty="workspaces.length === 0" empty-text="No runs found" skeleton="nav" @retry="catalog.query.refetch()">
      <section>
        <h2 :class="['px-1.5 mb-1 text-xs font-medium muted']">
          Projects
        </h2>
        <div v-for="workspace in workspaces" :key="workspace.id">
          <a v-if="!singleWorkspace" :href="href({ name: 'scope', workspace: workspace.id })" :class="rowClass(scope?.workspace === workspace.id && scope?.project == null)">
            <span :class="[levelIcons.workspace, 'muted shrink-0']" aria-hidden="true" /><span class="truncate">{{ workspace.id }}</span>
          </a>
          <div :class="[!singleWorkspace && 'pl-3']">
            <div v-for="project in workspace.projects" :key="project.id">
              <div :class="['flex items-center']">
                <button
                  type="button"
                  :class="['i-mingcute-right-line shrink-0 transition-transform muted', !closed.has(`${workspace.id}/${project.id}`) && 'rotate-90']"
                  :aria-label="`Toggle ${project.id}`"
                  :aria-expanded="!closed.has(`${workspace.id}/${project.id}`)"
                  @click="toggle(`${workspace.id}/${project.id}`)"
                />
                <a :href="href({ name: 'scope', project: project.id, workspace: workspace.id })" :class="rowClass(scope?.workspace === workspace.id && scope?.project === project.id && scope?.experiment == null)">
                  <span :class="[levelIcons.project, 'muted shrink-0']" aria-hidden="true" /><span class="truncate">{{ project.id }}</span>
                </a>
              </div>
              <div v-if="!closed.has(`${workspace.id}/${project.id}`)" :class="['pl-4']">
                <a
                  v-for="experiment in project.experiments"
                  :key="experiment.id"
                  :href="href({ experiment: experiment.id, name: 'scope', project: project.id, workspace: workspace.id })"
                  :class="rowClass(scope?.workspace === workspace.id && scope?.project === project.id && scope?.experiment === experiment.id)"
                  :title="experiment.id"
                >
                  <StateBadge :state="experiment.latest.state" icon-only />
                  <span class="truncate">{{ experimentName(workspace.id, project.id, experiment.id) }}</span>
                  <span :class="['ml-auto text-xs muted tabular-nums']">{{ experiment.attempts.length }}</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 :class="['px-1.5 mb-1 text-xs font-medium muted']">
          Recent runs
        </h2>
        <a
          v-for="run in recent"
          :key="run.runKey"
          :href="href({ name: 'run', runKey: run.runKey })"
          :class="[...rowClass(scope?.runKey === run.runKey), 'items-start']"
          :title="run.runKey"
          data-testid="recent-run"
        >
          <StateBadge :state="run.state" icon-only :class="['mt-0.5']" />
          <span :class="['flex flex-col min-w-0']">
            <span :class="['truncate']">{{ recentLabel(run) }}</span>
            <span :class="['text-xs muted flex gap-1 min-w-0']">
              <span :class="['truncate']">{{ run.projectSegment }}</span>·<TimeAgo :time="run.startedAt" relative-only />·<span class="mono">{{ shortRunHash(run.runKey) }}</span>
            </span>
          </span>
        </a>
      </section>
    </StateView>
  </nav>
</template>
