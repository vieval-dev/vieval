<script setup lang="ts">
import type { ProjectEntry } from '../composables/useCatalog'

import { computed } from 'vue'

import PageHeader from '../components/PageHeader.vue'
import ScoreCard from '../components/ScoreCard.vue'
import StateView from '../components/StateView.vue'
import TimeAgo from '../components/TimeAgo.vue'

import { useCatalog } from '../composables/useCatalog'
import { countOf } from '../format'
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

/**
 * Card data of a project: its matrix axes, with the score of its newest run.
 *
 * The score is the newest run's own, like the state and the case bar beside it, and empty when that run scored no case.
 * It previously was the best exact score of any run, so a 3-case smoke run that got everything right showed 100% above
 * a newer full run's 94%.
 */
function toCard(project: ProjectEntry) {
  const matrix = mergeMatrices(project.runs.map(run => run.matrix))
  return { ...project, axes: Object.entries(matrix).map(([axis, values]) => ({ axis, values: formatAxisValues(values) })) }
}
const sections = computed(() => workspaces.value.map(workspace => ({ id: workspace.id, projects: workspace.projects.map(toCard) })))
</script>

<template>
  <PageHeader :id="props.workspace" :loading="catalog.query.isPending.value" :level="props.workspace ? 'workspace' : 'home'" :position="{ workspace: props.workspace }" :title="props.workspace ?? 'Projects'">
    <template #subtitle>
      {{ projectCount }} project(s) · {{ runCount }} run(s)<template v-if="!props.workspace && workspaces.length === 1">
        · workspace {{ workspaces[0]!.id }}
      </template>
    </template>
  </PageHeader>

  <StateView :error="catalog.query.error.value" :loading="catalog.query.isPending.value" :empty="projectCount === 0" empty-text="No runs found" empty-hint="Runs appear here once `vieval run` writes a report below the viewer's report roots." skeleton="cards" @retry="catalog.query.refetch()">
    <section v-for="section in sections" :key="section.id" :class="['mb-6']">
      <h2 v-if="workspaces.length > 1" :class="['flex items-center gap-2 mb-2 text-sm font-semibold']">
        <span :class="[levelIcons.workspace, 'muted']" aria-hidden="true" />
        <a :href="href({ name: 'scope', workspace: section.id })" :class="['link']">{{ section.id }}</a>
      </h2>
      <div :class="['grid gap-3']" style="grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr))">
        <ScoreCard
          v-for="project in section.projects"
          :key="project.id"
          :href="href({ name: 'scope', project: project.id, workspace: section.id })"
          :score="project.latest.exactAverage"
          score-label="exact score of the newest run"
          :state="project.latest.state"
          :counts="project.latest.counts"
          :run="project.latest"
          data-testid="project-card"
        >
          <template #title>
            <span :class="['flex items-center gap-2 text-base min-w-0']">
              <span :class="[levelIcons.project, 'text-primary-500 shrink-0']" aria-hidden="true" />
              <span :class="['truncate']">{{ project.id }}</span>
            </span>
          </template>
          <!-- A running run says when it started in its progress line; a finished one says it here. -->
          <span>
            {{ countOf(project.experiments.length, 'experiment') }} · {{ countOf(project.runs.length, 'run') }}<template v-if="project.latest.state !== 'running'">
              · last run <TimeAgo :time="project.latest.startedAt" relative-only />
            </template>
          </span>
          <template v-if="project.axes.length > 0" #footer>
            <span v-for="axis in project.axes" :key="axis.axis" :class="['inline-flex items-center gap-1 px-1 text-xs text-neutral-700 dark:text-neutral-300 whitespace-nowrap']">
              <span class="muted">{{ axis.axis }}</span>{{ axis.values }}
            </span>
          </template>
        </ScoreCard>
      </div>
    </section>
  </StateView>
</template>
