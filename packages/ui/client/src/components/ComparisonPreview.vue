<script setup lang="ts">
import type { CrossWorkspaceGroup } from '../composables/useCatalog'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import MarginBar from './MarginBar.vue'

import { formatScore } from '../format'
import { levelIcons } from '../hierarchy'
import { href } from '../router'
import { headlineValue, headlineView } from '../scores'

/**
 * Leaderboard of one experiment across the workspaces that ran it: each workspace's newest headline, best first, with
 * a bar from 0 so the gaps read at their true size, and the way into the full comparison.
 *
 * Use where the reader picks what to look at (the home page, the comparisons list): it shows who leads before the
 * comparison is opened. It ranks by the headline alone; the comparison page says which gaps are beyond noise.
 */
const props = withDefaults(defineProps<{
  group: CrossWorkspaceGroup
  /** Rows shown before "N more". */
  limit?: number
}>(), { limit: Number.POSITIVE_INFINITY })

const { t } = useI18n()

const compareHref = computed(() => href({ name: 'compare', query: { runs: props.group.runs.map(run => run.runKey).join(','), view: 'runs' } }))
/** Two places of one workspace are told apart by their project. */
const sharedWorkspace = computed(() => new Set(props.group.runs.map(run => run.workspaceId)).size < props.group.runs.length)
const rows = computed(() => props.group.runs.slice(0, props.limit).map((run, index) => ({
  href: href({ name: 'run', runKey: run.runKey }),
  label: sharedWorkspace.value ? `${run.workspaceId} · ${run.projectSegment}` : run.workspaceId,
  rank: index + 1,
  run,
  value: headlineValue(run.headline),
})))
const hidden = computed(() => Math.max(0, props.group.runs.length - props.limit))
/** Name of the score the rows rank by, from the first run with a headline. */
const scoreName = computed(() => {
  const run = props.group.runs.find(item => item.headline != null)
  return run?.headline == null ? undefined : headlineView(run.headline, run.headlineDefinitions).label
})
</script>

<template>
  <section :class="['card']" data-testid="comparison-preview">
    <h2 :class="['card-title']">
      <span :class="[levelIcons.experiment, 'muted shrink-0']" aria-hidden="true" />
      <span :class="['truncate']">{{ props.group.experimentId }}</span>
      <span :class="['font-normal text-xs muted whitespace-nowrap']">{{ t('compare.preview.places', { n: props.group.runs.length }) }}<template v-if="scoreName">
        · {{ t('compare.preview.rankedBy', { score: scoreName }) }}
      </template></span>
      <a :href="compareHref" :class="['btn text-xs ml-auto -my-1 -mr-1.5 shrink-0']" data-testid="comparison-preview-open">
        {{ t('compare.preview.open') }}<span class="i-mingcute-arrow-right-line" aria-hidden="true" />
      </a>
    </h2>
    <ol :class="['p-1.5']">
      <li v-for="row in rows" :key="row.run.runKey">
        <a :href="row.href" :class="['flex items-center gap-3 rounded-md px-1.5 py-1 text-sm hover:bg-neutral-500/8']">
          <span :class="['w-4 text-right text-xs muted tabular-nums shrink-0']">{{ row.rank }}</span>
          <span :class="[levelIcons.workspace, 'muted shrink-0']" aria-hidden="true" />
          <span :class="['truncate min-w-0 flex-[1_1_8rem]']" :title="`${row.run.workspaceId} · ${row.run.projectSegment}`">{{ row.label }}</span>
          <!-- The bar takes the room the card has, so a wide card shows the gaps larger instead of leaving space empty. -->
          <MarginBar v-if="row.value != null" :value="row.value" :scale="1" :diverging="false" :class="['w-auto! flex-[0_1_24rem] min-w-14']" />
          <span :class="['w-12 text-right tabular-nums shrink-0', row.value == null && 'muted']">{{ row.value == null ? '—' : formatScore(row.value) }}</span>
        </a>
      </li>
      <!-- The rest of the ranking, as one more row lined up with the names above; the comparison lists every row. -->
      <li v-if="hidden > 0">
        <a :href="compareHref" :class="['flex items-center gap-3 rounded-md px-1.5 py-1 text-xs muted hover:bg-neutral-500/8']" data-testid="comparison-preview-more">
          <span :class="['w-4 shrink-0']" aria-hidden="true" />
          <span :class="['w-[1em] shrink-0 text-sm']" aria-hidden="true" />
          <span>{{ t('compare.preview.more', { n: hidden }) }}</span>
          <span class="i-mingcute-arrow-right-line" aria-hidden="true" />
        </a>
      </li>
    </ol>
  </section>
</template>
