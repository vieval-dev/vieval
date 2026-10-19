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
      return { class: 'state-failed', icon: 'i-mingcute-close-circle-fill' }
    // No result: amber like other execution trouble, with its own icon so it never reads as a wrong result.
    case 'errored':
      return { class: 'state-interrupted', icon: 'i-mingcute-alert-octagon-fill' }
    case 'interrupted':
    case 'retried':
    case 'stale':
    case 'unfinished':
      return { class: 'state-interrupted', icon: props.state === 'retried' ? 'i-mingcute-history-anticlockwise-fill' : 'i-mingcute-warning-fill' }
    // Waiting at the end of the queue to run again: not ended, so the clock of waiting, not a failure icon.
    case 'requeued':
      return { class: 'state-interrupted', icon: 'i-mingcute-time-fill' }
    case 'running':
      return { class: 'state-running', icon: 'i-mingcute-loading-line animate-spin' }
    case 'timeout':
      return { class: 'state-interrupted', icon: 'i-mingcute-stopwatch-2-off-fill' }
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
