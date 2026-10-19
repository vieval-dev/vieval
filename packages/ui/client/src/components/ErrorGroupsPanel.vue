<script setup lang="ts">
import type { TaskNode } from '../../../src/shared/contract'

import { computed, shallowRef } from 'vue'

import { groupErrors } from '../errorGroups'
import { formatCount } from '../format'

/**
 * Cases of a run that produced no result, grouped by their error: how many cases each failure took out of the score
 * (for example provider rate limits versus dropped connections), with one case of each group to open.
 *
 * Renders nothing while every case has a result.
 */
const props = defineProps<{
  /** Link to the page of one case. */
  caseHref: (target: { caseId: string, taskId: string }) => string
  /** Tasks of the run; only their cases are read. */
  tasks: readonly Pick<TaskNode, 'cases'>[]
}>()

/** Groups shown before "Show all"; a run with many kinds of failure keeps the page short. */
const COLLAPSED_GROUPS = 6

const groups = computed(() => groupErrors(props.tasks))
const total = computed(() => groups.value.reduce((sum, group) => sum + group.count, 0))
const expanded = shallowRef(false)
const shown = computed(() => expanded.value ? groups.value : groups.value.slice(0, COLLAPSED_GROUPS))
</script>

<template>
  <section v-if="groups.length > 0" :class="['card mt-4']" data-testid="error-groups">
    <h2 :class="['card-title']">
      <span :class="['i-mingcute-alert-octagon-line', '[color:var(--mark-errored)]']" aria-hidden="true" />No result
      <span :class="['text-xs muted font-normal']">{{ formatCount(total) }} cases left out of the score, by error</span>
    </h2>
    <ul :class="['flex flex-col divide-y divide-neutral-100/70 dark:divide-neutral-800/70']">
      <li v-for="group in shown" :key="group.key" :class="['flex items-start gap-3 px-3 py-2 text-sm']" data-testid="error-group">
        <span :class="['mono text-sm font-semibold w-12 shrink-0 text-right', '[color:var(--ink-errored)]']">{{ formatCount(group.count) }}</span>
        <span :class="['min-w-0 flex-1 flex flex-col gap-1']">
          <span :class="['mono text-xs break-all']" :title="group.message">
            <span v-if="group.errorName" :class="['badge state-interrupted mr-1.5']">{{ group.errorName }}</span>{{ group.message }}
          </span>
          <a :class="['link text-xs self-start']" :href="props.caseHref(group.example)">e.g. {{ group.example.name }}</a>
        </span>
      </li>
    </ul>
    <div v-if="groups.length > COLLAPSED_GROUPS" :class="['px-3 py-2 border-t border-neutral-200/50 dark:border-neutral-800/50']">
      <button type="button" :class="['btn text-xs']" @click="expanded = !expanded">
        {{ expanded ? 'Show fewer' : `Show all ${groups.length} groups` }}
      </button>
    </div>
  </section>
</template>
