<script setup lang="ts">
import { DropdownMenuArrow, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger } from 'reka-ui'
import { computed } from 'vue'

import AnimatedContent from './AnimatedContent.vue'
import IconButton from './IconButton.vue'

import { levelIcons } from '../hierarchy'
import { href } from '../router'

/**
 * Header menu of the comparisons that fit the current page (reka-ui DropdownMenu), plus the full list.
 *
 * Comparisons are rarely the starting point, so they live here instead of being a level of the hierarchy.
 */
const props = defineProps<{
  experiment?: string
  project?: string
  /** Run of the current page: its matrix rows can be compared. */
  runKey?: string
  workspace?: string
}>()

const items = computed(() => {
  const list: { href: string, icon: string, label: string }[] = []
  const { experiment, project, runKey, workspace } = props
  if (workspace != null && project != null)
    list.push({ href: href({ name: 'compare', query: { project, view: 'experiments', workspace } }), icon: levelIcons.experiment, label: 'Experiments of this project' })
  if (workspace != null && project != null && experiment != null)
    list.push({ href: href({ name: 'compare', query: { experiment, project, view: 'attempts', workspace } }), icon: levelIcons.attempt, label: 'Attempts of this experiment' })
  if (runKey != null)
    list.push({ href: href({ name: 'compare', query: { run: runKey, view: 'matrix' } }), icon: 'i-mingcute-layout-grid-line', label: 'Matrix rows of this run' })
  return list
})

const allComparisons = href({ name: 'compare', query: {} })
/** Menu items are not links, so selecting one moves the hash itself. */
function go(target: string): void {
  location.hash = target
}
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <IconButton :icon="levelIcons.comparison" label="Compare" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent as-child :side-offset="6" align="start" :class="['floating min-w-60 p-1 text-sm']">
        <AnimatedContent>
          <DropdownMenuLabel :class="['px-2 py-1 text-xs muted']">
            Compare
          </DropdownMenuLabel>
          <DropdownMenuItem
            v-for="item in items"
            :key="item.href"
            :class="['menu-item']"
            @select="go(item.href)"
          >
            <span :class="item.icon" aria-hidden="true" />{{ item.label }}
          </DropdownMenuItem>
          <DropdownMenuSeparator v-if="items.length > 0" :class="['my-1 h-px bg-neutral-200 dark:bg-neutral-800']" />
          <DropdownMenuItem
            :class="['menu-item']"
            @select="go(allComparisons)"
          >
            <span class="i-mingcute-list-check-line" aria-hidden="true" />All comparisons
          </DropdownMenuItem>
          <DropdownMenuArrow :class="['floating-arrow']" />
        </AnimatedContent>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
