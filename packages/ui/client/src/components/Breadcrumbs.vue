<script setup lang="ts">
import type { HierarchyLevel } from '../hierarchy'
import type { SwitcherOption } from '../switcher'

import CrumbSwitcher from './CrumbSwitcher.vue'

import { levelIcons, levelLabels } from '../hierarchy'

/** One level of the hierarchy shown in the top bar. */
export interface Crumb {
  href?: string
  /** Full id of the level when `label` is a readable name; shown as the tooltip. */
  id?: string
  label: string
  /** Hierarchy level, shown as its icon (`levelIcons`); the level name is the tooltip and screen-reader text. */
  level: HierarchyLevel
}

/**
 * Hierarchy path of a page. Ancestors are plain links (one click goes up); the last segment is the page itself and,
 * with `siblings`, a switcher to the other items of the same parent (`CrumbSwitcher`).
 */
const props = defineProps<{
  items: Crumb[]
  /** Siblings of the last segment; omitted or empty keeps it plain text. */
  siblings?: SwitcherOption[]
}>()
</script>

<template>
  <nav aria-label="Hierarchy" :class="['flex items-center flex-wrap gap-x-1 gap-y-0.5 min-w-0 text-sm']">
    <template v-for="(item, index) in props.items" :key="index">
      <span v-if="index > 0" :class="['i-mingcute-right-small-line muted shrink-0']" aria-hidden="true" />
      <span :class="['inline-flex items-center gap-1 min-w-0']" :title="`${levelLabels[item.level]}: ${item.id ?? item.label}`">
        <span :class="[levelIcons[item.level], 'muted shrink-0']" aria-hidden="true" />
        <span :class="['sr-only']">{{ levelLabels[item.level] }}:</span>
        <a v-if="item.href" :href="item.href" :class="['link truncate max-w-64']">{{ item.label }}</a>
        <CrumbSwitcher
          v-else-if="index === props.items.length - 1 && props.siblings && props.siblings.length > 0"
          :current="item.id ?? item.label"
          :label="item.label"
          :level="item.level"
          :options="props.siblings"
        />
        <span v-else :class="['font-medium truncate max-w-80']">{{ item.label }}</span>
      </span>
    </template>
  </nav>
</template>
