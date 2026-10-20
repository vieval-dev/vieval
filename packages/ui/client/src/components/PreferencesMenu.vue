<script setup lang="ts">
import type { LocalePreference, SupportedLocale } from '../i18n'

import { DropdownMenuArrow, DropdownMenuContent, DropdownMenuItemIndicator, DropdownMenuPortal, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuRoot, DropdownMenuTrigger, PopoverArrow, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger, SliderRange, SliderRoot, SliderThumb, SliderTrack, SwitchRoot, SwitchThumb } from 'reka-ui'
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import AnimatedContent from './AnimatedContent.vue'
import IconButton from './IconButton.vue'

import { useColorVision } from '../composables/useColorVision'
import { useLocale } from '../composables/useLocale'
import { useThemeHue } from '../composables/useThemeHue'
import { SUPPORTED_LOCALES } from '../i18n'
import { DEFAULT_HUE } from '../theme'

/**
 * Viewer preferences: the language (or the browser's), the theme hue, a slider over the OKLCH hue circle after airi's
 * `ThemeColorsHueControl` (`moeru-ai/airi`, `packages/stage-ui/stories/components/ThemeColorsHueControl.vue`), and,
 * under Accessibility, colorblind state colors (passed, failed, no result, running), which the hue never changes.
 */
const { t } = useI18n()

const { locale, preference } = useLocale()
/** "Auto (follow the browser)", then every locale by its native name, which a reader finds without knowing the UI's. */
const languageChoices = computed<{ label: string, lang?: SupportedLocale, value: LocalePreference }[]>(() => [
  { label: t('preferences.language.followBrowser'), value: 'auto' },
  ...(Object.entries(SUPPORTED_LOCALES) as [SupportedLocale, string][]).map(([value, label]) => ({ label, lang: value, value })),
])
const languageText = computed(() => (preference.value === 'auto' ? t('preferences.language.auto', { language: SUPPORTED_LOCALES[locale.value] }) : SUPPORTED_LOCALES[preference.value]))
/** reka-ui's radio group emits its value as a plain string. */
const languageModel = computed({
  get: () => preference.value,
  set: (value: string) => (preference.value = value as LocalePreference),
})

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
const languageLabelId = useId()
const languageValueId = useId()
const paletteLabelId = useId()
const colorblindLabelId = useId()
</script>

<template>
  <!-- Same anatomy as the other floating menus (`CompareMenu.vue`, `IdMenu.vue`): `p-1`, `text-xs muted` group labels,
       `px-2 py-1.5` rows, and a hairline separator between groups. -->
  <PopoverRoot>
    <PopoverTrigger as-child>
      <IconButton icon="i-mingcute-settings-3-line" :label="t('preferences.title')" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent as-child :side-offset="6" align="start" :collision-padding="12" :class="['floating w-60 p-1 text-sm']">
        <AnimatedContent>
          <!-- Every section is a group label and `h-8` field rows: the field name on the left and its action on the right.
               A slider takes its own full-width line under its field row. Language is one row that names itself, so it
               has no group label above it. -->
          <div :class="['flex items-center gap-3 h-8 px-2']">
            <span :id="languageLabelId">{{ t('preferences.language.title') }}</span>
            <DropdownMenuRoot>
              <!-- `py-1`: the trigger is as tall as the icon buttons of the other rows (`size-7`), inside the `h-8` row. -->
              <DropdownMenuTrigger :class="['option-trigger ml-auto -mr-1 py-1 min-w-0']" :aria-labelledby="`${languageLabelId} ${languageValueId}`" data-testid="language-trigger">
                <span :id="languageValueId" :class="['truncate']">{{ languageText }}</span><span class="i-mingcute-down-line muted shrink-0" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent as-child align="end" :side-offset="6" :collision-padding="12" :class="['floating min-w-48 p-1 text-sm']">
                  <AnimatedContent>
                    <DropdownMenuRadioGroup v-model="languageModel">
                      <DropdownMenuRadioItem v-for="choice in languageChoices" :key="choice.value" :value="choice.value" :lang="choice.lang" :class="['menu-item']">
                        <span :class="['size-4 shrink-0 grid place-items-center']">
                          <DropdownMenuItemIndicator><span class="i-mingcute-check-line" aria-hidden="true" /></DropdownMenuItemIndicator>
                        </span>
                        <span :class="['truncate']">{{ choice.label }}</span>
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                    <DropdownMenuArrow :class="['floating-arrow']" />
                  </AnimatedContent>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>
          </div>
          <div :class="['my-1 h-px bg-neutral-200 dark:bg-neutral-800']" role="separator" />
          <div :class="['px-2 py-1 text-xs muted']">
            {{ t('preferences.theme.title') }}
          </div>
          <div :class="['flex items-center gap-3 h-8 px-2']">
            <span :id="paletteLabelId">{{ t('preferences.theme.palette') }}</span>
            <IconButton icon="i-mingcute-refresh-2-line" :label="t('preferences.theme.resetPalette')" :class="['ml-auto -mr-1.5']" :disabled="Math.round(hue) === DEFAULT_HUE" @click="reset" />
          </div>
          <div :class="['px-2 pb-2']">
            <SliderRoot v-model="model" :min="0" :max="360" :step="1" :aria-labelledby="paletteLabelId" :class="['relative flex items-center h-5 w-full touch-none select-none']" data-testid="hue-slider">
              <SliderTrack :class="['relative h-3 grow rounded-full']" :style="{ background: gradient }">
                <SliderRange :class="['absolute h-full rounded-full bg-transparent']" />
              </SliderTrack>
              <SliderThumb :aria-label="t('preferences.theme.hue')" :class="['block size-4 rounded-full bg-primary-400 shadow ring-2 ring-white dark:ring-neutral-900 focus-visible:(outline-none ring-4 ring-primary-500/40)']" />
            </SliderRoot>
          </div>
          <div :class="['my-1 h-px bg-neutral-200 dark:bg-neutral-800']" role="separator" />
          <div :class="['px-2 py-1 text-xs muted']">
            {{ t('preferences.accessibility.title') }}
          </div>
          <div :class="['flex items-center gap-3 h-8 px-2']" :title="t('preferences.accessibility.colorblindHint')">
            <span :id="colorblindLabelId">{{ t('preferences.accessibility.colorblind') }}</span>
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
