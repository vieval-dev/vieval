<script setup lang="ts" generic="T extends string">
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'

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
 * always selected.
 */
const props = defineProps<{ items: readonly Segment<T>[], label: string }>()
const model = defineModel<T>({ required: true })

function select(value: unknown): void {
  // A single ToggleGroup emits `undefined` when the selected item is pressed again; keep the current choice.
  if (typeof value === 'string' && value !== '')
    model.value = value as T
}
</script>

<template>
  <ToggleGroupRoot type="single" :model-value="model" :aria-label="props.label" :class="['segmented']" @update:model-value="select">
    <ToggleGroupItem v-for="item in props.items" :key="item.value" :value="item.value" :class="['segmented-item']">
      <span v-if="item.icon" :class="item.icon" aria-hidden="true" />{{ item.label }}
    </ToggleGroupItem>
  </ToggleGroupRoot>
</template>
