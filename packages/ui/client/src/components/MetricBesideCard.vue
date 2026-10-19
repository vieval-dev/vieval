<script setup lang="ts">
import type { MetricDefinition } from '../../../src/shared/contract'

import { useMediaQuery } from '@vueuse/core'
import { PopoverAnchor, PopoverContent, PopoverPortal, PopoverRoot } from 'reka-ui'
import { computed, shallowRef, watch } from 'vue'

import AnimatedContent from './AnimatedContent.vue'
import MetricSummary from './MetricSummary.vue'

/** The metric a menu item stands for, and the item element the card lines up with. */
export interface BesideTarget {
  item: Element
  name: string
}

/**
 * What the metric under the pointer (or the keyboard) is, floating beside a whole menu or list of metrics: a second
 * panel right of it, level with the highlighted item and following it up and down, with no arrow, so moving through the
 * items swaps its content instead of opening a callout per row. Keyboard focus moves it too, unlike a hover card.
 *
 * Use when:
 * - a menu or list picks among metrics (color by, group by, axes, columns) and each choice needs its description
 *
 * Expects:
 * - `anchor` is the menu or list element; `target` the highlighted metric with its item element
 */
const props = defineProps<{
  /** The menu or list: the card sits right of its edge. */
  anchor: HTMLElement | null | undefined
  definitionOf: (name: string) => MetricDefinition | undefined
  /** The highlighted metric and its item: the card follows the item up and down. `undefined` while none is. */
  target: BesideTarget | undefined
  valuesOf: (name: string) => readonly unknown[]
}>()

// Phones have no room beside a menu; their lists show the description inline and open details in a drawer instead.
const isDesktop = useMediaQuery('(min-width: 768px)')
// The card keeps its last metric while it plays its closing animation (reka keeps the content mounted until then).
const shown = shallowRef<string>()
watch(() => props.target?.name, (name) => {
  if (name != null)
    shown.value = name
}, { immediate: true })
/**
 * Floating UI positions against this virtual element, read on every update: the menu's left and right edges with the
 * highlighted item's top and bottom, so the card clears the whole menu and lines up with the row being looked at.
 */
const reference = computed(() => {
  const anchor = props.anchor
  const item = props.target?.item
  if (anchor == null)
    return undefined
  return {
    getBoundingClientRect: () => {
      const menu = anchor.getBoundingClientRect()
      const row = item?.getBoundingClientRect() ?? menu
      return new DOMRect(menu.left, row.top, menu.width, row.height)
    },
  }
})
</script>

<template>
  <PopoverRoot :open="isDesktop && props.target != null && props.anchor != null">
    <!-- NOTICE:
         Keyed by the item, so moving to another item mounts a new anchor and the card is positioned again. reka's
         popper reads the virtual reference when it is set and keeps the floating position until the anchor element or
         the layout changes; a reference whose rectangle changes alone does not move the card.
         Removal condition: reka repositions on a changed `reference` rectangle. -->
    <PopoverAnchor :key="props.target?.name" :reference="reference" />
    <PopoverPortal>
      <PopoverContent
        as-child side="right" align="start" :side-offset="12" :collision-padding="12"
        :class="['floating p-2.5 text-xs pointer-events-none']"
        @open-auto-focus.prevent @close-auto-focus.prevent
      >
        <AnimatedContent>
          <MetricSummary v-if="shown" :name="shown" :definition="props.definitionOf(shown)" :values="props.valuesOf(shown)" />
        </AnimatedContent>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
