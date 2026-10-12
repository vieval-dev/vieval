<script setup lang="ts">
import type { FileLocation } from '../api'

import { useIntervalFn } from '@vueuse/core'
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from 'reka-ui'
import { computed, shallowRef, watch } from 'vue'

import IconButton from './IconButton.vue'
import LazyImage from './LazyImage.vue'

import { formatTime } from '../format'

/** One frame of a screenshot sequence. */
export interface Frame {
  caption?: string
  label: string
  /** Image file of the frame (a run artifact or an evidence file). */
  location: FileLocation
  time?: string
}

/**
 * Screenshot sequence player (OSWorld/AUV WebP display captures, image artifacts of a case): the current frame,
 * play/pause, previous/next (also ←/→), a scrubber, and a filmstrip of thumbnails.
 */
const props = defineProps<{ frames: Frame[], initial?: number }>()
const index = shallowRef(props.initial ?? 0)
const zoom = shallowRef(false)
watch(() => props.initial, value => (index.value = value ?? 0))
watch(() => props.frames.length, (length) => {
  if (index.value >= length)
    index.value = Math.max(0, length - 1)
})

// Playback advances one frame every 900 ms and stops on the last frame.
const { isActive: playing, pause, resume } = useIntervalFn(() => {
  if (index.value >= props.frames.length - 1)
    pause()
  else
    index.value += 1
}, 900, { immediate: false })

const frame = computed(() => props.frames[index.value])
function onKey(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft')
    step(-1)
  else if (event.key === 'ArrowRight')
    step(1)
}
function step(delta: number): void {
  pause()
  index.value = Math.min(props.frames.length - 1, Math.max(0, index.value + delta))
}
// reka-ui Slider works on arrays of thumb values; the scrubber has one thumb.
const scrubber = computed({
  get: () => [index.value],
  set: (value: number[]) => {
    pause()
    index.value = value[0] ?? 0
  },
})
const frameKey = (frame: Frame) => `${frame.location.runKey}/${frame.location.linkId ?? ''}/${frame.location.path}`
</script>

<template>
  <div :class="['flex flex-col gap-2 outline-none']" tabindex="0" data-testid="image-sequence" :data-frame-index="index" :data-frame-count="props.frames.length" @keydown="onKey">
    <div :class="['flex items-center gap-1 text-xs']">
      <IconButton icon="i-mingcute-skip-previous-line" label="Previous frame" :disabled="index === 0" @click="step(-1)" />
      <IconButton :icon="playing ? 'i-mingcute-pause-line' : 'i-mingcute-play-line'" :label="playing ? 'Pause' : 'Play'" @click="playing ? pause() : resume()" />
      <IconButton icon="i-mingcute-skip-forward-line" label="Next frame" :disabled="index >= props.frames.length - 1" @click="step(1)" />
      <span :class="['mx-1 text-xs mono whitespace-nowrap']" data-testid="frame-counter">frame {{ index + 1 }} / {{ props.frames.length }}</span>
      <SliderRoot v-model="scrubber" :min="0" :max="Math.max(0, props.frames.length - 1)" :step="1" :class="['relative flex flex-1 min-w-24 h-5 items-center select-none touch-none']">
        <SliderTrack :class="['relative h-1.5 grow overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800']">
          <SliderRange :class="['absolute h-full rounded-full bg-primary-500']" />
        </SliderTrack>
        <SliderThumb aria-label="Frame" :class="['block size-3.5 rounded-full bg-white shadow ring-2 ring-primary-500 transition-transform hover:scale-115 focus-visible:(outline-none ring-4 ring-primary-500/40)']" />
      </SliderRoot>
      <span v-if="frame?.time" :class="['ml-1 text-xs muted mono']">{{ formatTime(frame.time) }}</span>
      <IconButton :icon="zoom ? 'i-mingcute-fullscreen-exit-line' : 'i-mingcute-fullscreen-line'" :label="zoom ? 'Fit to view' : 'Actual size (100%)'" @click="zoom = !zoom" />
    </div>
    <div v-if="frame" :class="['rounded-lg bg-neutral-100 dark:bg-neutral-950 overflow-auto', zoom ? 'max-h-[75vh]' : 'flex justify-center']">
      <LazyImage :location="frame.location" :alt="frame.label" loading="eager" :img-class="[zoom ? 'max-w-none' : 'max-h-[50vh] max-w-full object-contain']" />
    </div>
    <div v-if="frame?.caption" :class="['text-xs muted break-all']">
      {{ frame.caption }}
    </div>
    <div :class="['flex gap-1.5 overflow-x-auto pb-1']" aria-label="Filmstrip">
      <button
        v-for="(item, position) in props.frames" :key="frameKey(item)" type="button"
        :class="['shrink-0 rounded-md border-2 overflow-hidden transition-opacity', position === index ? 'border-primary-500' : 'border-transparent opacity-70 hover:opacity-100']"
        :title="`${position + 1}. ${item.label}`" @click="step(position - index)"
      >
        <LazyImage :location="item.location" :alt="`Frame ${position + 1}`" :img-class="['h-14 w-auto block']" />
      </button>
    </div>
  </div>
</template>
