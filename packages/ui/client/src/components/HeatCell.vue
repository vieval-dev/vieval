<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { HoverCardContent, HoverCardPortal, HoverCardRoot, HoverCardTrigger } from 'reka-ui'
import { DrawerContent, DrawerDescription, DrawerHandle, DrawerOverlay, DrawerPortal, DrawerRoot, DrawerTitle } from 'vaul-vue'
import { computed, shallowRef, useSlots } from 'vue'
import { useI18n } from 'vue-i18n'

import AnimatedContent from './AnimatedContent.vue'

/** How a {@link HeatCell} is filled. */
export interface HeatFill {
  /** Within noise: the fill stays faint whatever its strength. */
  faint?: boolean
  /** `gain` (a score, or a difference that is better) in the score hue; `loss` in its opposite hue. */
  hue: 'gain' | 'loss'
  /** Strength of the fill on its scale, 0–1. */
  strength: number
}

/**
 * One compact heat cell: a number on a fill whose strength follows its value, so a whole grid reads at a glance, with
 * its details in a hover card. Shared by the compact matrix ({@link MatrixHeatCell}) and the comparison's score table.
 *
 * Use for a grid of comparable values (scores, or differences from a baseline) where each cell has more to say than
 * its number. A baseline cell is unfilled inside a dashed outline; the best cell of its row or axis is outlined.
 *
 * NOTICE:
 * The fill stays within 10–50% and the text keeps the page's ink. Measured on the card surfaces (WCAG contrast), the
 * page ink over a 50% fill of the score hue or its opposite is at least 5.7:1 in both themes; above 60% it falls under
 * 4.5:1 for some hue, and a dark or white ink there (the former `--heat-ink`) stayed under 4.5:1 for the loss hue on
 * dark pages.
 */
const props = defineProps<{
  /** Outlined: the best cell of its row (matrix) or axis (score table). */
  best?: boolean
  /** Narrow cells for wide grids: smaller type. */
  dense?: boolean
  /** The cell has no value: gray and muted. */
  empty?: boolean
  /** `undefined` leaves the cell unfilled (no value, an incomplete cell). */
  fill?: HeatFill
  /** As wide as its column (at least a compact cell), for values with a unit such as "−25.0 pt". */
  fit?: boolean
  href?: string
  /** The baseline's own cell: unfilled inside a dashed outline, for the differences around it. */
  isBase?: boolean
  testId?: string
  text: string
}>()
defineSlots<{
  /** Marks drawn inside the cell (a completion ring). */
  default?: () => unknown
  /** Body of the hover card. */
  detail?: () => unknown
}>()

const { t } = useI18n()
const slots = useSlots()
const isDesktop = useMediaQuery('(min-width: 768px)')
/** The phone drawer of the cell's details. */
const open = shallowRef(false)
function tap(event: MouseEvent): void {
  if (slots.detail == null)
    return
  event.preventDefault()
  open.value = true
}

const style = computed(() => {
  if (props.fill == null || props.isBase)
    return undefined
  const mix = Math.round(10 + props.fill.strength * 40)
  const hue = props.fill.hue === 'loss' ? 'var(--series-1-opposite)' : 'var(--series-1)'
  return { background: `color-mix(in oklab, ${hue} ${props.fill.faint ? Math.min(mix, 18) : mix}%, transparent)` }
})
/** Attributes of the cell element, shared by the desktop (hover card) and phone (drawer) variants. */
const cell = computed(() => ({
  'class': [
    'relative flex items-center justify-center rounded-md tabular-nums transition-[outline-color]',
    'outline-2 -outline-offset-2 outline outline-transparent hover:outline-neutral-500/50 focus-visible:outline-primary-500',
    props.dense ? 'w-10 h-7 text-[11px]' : 'text-sm',
    // A fitted cell fills its table cell both ways (at least a compact cell), so a table can stretch to its card.
    !props.dense && (props.fit ? 'min-w-15 w-full min-h-9 h-full px-1.5 whitespace-nowrap' : 'w-15 h-9'),
    (props.empty || (props.fill == null && !props.isBase)) && 'bg-neutral-500/10 muted',
    props.isBase && 'muted outline-dashed',
    // One outline color per cell, so a cell never carries two competing `!` colors: the best cell (a baseline one keeps
    // its dashes) in the theme hue at half strength, 700 on light pages and 200 on dark ones. It previously used neutral
    // black and white, then full 900 / 100, 600 / 300, and 400 / 500 shades, which all read as heavier than the fills.
    props.best ? 'font-semibold outline-primary-700/50! dark:outline-primary-200/50!' : props.isBase && 'outline-neutral-400/70! dark:outline-neutral-500/70!',
  ],
  'data-testid': props.testId,
  'href': props.href,
  'style': style.value,
  'tabindex': props.href ? undefined : 0,
}))
</script>

<template>
  <!-- Opens at once, as the plane's and the axis pickers' cards do; the short close delay lets the pointer move into it.
       No arrow: it was a fill without the card's border, so it read as a separate shape beside the card. -->
  <HoverCardRoot v-if="isDesktop" :open-delay="0" :close-delay="80">
    <HoverCardTrigger as-child>
      <component :is="props.href ? 'a' : 'span'" v-bind="cell">
        {{ props.text }}
        <slot />
      </component>
    </HoverCardTrigger>
    <HoverCardPortal v-if="$slots.detail">
      <HoverCardContent as-child side="right" align="start" :side-offset="6" :collision-padding="8" :class="['floating']">
        <AnimatedContent>
          <slot name="detail" />
        </AnimatedContent>
      </HoverCardContent>
    </HoverCardPortal>
  </HoverCardRoot>
  <!-- Phones have no hover: a tap opens the same details in a bottom drawer (the link, if any, moves into it), and the
       tapped cell stays outlined while the drawer is open, as the plane's dots do. -->
  <template v-else>
    <component :is="props.href && !$slots.detail ? 'a' : 'span'" v-bind="cell" :class="[open && 'outline-primary-500!']" @click="tap">
      {{ props.text }}
      <slot />
    </component>
    <DrawerRoot v-if="$slots.detail" v-model:open="open">
      <DrawerPortal>
        <DrawerOverlay :class="['fixed inset-0 z-50 bg-black/40']" />
        <DrawerContent :class="['floating fixed inset-x-0 bottom-0 max-h-[85dvh] flex flex-col gap-3 rounded-b-none! rounded-t-2xl! border-b-0! px-4 pt-3 pb-6 outline-none']">
          <DrawerHandle :class="['bg-neutral-300! dark:bg-neutral-600!']" />
          <DrawerTitle :class="['sr-only']">
            {{ props.text }}
          </DrawerTitle>
          <DrawerDescription :class="['sr-only']">
            {{ t('common.cellDetails') }}
          </DrawerDescription>
          <div :class="['overflow-y-auto min-h-0']">
            <slot name="detail" />
          </div>
          <a v-if="props.href" :href="props.href" :class="['btn justify-center py-2.5! text-sm! font-medium bg-primary-500/15! text-primary-800! dark:text-primary-200!']">
            <span class="i-mingcute-arrow-right-up-line" aria-hidden="true" />{{ t('common.open') }}
          </a>
        </DrawerContent>
      </DrawerPortal>
    </DrawerRoot>
  </template>
</template>
