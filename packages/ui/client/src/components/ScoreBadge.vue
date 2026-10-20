<script setup lang="ts">
import type { ScoreRecordedData } from 'vieval/events'

import type { ScoreDefinition } from '../../../src/shared/contract'

import { useMediaQuery } from '@vueuse/core'
import { PopoverArrow, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { DrawerContent, DrawerDescription, DrawerHandle, DrawerOverlay, DrawerPortal, DrawerRoot, DrawerTitle } from 'vaul-vue'
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import AnimatedContent from './AnimatedContent.vue'
import ScoreDetail from './ScoreDetail.vue'

import { scoreLabel } from '../scores'

/**
 * One score of a case as a badge (`Pass 100.0%`); opening it shows {@link ScoreDetail}: why the score has its value,
 * what graded it, and the grader's model calls. A popover on desktop, a bottom drawer on phones, with the same body.
 */
const props = defineProps<{
  callCount: number
  callsHref?: string
  definitions: readonly ScoreDefinition[]
  name: string
  record?: ScoreRecordedData
  /** The value as shown: a percentage, an unscored reason, or `—`. */
  text: string
}>()

const { t } = useI18n()
const isDesktop = useMediaQuery('(min-width: 768px)')
const open = shallowRef(false)
const label = computed(() => scoreLabel(props.name, props.definitions))
const unscored = computed(() => props.record != null && 'unscored' in props.record)
const badge = computed(() => ['badge cursor-pointer transition-colors hover:bg-primary-500/10 focus-visible:(outline-2 outline-primary-500)', unscored.value ? 'state-interrupted' : 'state-neutral'])
</script>

<template>
  <PopoverRoot v-if="isDesktop" v-model:open="open">
    <PopoverTrigger :class="badge" :title="props.name" data-testid="score-badge">
      {{ label }} {{ props.text }}<span class="i-mingcute-down-line opacity-60" aria-hidden="true" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent as-child align="end" :side-offset="6" :collision-padding="12" :class="['floating p-3 text-xs select-text outline-none']">
        <AnimatedContent>
          <!-- The content scrolls inside: `AnimatedContent` clips its own root. -->
          <div :class="['w-80 max-w-[calc(100vw-2rem)] max-h-[min(32rem,var(--reka-popover-content-available-height))] overflow-y-auto']">
            <ScoreDetail :call-count="props.callCount" :calls-href="props.callsHref" :definitions="props.definitions" :name="props.name" :record="props.record" :text="props.text" />
          </div>
          <PopoverArrow :class="['floating-arrow']" />
        </AnimatedContent>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
  <DrawerRoot v-else v-model:open="open">
    <button type="button" :class="badge" :title="props.name" data-testid="score-badge" @click="open = true">
      {{ label }} {{ props.text }}<span class="i-mingcute-down-line opacity-60" aria-hidden="true" />
    </button>
    <DrawerPortal>
      <DrawerOverlay :class="['fixed inset-0 z-50 bg-black/40']" />
      <DrawerContent :class="['floating fixed inset-x-0 bottom-0 max-h-[85dvh] flex flex-col gap-3 rounded-b-none! rounded-t-2xl! border-b-0! px-4 pt-3 pb-6 text-sm outline-none']">
        <DrawerHandle :class="['bg-neutral-300! dark:bg-neutral-600!']" />
        <DrawerTitle :class="['sr-only']">
          {{ label }}
        </DrawerTitle>
        <DrawerDescription :class="['sr-only']">
          {{ t('scores.detail.drawerDescription') }}
        </DrawerDescription>
        <div :class="['overflow-y-auto min-h-0']">
          <ScoreDetail :call-count="props.callCount" :calls-href="props.callsHref" :definitions="props.definitions" :name="props.name" :record="props.record" :text="props.text" />
        </div>
      </DrawerContent>
    </DrawerPortal>
  </DrawerRoot>
</template>
