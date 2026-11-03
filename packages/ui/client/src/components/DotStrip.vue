<script setup lang="ts">
/** One dot of a {@link DotStrip}, at `position` (0–1) along the strip. */
export interface StripDot {
  /** Hollow and gray: the reference the other dots are read against (a baseline). */
  hollow?: boolean
  key: string
  position: number
}

/**
 * A small track with one dot per value, for a menu row that previews how a choice spreads: the values an axis would
 * average away (matrix "averaged" menu), or where the compared columns sit on an axis (comparison axis pickers). A
 * wide spread is a choice that tells things apart; dots in a clump are one that does not.
 */
const props = defineProps<{
  dots: readonly StripDot[]
}>()
</script>

<template>
  <span :class="['relative block h-2 w-20 shrink-0 rounded-full bg-neutral-500/12']" aria-hidden="true">
    <span
      v-for="dot in props.dots" :key="dot.key"
      :class="[
        'absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full',
        dot.hollow ? 'border-2 border-neutral-500 bg-transparent' : 'bg-[var(--series-1)] opacity-80',
      ]"
      :style="{ left: `${Math.min(1, Math.max(0, dot.position)) * 100}%` }"
    />
  </span>
</template>
