<script setup lang="ts">
import type { HierarchyLevel } from '../hierarchy'
import type { SwitcherOption } from '../switcher'

import { onMounted, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import CrumbSwitcher from './CrumbSwitcher.vue'

import { levelIcons, levelLabel } from '../hierarchy'

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
 *
 * Narrow screens keep the path on one line that scrolls sideways, scrolled to its end so the page's own segment and
 * its parent stay in view.
 */
const props = defineProps<{
  items: Crumb[]
  /** Siblings of the last segment; omitted or empty keeps it plain text. */
  siblings?: SwitcherOption[]
}>()

const { t } = useI18n()
const nav = useTemplateRef<HTMLElement>('nav')
function scrollToEnd(): void {
  nav.value?.scrollTo({ left: nav.value.scrollWidth })
}
onMounted(scrollToEnd)
// Labels resolve after the catalog loaded, which makes the path longer.
watch(() => props.items.map(item => item.label).join('/'), scrollToEnd, { flush: 'post' })
</script>

<template>
  <nav ref="nav" :aria-label="t('runs.header.breadcrumb')" :class="['flex items-center gap-x-1 gap-y-0.5 min-w-0 text-sm', 'relative md:flex-wrap max-md:(overflow-x-auto whitespace-nowrap py-0.5 -my-0.5) vv-scrollbar-none']">
    <template v-for="(item, index) in props.items" :key="index">
      <span v-if="index > 0" :class="['i-mingcute-right-small-line muted shrink-0']" aria-hidden="true" />
      <span :class="['inline-flex items-center gap-1 min-w-0 max-md:shrink-0']" :title="t('runs.header.crumbTitle', { id: item.id ?? item.label, level: levelLabel(item.level) })">
        <span :class="[levelIcons[item.level], 'muted shrink-0']" aria-hidden="true" />
        <span :class="['sr-only']">{{ t('runs.header.crumbLevel', { level: levelLabel(item.level) }) }}</span>
        <a v-if="item.href" :href="item.href" :class="['link truncate max-w-40 md:max-w-64']">{{ item.label }}</a>
        <CrumbSwitcher
          v-else-if="index === props.items.length - 1 && props.siblings && props.siblings.length > 0"
          :current="item.id ?? item.label"
          :label="item.label"
          :level="item.level"
          :options="props.siblings"
        />
        <span v-else :class="['font-medium truncate max-w-56 md:max-w-80']">{{ item.label }}</span>
      </span>
    </template>
  </nav>
</template>
