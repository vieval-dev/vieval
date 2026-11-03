<script setup lang="ts">
import { computed } from 'vue'

/**
 * Bar of a row's or column's summary on the margin of a matrix: a mean measured from 0, or a difference measured from
 * a center line (gains up or right in the score hue, losses down or left in the opposite hue, as in `PairsHeatmap.vue`).
 *
 * The end on the baseline stays square and only the far end is rounded, so the bar reads as growing out of the
 * baseline and its length is measured from there.
 */
const props = defineProps<{
  /** `true`: a difference around a center line; `false`: a value from 0. */
  diverging: boolean
  /** Largest |value| on this margin, which fills the bar (or half of it when diverging). */
  scale: number
  value: number
  vertical?: boolean
}>()

const extent = computed(() => `${Math.min(1, Math.abs(props.value) / (props.scale || 1)) * (props.diverging ? 50 : 100)}%`)
const negative = computed(() => props.diverging && props.value < 0)
const fill = computed(() => {
  // Where the bar starts (the baseline) and which end is rounded.
  if (props.vertical) {
    const from = !props.diverging ? { bottom: '0' } : negative.value ? { top: '50%' } : { bottom: '50%' }
    return { ...from, borderRadius: negative.value ? '0 0 2px 2px' : '2px 2px 0 0', height: extent.value, left: '0', right: '0' }
  }
  const from = !props.diverging ? { left: '0' } : negative.value ? { right: '50%' } : { left: '50%' }
  return { ...from, borderRadius: negative.value ? '2px 0 0 2px' : '0 2px 2px 0', bottom: '0', top: '0', width: extent.value }
})
</script>

<template>
  <span :class="['relative block shrink-0 rounded-sm bg-neutral-500/12', props.vertical ? 'w-2.5 h-9' : 'w-14 h-2']" aria-hidden="true">
    <span v-if="props.diverging" :class="['absolute rounded-full bg-neutral-500/60', props.vertical ? 'inset-x-[-2px] top-1/2 h-0.5 -translate-y-1/2' : 'inset-y-[-2px] left-1/2 w-0.5 -translate-x-1/2']" />
    <span :class="['absolute']" :style="{ ...fill, background: negative ? 'var(--series-1-opposite)' : 'var(--series-1)' }" />
  </span>
</template>
