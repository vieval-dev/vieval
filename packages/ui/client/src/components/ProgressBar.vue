<script setup lang="ts">
import { computed } from 'vue'

/**
 * One segment of a {@link ProgressBar}: its share of the whole bar and its fill color.
 */
export interface ProgressBarSegment {
  /** UnoCSS classes of the fill (color). */
  class: string
  /** Share of the bar, from 0 to 100. Segments are laid out left to right. */
  percent: number
  /** Tooltip of the segment. */
  title?: string
}

/**
 * Pill-shaped progress bar with stacked segments, after `Progress` of `@proj-airi/ui`
 * (`moeru-ai/airi`, `packages/ui/src/components/misc/progress.vue`): the fill grows with a width transition and,
 * while work is in progress, a shine sweeps over it from the left.
 *
 * Segments are drawn as pills from the left edge to their cumulative end, each one on top of the next, so every
 * boundary between two segments is rounded too.
 */
const props = defineProps<{
  /** Shows the shine sweep. Off once the work ended. */
  active?: boolean
  /** Accessible name of the bar. */
  label: string
  segments: ProgressBarSegment[]
  /**
   * `md` for the run page; `sm`, as thin as `CountsBar`, for cards.
   *
   * @default 'md'
   */
  size?: 'md' | 'sm'
  /** Value reported to assistive technology, from 0 to 100. */
  value: number
}>()

const clamp = (percent: number) => Math.min(100, Math.max(0, percent))
// Cumulative ends, drawn back to front: the last segment spans the most and lies beneath the earlier ones.
const pills = computed(() => {
  let end = 0
  return props.segments
    .map((segment, index) => {
      end = clamp(end + clamp(segment.percent))
      return { ...segment, end, index }
    })
    .reverse()
})
</script>

<template>
  <div
    role="progressbar"
    :aria-label="props.label"
    :aria-valuenow="Math.round(props.value)"
    aria-valuemin="0"
    aria-valuemax="100"
    :class="['relative w-full overflow-hidden rounded-full', props.size === 'sm' ? 'h-1.5' : 'h-4', 'bg-neutral-200 dark:bg-neutral-800']"
  >
    <div
      v-for="pill in pills"
      :key="pill.index"
      :class="[
        'absolute inset-y-0 left-0 overflow-hidden rounded-full will-change-[width]',
        'transition-[width] duration-500 ease-in-out',
        pill.class,
        // A small value still shows as a round dot rather than a sliver clipped by the track's round end.
        pill.percent > 0 && (props.size === 'sm' ? 'min-w-1.5' : 'min-w-4'),
      ]"
      :style="{ width: `${pill.end}%` }"
      :title="pill.title"
    >
      <div v-if="props.active && pill.percent > 0" :class="['absolute inset-0 origin-left rounded-full bg-white', 'vv-progress-shine']" />
    </div>
  </div>
</template>
