<script setup lang="ts">
import type { CellCompletion } from '../matrixGrid'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatCount } from '../format'

/**
 * Small ring of how many cases of a matrix cell have settled, in the state colors of the case bars (`CountsBar`):
 * passed, then failed, then no result (`errored`, `timeout`), on a faint track for the cases still missing. A full
 * ring is a complete cell; a running cell pulses.
 */
const props = withDefaults(defineProps<{
  completion: CellCompletion
  /** Outer size in pixels. */
  size?: number
}>(), { size: 16 })
const { t } = useI18n()

const stroke = computed(() => (props.size < 12 ? 2 : 2.5))
const radius = computed(() => (props.size - stroke.value) / 2)
const length = computed(() => 2 * Math.PI * radius.value)
/** Arcs one after another around the ring, each a share of the expected cases (the whole ring at most). */
const arcs = computed(() => {
  const expected = Math.max(1, props.completion.expected)
  const parts = [
    { color: 'var(--mark-passed)', count: props.completion.scored - props.completion.failed },
    { color: 'var(--mark-failed)', count: props.completion.failed },
    { color: 'var(--mark-errored)', count: props.completion.errored },
  ]
  let start = 0
  return parts.flatMap((part) => {
    const share = Math.min(1 - start, part.count / expected)
    if (share <= 0)
      return []
    const arc = { color: part.color, share, start }
    start += share
    return [arc]
  })
})
const label = computed(() => t(props.completion.errored > 0 ? 'matrix.ring.errored' : 'matrix.ring.label', {
  errored: formatCount(props.completion.errored),
  expected: formatCount(props.completion.expected),
  scored: formatCount(props.completion.scored),
}) + (props.completion.running ? ` · ${t('matrix.ring.running')}` : ''))
</script>

<template>
  <svg
    :class="['shrink-0', props.completion.running && 'animate-pulse']"
    :width="props.size" :height="props.size" :viewBox="`0 0 ${props.size} ${props.size}`"
    role="img" :aria-label="label" data-testid="completion-ring"
  >
    <title>{{ label }}</title>
    <g :transform="`rotate(-90 ${props.size / 2} ${props.size / 2})`" fill="none" :stroke-width="stroke">
      <circle :cx="props.size / 2" :cy="props.size / 2" :r="radius" :class="['stroke-neutral-500/25']" />
      <circle
        v-for="arc in arcs" :key="arc.color" :cx="props.size / 2" :cy="props.size / 2" :r="radius"
        :style="{ stroke: arc.color }"
        :stroke-dasharray="`${arc.share * length} ${length}`" :stroke-dashoffset="-arc.start * length"
      />
    </g>
  </svg>
</template>
