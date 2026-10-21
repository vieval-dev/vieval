<script setup lang="ts">
import type { HierarchyLevel, HierarchyPosition } from '../hierarchy'
import type { SwitcherOption } from '../switcher'

import { useHead } from '@unhead/vue'
import { computed } from 'vue'

import Breadcrumbs from './Breadcrumbs.vue'
import IdMenu from './IdMenu.vue'

import { useCatalog } from '../composables/useCatalog'
import { hierarchyCrumbs, levelIcons, levelLabels } from '../hierarchy'
import { attemptLabel, experimentLabel, runLabel } from '../labels'
import { switcherOptions } from '../switcher'

/**
 * Top of every page: the hierarchy breadcrumb (ending at the page's own level, which switches to its siblings), the
 * page title with a summary, and page actions, plus "⋯ Copy ID" when the page shows an item with an id.
 */
const props = defineProps<{
  /** Full id of the item the page shows; adds the overflow menu with "Copy ID". */
  id?: string
  /** Level the page shows; its icon precedes the title and the breadcrumb ends at it. */
  level?: HierarchyLevel
  /** The page's data is still loading: title and subtitle are placeholders instead of ids and zero counts. */
  loading?: boolean
  position: HierarchyPosition
  /** Siblings of the page's own level when the catalog does not know them (tasks and cases come from the run). */
  siblings?: SwitcherOption[]
  subtitle?: string
  /** Name of the page: the heading (unless the `title` slot replaces it) and the document title. */
  title: string
  /**
   * `sm` sets the title in body size, for a page whose header leads with something else (the run's score).
   * @default 'lg'
   */
  titleSize?: 'lg' | 'sm'
}>()
// The browser tab follows the page; a page still loading keeps the plain "Vieval" of the title template.
useHead({ title: () => (props.loading ? undefined : props.title) })
const catalog = useCatalog()
const crumbs = computed(() => {
  const { attempt, experiment, project, runKey, workspace } = props.position
  const run = runKey == null ? undefined : catalog.runs.value.find(item => item.runKey === runKey)
  return hierarchyCrumbs(props.position, {
    attempt: attempt == null ? undefined : attemptLabel(attempt),
    experiment: experiment == null ? undefined : experimentLabel(experiment, catalog.matrixOf({ experiment, project, workspace })).text,
    run: run == null ? undefined : runLabel(run),
  }, props.level)
})
/** Siblings of the page's own level for the breadcrumb switcher (from the shared catalog, no request). */
const siblings = computed(() => {
  if (props.siblings != null)
    return props.siblings
  const level = props.level
  if (level !== 'workspace' && level !== 'project' && level !== 'experiment' && level !== 'attempt' && level !== 'run')
    return undefined
  return switcherOptions(props.position, catalog.runs.value)[level]
})
</script>

<template>
  <header :class="['flex flex-col gap-2 pb-3 mb-3 border-b border-neutral-200/50 dark:border-neutral-800/50']">
    <Breadcrumbs :items="crumbs" :siblings="siblings" />
    <!-- Phones keep the "⋯" menu next to the title and wrap the page actions onto their own line below it instead of
         squeezing the title; wider screens put the actions and the menu after the title, and wrap them below once the
         title would get narrower than 24rem. -->
    <div :class="['flex items-start gap-x-3 gap-y-2 flex-wrap']">
      <div :class="['min-w-0 flex-1 md:basis-96']">
        <h1 :class="['flex items-start gap-2 font-semibold [overflow-wrap:anywhere]', props.titleSize === 'sm' ? 'text-base leading-6' : 'text-lg leading-7']">
          <span v-if="props.level" :class="[levelIcons[props.level], 'shrink-0 mt-1 muted']" role="img" :aria-label="levelLabels[props.level]" :title="levelLabels[props.level]" />
          <span v-if="props.loading" :class="['skeleton h-6 my-0.5 w-56 max-w-full']" data-testid="page-header-skeleton" />
          <slot v-else name="title">
            {{ props.title }}
          </slot>
        </h1>
        <div v-if="props.loading" :class="['skeleton h-3.5 mt-1.5 w-40']" />
        <div v-else-if="props.subtitle || $slots.subtitle" :class="['muted text-sm']">
          <slot name="subtitle">
            {{ props.subtitle }}
          </slot>
        </div>
      </div>
      <!-- As tall as the title's first line on wide screens, so actions line up with the title. On phones the line
           collapses when every action hides itself there (the experiment trend). -->
      <div v-if="$slots.actions" :class="['flex items-center gap-2 flex-wrap md:min-h-7', 'max-md:(order-2 basis-full)']">
        <slot name="actions" />
      </div>
      <!-- IdMenu renders no element of its own; the wrapper carries the order and the alignment. -->
      <span v-if="props.id && props.level" :class="['flex items-center min-h-7 max-md:order-1']">
        <!-- The page's secondary actions join the menu only when the page has some, so the menu adds no empty group. -->
        <IdMenu :id="props.id" :kind="levelLabels[props.level].toLowerCase()">
          <template v-if="$slots.menu" #default>
            <slot name="menu" />
          </template>
        </IdMenu>
      </span>
    </div>
  </header>
</template>
