<script setup lang="ts" generic="T extends string">
import type { ComponentPublicInstance } from 'vue'

import { useResizeObserver } from '@vueuse/core'
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'
import { computed, nextTick, onMounted, shallowRef, useTemplateRef, watch } from 'vue'

/**
 * One choice of a {@link SegmentedControl}.
 *
 * @param T value type of the choice
 */
export interface Segment<T extends string> {
  /** UnoCSS icon class shown before the label. */
  icon?: string
  label: string
  value: T
}

/**
 * Single-choice segmented control (reka-ui ToggleGroup): arrow keys move between choices, and one choice is
 * always selected. The raised block behind the selected choice slides to a newly picked one, so the change of
 * choice reads as one motion instead of one highlight vanishing and another appearing.
 */
const props = withDefaults(defineProps<{
  items: readonly Segment<T>[]
  label: string
  /**
   * `sm` for a control inside a panel, `md` for one in a toolbar row beside `option-trigger` buttons (same height).
   *
   * @default 'sm'
   */
  size?: 'md' | 'sm'
}>(), { size: 'sm' })
const sizes = { md: 'px-2.5 py-1 text-sm', sm: 'px-2 py-0.5 text-xs' }
const model = defineModel<T>({ required: true })

const root = useTemplateRef<ComponentPublicInstance>('root')
const rootElement = computed(() => (root.value?.$el instanceof HTMLElement ? root.value.$el : undefined))
// Where the selected choice sits inside the track; measured from the DOM because labels differ in width.
// Created at its first place (nothing to slide from), so only later picks animate.
const indicator = shallowRef<{ left: number, width: number }>()
function measure(): void {
  const selected = rootElement.value?.querySelector<HTMLElement>('[data-state="on"]')
  indicator.value = selected == null ? undefined : { left: selected.offsetLeft, width: selected.offsetWidth }
}
onMounted(measure)
watch(model, () => nextTick(measure))
watch(() => props.items, () => nextTick(measure))
useResizeObserver(rootElement, measure)

function select(value: unknown): void {
  // A single ToggleGroup emits `undefined` when the selected item is pressed again; keep the current choice.
  if (typeof value === 'string' && value !== '')
    model.value = value as T
}
</script>

<template>
  <ToggleGroupRoot ref="root" type="single" :model-value="model" :aria-label="props.label" :class="['segmented relative']" @update:model-value="select">
    <span
      v-if="indicator"
      :class="['segmented-indicator transition-[transform,width] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none']"
      :style="{ transform: `translateX(${indicator.left}px)`, width: `${indicator.width}px` }"
      aria-hidden="true"
    />
    <ToggleGroupItem v-for="item in props.items" :key="item.value" :value="item.value" :class="['segmented-item', sizes[props.size]]">
      <span v-if="item.icon" :class="item.icon" aria-hidden="true" />{{ item.label }}
    </ToggleGroupItem>
  </ToggleGroupRoot>
</template>
