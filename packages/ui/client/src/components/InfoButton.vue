<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { PopoverArrow, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { DrawerContent, DrawerDescription, DrawerHandle, DrawerOverlay, DrawerPortal, DrawerRoot, DrawerTitle } from 'vaul-vue'
import { shallowRef } from 'vue'

import AnimatedContent from './AnimatedContent.vue'

/**
 * An "ⓘ" icon button that opens secondary facts the page does not print inline (raw identifiers, how a number is
 * computed). A popover on desktop, a bottom drawer on phones, with the same body from the default slot.
 *
 * Use when:
 * - a fact helps when asked for but would crowd the layout, especially on phones
 */
const props = defineProps<{
  /** What the facts are about (`Run details`): the button's accessible name and the drawer's title. */
  label: string
}>()

const isDesktop = useMediaQuery('(min-width: 768px)')
const open = shallowRef(false)
const trigger = ['icon-btn', 'size-6! text-sm! muted']
</script>

<template>
  <PopoverRoot v-if="isDesktop" v-model:open="open">
    <PopoverTrigger :class="trigger" :aria-label="props.label" :title="props.label" data-testid="info-button">
      <span class="i-mingcute-information-line" aria-hidden="true" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent as-child align="start" :side-offset="6" :collision-padding="12" :class="['floating p-3 text-xs font-normal select-text outline-none']">
        <AnimatedContent>
          <!-- The content scrolls inside: `AnimatedContent` clips its own root. -->
          <div :class="['w-96 max-w-[calc(100vw-2rem)] max-h-[min(32rem,var(--reka-popover-content-available-height))] overflow-y-auto']">
            <slot />
          </div>
          <PopoverArrow :class="['floating-arrow']" />
        </AnimatedContent>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
  <DrawerRoot v-else v-model:open="open">
    <button type="button" :class="trigger" :aria-label="props.label" :title="props.label" data-testid="info-button" @click="open = true">
      <span class="i-mingcute-information-line" aria-hidden="true" />
    </button>
    <DrawerPortal>
      <DrawerOverlay :class="['fixed inset-0 z-50 bg-black/40']" />
      <DrawerContent :class="['floating fixed inset-x-0 bottom-0 max-h-[85dvh] flex flex-col gap-3 rounded-b-none! rounded-t-2xl! border-b-0! px-4 pt-3 pb-6 text-sm font-normal outline-none']">
        <DrawerHandle :class="['bg-neutral-300! dark:bg-neutral-600!']" />
        <DrawerTitle :class="['text-sm font-semibold']">
          {{ props.label }}
        </DrawerTitle>
        <DrawerDescription :class="['sr-only']">
          {{ props.label }}
        </DrawerDescription>
        <div :class="['overflow-y-auto min-h-0']">
          <slot />
        </div>
      </DrawerContent>
    </DrawerPortal>
  </DrawerRoot>
</template>
