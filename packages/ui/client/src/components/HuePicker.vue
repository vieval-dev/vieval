<script setup lang="ts">
import { PopoverArrow, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger, SliderRange, SliderRoot, SliderThumb, SliderTrack, SwitchRoot, SwitchThumb } from 'reka-ui'
import { computed, useId } from 'vue'

import AnimatedContent from './AnimatedContent.vue'
import IconButton from './IconButton.vue'

import { useColorVision } from '../composables/useColorVision'
import { useThemeHue } from '../composables/useThemeHue'
import { DEFAULT_HUE } from '../theme'

/**
 * Color settings: the theme hue, a slider over the OKLCH hue circle after airi's `ThemeColorsHueControl`
 * (`moeru-ai/airi`, `packages/stage-ui/stories/components/ThemeColorsHueControl.vue`), and, under Accessibility,
 * colorblind state colors (passed, failed, no result, running), which the hue never changes.
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

const { colorVision } = useColorVision()
const colorblind = computed({
  get: () => colorVision.value === 'safe',
  set: (value: boolean) => (colorVision.value = value ? 'safe' : 'default'),
})
const paletteLabelId = useId()
const colorblindLabelId = useId()
</script>

<template>
  <!-- Same anatomy as the other floating menus (`CompareMenu.vue`, `IdMenu.vue`): `p-1`, `text-xs muted` group labels,
       `px-2 py-1.5` rows, and a hairline separator between groups. -->
  <PopoverRoot>
    <PopoverTrigger as-child>
      <IconButton icon="i-mingcute-palette-line" label="Colors" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent as-child :side-offset="6" align="start" :class="['floating w-60 p-1 text-sm']">
        <AnimatedContent>
          <!-- Every section is a group label and `h-8` field rows: the field name on the left and its action on the right.
               A slider takes its own full-width line under its field row. -->
          <div :class="['px-2 py-1 text-xs muted']">
            Theme
          </div>
          <div :class="['flex items-center gap-3 h-8 px-2']">
            <span :id="paletteLabelId">Palette</span>
            <IconButton icon="i-mingcute-refresh-2-line" label="Reset palette" :class="['ml-auto -mr-1.5']" :disabled="Math.round(hue) === DEFAULT_HUE" @click="reset" />
          </div>
          <div :class="['px-2 pb-2']">
            <SliderRoot v-model="model" :min="0" :max="360" :step="1" :aria-labelledby="paletteLabelId" :class="['relative flex items-center h-5 w-full touch-none select-none']" data-testid="hue-slider">
              <SliderTrack :class="['relative h-3 grow rounded-full']" :style="{ background: gradient }">
                <SliderRange :class="['absolute h-full rounded-full bg-transparent']" />
              </SliderTrack>
              <SliderThumb aria-label="Hue" :class="['block size-4 rounded-full bg-primary-400 shadow ring-2 ring-white dark:ring-neutral-900 focus-visible:(outline-none ring-4 ring-primary-500/40)']" />
            </SliderRoot>
          </div>
          <div :class="['my-1 h-px bg-neutral-200 dark:bg-neutral-800']" role="separator" />
          <div :class="['px-2 py-1 text-xs muted']">
            Accessibility
          </div>
          <div :class="['flex items-center gap-3 h-8 px-2']" title="Status in blue, orange, and yellow instead of green and red">
            <span :id="colorblindLabelId">Colorblind</span>
            <SwitchRoot v-model="colorblind" :aria-labelledby="colorblindLabelId" :class="['switch ml-auto']" data-testid="colorblind-switch">
              <SwitchThumb :class="['switch-thumb']" />
            </SwitchRoot>
          </div>
          <PopoverArrow :class="['floating-arrow']" />
        </AnimatedContent>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
