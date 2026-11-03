<script setup lang="ts">
import type { BesideTarget } from './MetricBesideCard.vue'

import { useMediaQuery } from '@vueuse/core'
import { DropdownMenuArrow, DropdownMenuContent, DropdownMenuItemIndicator, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import { DrawerContent, DrawerDescription, DrawerHandle, DrawerOverlay, DrawerPortal, DrawerRoot, DrawerRootNested, DrawerTitle } from 'vaul-vue'
import { computed, shallowRef, useSlots, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import AnimatedContent from './AnimatedContent.vue'
import MetricBesideCard from './MetricBesideCard.vue'

/** One choice of a {@link ChoiceMenu}. */
export interface Choice {
  /** Heading the choice is listed under; consecutive choices with the same group share one heading. */
  group?: string
  label: string
  value: string
}

/**
 * Picks one of many behind an `option-trigger` ("X · Overall"): a reka-ui radio dropdown on desktop, as the matrix
 * baseline and the language preference pick theirs; a bottom drawer on phones, as the case charts pick their axes.
 * Use for an in-page choice with more values than a segmented control fits.
 *
 * With the `details` slot, each choice has a preview: on desktop it floats beside the menu, level with the row under
 * the pointer or the keyboard ({@link MetricBesideCard}, as the axis picker describes metrics); on phones an info
 * button on the row opens it in a second drawer.
 */
const props = defineProps<{
  choices: readonly Choice[]
  /** Muted name of what is picked, before the value. */
  label: string
  /**
   * `sm`: a compact trigger for a card's title bar or toolbar, read at the size of the text around it (as the language
   * picker of the preferences menu).
   * @default 'md'
   */
  size?: 'md' | 'sm'
  testId?: string
}>()
defineSlots<{
  /** Preview of a choice, beside the menu (desktop) or in a second drawer (phones). */
  details?: (props: { value: string }) => unknown
  /** Short note at the end of a choice's row, such as how many columns it tells apart. */
  suffix?: (props: { choice: Choice }) => unknown
}>()
const model = defineModel<string>({ required: true })
const slots = useSlots()

const { t } = useI18n()
const isDesktop = useMediaQuery('(min-width: 768px)')
const open = shallowRef(false)
const picked = computed(() => props.choices.find(choice => choice.value === model.value)?.label ?? model.value)
const groups = computed(() => {
  const list: { choices: Choice[], name?: string }[] = []
  for (const choice of props.choices) {
    const last = list.at(-1)
    if (last != null && last.name === choice.group)
      last.choices.push(choice)
    else
      list.push({ choices: [choice], name: choice.group })
  }
  return list
})

/** The choice under the pointer or the keyboard, previewed beside the menu (desktop). */
const highlighted = shallowRef<BesideTarget>()
const menu = useTemplateRef<HTMLElement>('menu')
/** The choice whose preview is open in the second drawer (phones). */
const detail = shallowRef<string>()
function pick(value: string): void {
  model.value = value
  open.value = false
}
const labelOf = (value: string) => props.choices.find(choice => choice.value === value)?.label ?? value
const heading = 'px-2 py-1 text-xs muted'
</script>

<template>
  <DropdownMenuRoot v-if="isDesktop" v-model:open="open" @update:open="value => { if (!value) highlighted = undefined }">
    <DropdownMenuTrigger :class="['option-trigger max-w-72', props.size === 'sm' && 'gap-1! rounded-md! px-2! py-0.5! text-xs! font-normal']" :data-testid="props.testId">
      <span :class="['muted shrink-0']">{{ props.label }}</span><span :class="['truncate']">{{ picked }}</span><span class="i-mingcute-down-line muted shrink-0" aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent as-child align="start" :side-offset="6" :collision-padding="12" :class="['floating min-w-56 p-1 text-sm']">
        <AnimatedContent>
          <!-- `AnimatedContent` clips its root, so a long list scrolls inside it. -->
          <div ref="menu" :class="['max-h-[min(28rem,var(--reka-dropdown-menu-content-available-height))] overflow-y-auto']" @pointerleave="highlighted = undefined">
            <DropdownMenuRadioGroup v-model="model">
              <template v-for="(group, index) in groups" :key="index">
                <DropdownMenuLabel v-if="group.name" :class="[heading, index > 0 && 'mt-1']">
                  {{ group.name }}
                </DropdownMenuLabel>
                <DropdownMenuRadioItem
                  v-for="choice in group.choices" :key="choice.value" :value="choice.value" :class="['menu-item']"
                  @focus="(event: FocusEvent) => highlighted = { item: event.currentTarget as Element, name: choice.value }"
                  @pointerenter="(event: PointerEvent) => highlighted = { item: event.currentTarget as Element, name: choice.value }"
                >
                  <span :class="['size-4 shrink-0 grid place-items-center']">
                    <DropdownMenuItemIndicator><span class="i-mingcute-check-line" aria-hidden="true" /></DropdownMenuItemIndicator>
                  </span>
                  <span :class="['truncate']">{{ choice.label }}</span>
                  <span v-if="$slots.suffix" :class="['ml-auto pl-4 shrink-0 text-xs muted tabular-nums']">
                    <slot name="suffix" :choice="choice" />
                  </span>
                </DropdownMenuRadioItem>
              </template>
            </DropdownMenuRadioGroup>
          </div>
          <DropdownMenuArrow :class="['floating-arrow']" />
        </AnimatedContent>
      </DropdownMenuContent>
    </DropdownMenuPortal>
    <MetricBesideCard v-if="slots.details" :anchor="menu" :target="open ? highlighted : undefined" @escape="open = false">
      <template #default="{ value }">
        <slot name="details" :value="value" />
      </template>
    </MetricBesideCard>
  </DropdownMenuRoot>

  <DrawerRoot v-else v-model:open="open">
    <button type="button" :class="['option-trigger max-w-72', props.size === 'sm' && 'gap-1! rounded-md! px-2! py-0.5! text-xs! font-normal']" :data-testid="props.testId" @click="open = true">
      <span :class="['muted shrink-0']">{{ props.label }}</span><span :class="['truncate']">{{ picked }}</span><span class="i-mingcute-down-line muted shrink-0" aria-hidden="true" />
    </button>
    <DrawerPortal>
      <DrawerOverlay :class="['fixed inset-0 z-50 bg-black/40']" />
      <DrawerContent :class="['floating fixed inset-x-0 bottom-0 max-h-[85dvh] flex flex-col rounded-b-none! rounded-t-2xl! border-b-0! pb-6 text-sm outline-none']">
        <DrawerHandle :class="['mt-3 bg-neutral-300! dark:bg-neutral-600!']" />
        <DrawerTitle :class="['px-4 pt-2 pb-1 text-sm font-semibold']">
          {{ props.label }}
        </DrawerTitle>
        <DrawerDescription :class="['sr-only']">
          {{ t('common.choice.description') }}
        </DrawerDescription>
        <div :class="['overflow-y-auto min-h-0 p-1']">
          <template v-for="(group, index) in groups" :key="index">
            <div v-if="group.name" :class="[heading, 'pt-3']">
              {{ group.name }}
            </div>
            <div v-for="choice in group.choices" :key="choice.value" :class="['flex items-center gap-1']">
              <button type="button" :class="['menu-item flex-1 min-w-0 text-left', choice.value === model && 'font-medium']" :aria-pressed="choice.value === model" @click="pick(choice.value)">
                <span :class="['size-4 shrink-0 grid place-items-center']">
                  <span v-if="choice.value === model" class="i-mingcute-check-line" aria-hidden="true" />
                </span>
                <span :class="['truncate']">{{ choice.label }}</span>
                <span v-if="$slots.suffix" :class="['ml-auto pl-3 shrink-0 text-xs muted tabular-nums']">
                  <slot name="suffix" :choice="choice" />
                </span>
              </button>
              <button v-if="$slots.details" type="button" :class="['icon-btn size-10']" :aria-label="t('common.choice.details', { choice: choice.label })" @click="detail = choice.value">
                <span class="i-mingcute-information-line" aria-hidden="true" />
              </button>
            </div>
          </template>
        </div>
        <!-- A choice's preview in a second drawer over the list; closing it returns to the list. -->
        <DrawerRootNested v-if="$slots.details" :open="detail != null" @update:open="value => { if (!value) detail = undefined }">
          <DrawerPortal>
            <DrawerOverlay :class="['fixed inset-0 z-50 bg-black/40']" />
            <DrawerContent :class="['floating fixed inset-x-0 bottom-0 max-h-[80dvh] flex flex-col gap-3 rounded-b-none! rounded-t-2xl! border-b-0! px-4 pt-3 pb-6 text-xs outline-none']">
              <DrawerHandle :class="['bg-neutral-300! dark:bg-neutral-600!']" />
              <DrawerTitle :class="['sr-only']">
                {{ detail ? labelOf(detail) : '' }}
              </DrawerTitle>
              <DrawerDescription :class="['sr-only']">
                {{ t('common.choice.description') }}
              </DrawerDescription>
              <div v-if="detail" :class="['overflow-y-auto min-h-0 grid gap-3']">
                <slot name="details" :value="detail" />
                <button type="button" :class="['btn justify-center', detail === model && 'btn-active']" @click="pick(detail); detail = undefined">
                  {{ t('common.choice.use', { choice: labelOf(detail) }) }}
                </button>
              </div>
            </DrawerContent>
          </DrawerPortal>
        </DrawerRootNested>
      </DrawerContent>
    </DrawerPortal>
  </DrawerRoot>
</template>
