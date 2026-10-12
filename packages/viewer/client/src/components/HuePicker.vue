<script setup lang="ts">
import { PopoverArrow, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger, SliderRange, SliderRoot, SliderThumb, SliderTrack } from 'reka-ui'
import { computed } from 'vue'

import AnimatedContent from './AnimatedContent.vue'
import IconButton from './IconButton.vue'

import { useThemeHue } from '../composables/useThemeHue'
import { DEFAULT_HUE } from '../theme'

/**
 * Theme color picker: a hue slider over the OKLCH hue circle, after airi's `ThemeColorsHueControl`
 * (`moeru-ai/airi`, `packages/stage-ui/stories/components/ThemeColorsHueControl.vue`).
 */
const { hue, reset } = useThemeHue()
const model = computed({
  get: () => [hue.value],
  set: (value: number[] | undefined) => {
    if (value?.[0] != null)
      hue.value = value[0]
  },
})
/** The track shows every hue at the lightness and chroma of `primary-400`, so the thumb sits on its own color. */
const gradient = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map(stop => `oklch(74% 0.16 ${stop})`).join(', ')})`
</script>

<template>
  <PopoverRoot>
    <PopoverTrigger as-child>
      <IconButton icon="i-mingcute-palette-line" label="Theme color" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent as-child :side-offset="6" align="start" :class="['floating w-64 p-3 flex flex-col gap-3']">
        <AnimatedContent>
          <div :class="['flex items-center justify-between text-sm font-medium']">
            Theme color
            <span :class="['mono text-xs muted']">{{ Math.round(hue) }}°</span>
          </div>
          <SliderRoot v-model="model" :min="0" :max="360" :step="1" :class="['relative flex items-center h-5 w-full touch-none select-none']" data-testid="hue-slider">
            <SliderTrack :class="['relative h-3 grow rounded-full']" :style="{ background: gradient }">
              <SliderRange :class="['absolute h-full rounded-full bg-transparent']" />
            </SliderTrack>
            <SliderThumb aria-label="Hue" :class="['block size-4 rounded-full bg-primary-400 shadow ring-2 ring-white dark:ring-neutral-900 focus-visible:(outline-none ring-4 ring-primary-500/40)']" />
          </SliderRoot>
          <div :class="['flex items-center gap-2']">
            <span :class="['size-4 rounded-full bg-primary-500']" aria-hidden="true" />
            <span :class="['size-4 rounded-full bg-primary-300']" aria-hidden="true" />
            <span :class="['size-4 rounded-full bg-primary-700']" aria-hidden="true" />
            <button type="button" :class="['btn ml-auto text-xs']" :disabled="Math.round(hue) === DEFAULT_HUE" @click="reset">
              <span class="i-mingcute-refresh-2-line" aria-hidden="true" />Reset
            </button>
          </div>
          <PopoverArrow :class="['floating-arrow']" />
        </AnimatedContent>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
