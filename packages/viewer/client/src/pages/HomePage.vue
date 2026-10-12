<script setup lang="ts">
import type { ProjectEntry } from '../composables/useCatalog'

import { computed } from 'vue'

import CountsBar from '../components/CountsBar.vue'
import PageHeader from '../components/PageHeader.vue'
import StateBadge from '../components/StateBadge.vue'
import StateView from '../components/StateView.vue'
import TimeAgo from '../components/TimeAgo.vue'

import { useCatalog } from '../composables/useCatalog'
import { formatScore } from '../format'
import { levelIcons } from '../hierarchy'
import { formatAxisValues, mergeMatrices } from '../labels'
import { href } from '../router'

/**
 * Entry page: one card per project (all workspaces, or the one in `workspace`).
 *
 * A single workspace is not a level of its own here: its projects are shown directly and the workspace stays in the
 * breadcrumb and the subtitle.
 */
const props = defineProps<{ workspace?: string }>()

const catalog = useCatalog()
const workspaces = computed(() => catalog.workspaces.value.filter(workspace => props.workspace == null || workspace.id === props.workspace))
const projectCount = computed(() => workspaces.value.reduce((sum, workspace) => sum + workspace.projects.length, 0))
const runCount = computed(() => workspaces.value.reduce((sum, workspace) => sum + workspace.projects.reduce((count, project) => count + project.runs.length, 0), 0))

/** Card data of a project: the best exact score of any of its runs and its matrix axes. */
function toCard(project: ProjectEntry) {
  const best = project.runs.reduce<null | number>((max, run) => (run.exactAverage == null ? max : Math.max(max ?? 0, run.exactAverage)), null)
  const matrix = mergeMatrices(project.runs.map(run => run.matrix))
  return { ...project, axes: Object.entries(matrix).map(([axis, values]) => ({ axis, values: formatAxisValues(values) })), best }
}
const sections = computed(() => workspaces.value.map(workspace => ({ id: workspace.id, projects: workspace.projects.map(toCard) })))
</script>

<template>
  <PageHeader :id="props.workspace" :level="props.workspace ? 'workspace' : 'home'" :position="{ workspace: props.workspace }" :title="props.workspace ?? 'Projects'">
    <template #subtitle>
      {{ projectCount }} project(s) · {{ runCount }} run(s)<template v-if="!props.workspace && workspaces.length === 1">
        · workspace {{ workspaces[0]!.id }}
      </template>
    </template>
  </PageHeader>

  <StateView :error="catalog.resource.error.value" :loading="catalog.resource.loading.value" :empty="projectCount === 0" empty-text="No runs found" empty-hint="Runs appear here once `vieval run` writes a report below the viewer's report roots." @retry="catalog.resource.reload">
    <section v-for="section in sections" :key="section.id" :class="['mb-6']">
      <h2 v-if="workspaces.length > 1" :class="['flex items-center gap-2 mb-2 text-sm font-semibold']">
        <span :class="[levelIcons.workspace, 'muted']" aria-hidden="true" />
        <a :href="href({ name: 'scope', workspace: section.id })" :class="['link']">{{ section.id }}</a>
      </h2>
      <div :class="['grid gap-3']" style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr))">
        <a
          v-for="project in section.projects"
          :key="project.id"
          :href="href({ name: 'scope', project: project.id, workspace: section.id })"
          :class="['card flex flex-col gap-3 p-4 transition-colors hover:border-primary-400/60 hover:bg-primary-500/3']"
          data-testid="project-card"
        >
          <span :class="['flex items-center gap-2 font-semibold text-base min-w-0']">
            <span :class="[levelIcons.project, 'text-primary-500 shrink-0']" aria-hidden="true" />
            <span :class="['truncate']">{{ project.id }}</span>
          </span>
          <span :class="['text-sm muted']">
            {{ project.experiments.length }} experiment(s) · {{ project.runs.length }} run(s)
          </span>
          <span :class="['flex items-center gap-2 text-sm']">
            <StateBadge :state="project.latest.state" />
            <TimeAgo :time="project.latest.startedAt" :class="['muted text-xs']" />
          </span>
          <CountsBar :counts="project.latest.counts" />
          <span :class="['flex items-end justify-between gap-3']">
            <span :class="['flex flex-wrap gap-1']">
              <span v-for="axis in project.axes" :key="axis.axis" :class="['badge state-neutral font-normal']">
                <span class="muted">{{ axis.axis }}</span>{{ axis.values }}
              </span>
            </span>
            <span :class="['flex flex-col items-end shrink-0']">
              <span :class="['text-xs muted']">best exact</span>
              <span :class="['text-xl font-semibold tabular-nums']">{{ formatScore(project.best) }}</span>
            </span>
          </span>
        </a>
      </div>
    </section>
  </StateView>
</template>
