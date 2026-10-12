<script setup lang="ts">
import { computed } from 'vue'

/**
 * Tiny line of scores (0–1) in run order, for cards and matrix cells: the trend, not the exact values.
 *
 * Missing scores (`null`) break the line. Fewer than two scores draw nothing.
 */
const props = withDefaults(defineProps<{
  height?: number
  /** Accessible summary, for example "exact score of 10 runs". */
  label: string
  values: readonly (null | number)[]
  width?: number
}>(), { height: 20, width: 72 })

const segments = computed(() => {
  const { height, values, width } = props
  if (values.length < 2)
    return []
  const step = width / (values.length - 1)
  const parts: string[] = []
  let current = ''
  values.forEach((value, index) => {
    if (value == null || !Number.isFinite(value)) {
      if (current !== '')
        parts.push(current)
      current = ''
      return
    }
    const x = (index * step).toFixed(1)
    // 1 px margin so a 0 % or 100 % score is not cut by the stroke.
    const y = (1 + (1 - Math.min(1, Math.max(0, value))) * (height - 2)).toFixed(1)
    current += `${current === '' ? 'M' : 'L'}${x},${y}`
  })
  if (current !== '')
    parts.push(current)
  return parts
})
const last = computed(() => {
  const index = props.values.findLastIndex(value => value != null && Number.isFinite(value))
  if (index < 0 || props.values.length < 2)
    return undefined
  const value = props.values[index]!
  return { x: (index * props.width) / (props.values.length - 1), y: 1 + (1 - Math.min(1, Math.max(0, value))) * (props.height - 2) }
})
</script>

<template>
  <svg v-if="segments.length > 0" :width="props.width" :height="props.height" :viewBox="`-2 -2 ${props.width + 4} ${props.height + 4}`" role="img" :aria-label="props.label" :class="['shrink-0 overflow-visible']">
    <path v-for="(segment, index) in segments" :key="index" :d="segment" fill="none" stroke="var(--series-1)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
    <circle v-if="last" :cx="last.x" :cy="last.y" r="2" fill="var(--series-1)" />
  </svg>
</template>
