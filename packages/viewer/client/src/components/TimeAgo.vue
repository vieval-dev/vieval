<script setup lang="ts">
import { useIntervalFn, useTimestamp } from '@vueuse/core'
import { computed } from 'vue'

import { formatDateTime } from '../format'
import { formatShortDateTime, relativeTime } from '../labels'

/**
 * A point in time as `Oct 12, 07:11 · 3 hours ago`; the full local date and time is the tooltip.
 */
const props = defineProps<{
  /** Shows only the relative part ("3 hours ago"). */
  relativeOnly?: boolean
  time: Date | string | undefined
}>()

// Relative times need minute precision only; a 30 s clock keeps them right without re-rendering every second.
const now = useTimestamp({ scheduler: callback => useIntervalFn(callback, 30_000) })
const date = computed(() => {
  if (props.time == null)
    return undefined
  const value = typeof props.time === 'string' ? new Date(props.time) : props.time
  return Number.isNaN(value.getTime()) ? undefined : value
})
</script>

<template>
  <time v-if="date" :datetime="date.toISOString()" :title="formatDateTime(date.toISOString())" :class="['whitespace-nowrap']">
    <template v-if="!props.relativeOnly">{{ formatShortDateTime(date) }} · </template>{{ relativeTime(date, now) }}
  </time>
  <span v-else class="muted">—</span>
</template>
