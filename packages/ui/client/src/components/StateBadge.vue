<script setup lang="ts">
import { computed } from 'vue'

/**
 * Colored state label with an icon (state is never shown by color alone).
 */
const props = defineProps<{
  /** Hide the text and keep only the icon (the label stays as `title`). */
  iconOnly?: boolean
  /** Run, task, case, or try state as the API reports it. */
  state: string
}>()

const look = computed(() => {
  switch (props.state) {
    case 'ended':
    case 'ok':
    case 'passed':
      return { class: 'state-passed', icon: 'i-mingcute-check-circle-fill' }
    case 'error':
    case 'failed':
    case 'timeout':
      return { class: 'state-failed', icon: props.state === 'timeout' ? 'i-mingcute-stopwatch-2-off-fill' : 'i-mingcute-close-circle-fill' }
    case 'interrupted':
    case 'retried':
    case 'stale':
    case 'unfinished':
      return { class: 'state-interrupted', icon: props.state === 'retried' ? 'i-mingcute-history-anticlockwise-fill' : 'i-mingcute-warning-fill' }
    case 'running':
      return { class: 'state-running', icon: 'i-mingcute-loading-line animate-spin' }
    default:
      return { class: 'state-neutral', icon: props.state === 'queued' ? 'i-mingcute-time-fill' : 'i-mingcute-circle-dash-fill' }
  }
})
</script>

<template>
  <span :class="['badge', look.class]" :title="props.state" :data-state="props.state">
    <span :class="[look.icon, 'text-[0.9em]']" aria-hidden="true" />
    <span v-if="!props.iconOnly">{{ props.state }}</span>
  </span>
</template>
