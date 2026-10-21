<script setup lang="ts">
import type { CaseTable, MetricSeparation } from '../caseMetrics'
import type { ColumnDefinition } from '../scores'

import { useMediaQuery } from '@vueuse/core'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { DrawerContent, DrawerDescription, DrawerHandle, DrawerOverlay, DrawerPortal, DrawerRoot, DrawerTitle } from 'vaul-vue'
import { shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import AnimatedContent from './AnimatedContent.vue'
import AxisPickerList from './AxisPickerList.vue'

/**
 * Picks the axes of the case charts behind one button ("Axes · 7"), so the panel opens on the chart instead of a wall
 * of chips. A popover on desktop, a bottom drawer on phones, both around {@link AxisPickerList}.
 */
const props = defineProps<{
  /** Definition of a metric (label, description, unit) for its details. */
  definitionOf: (name: string) => ColumnDefinition | undefined
  labelOf: (name: string) => string
  separation: ReadonlyMap<string, MetricSeparation>
  table: CaseTable
  /** Every case's value of a metric or category, for the distribution in its details. */
  valuesOf: (name: string) => readonly unknown[]
}>()
/** Numeric axes on the chart, in chart order. */
const metrics = defineModel<string[]>('metrics', { required: true })
/** Category axes on the chart. */
const categories = defineModel<string[]>('categories', { required: true })

// TODO: preset views ("Outcome", "AUV health", "Cost") as one-click axis sets, later declared by eval authors in the
// vieval config.

const { t } = useI18n()
const isDesktop = useMediaQuery('(min-width: 768px)')
const open = shallowRef(false)
const trigger = 'option-trigger'
</script>

<template>
  <PopoverRoot v-if="isDesktop" v-model:open="open">
    <PopoverTrigger :class="[trigger]" data-testid="axis-picker">
      <span class="muted">{{ t('metrics.axes.title') }}</span><span :class="['tabular-nums']">{{ metrics.length + categories.length }}</span><span class="i-mingcute-down-line muted" aria-hidden="true" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent as-child align="start" :side-offset="6" :collision-padding="12" :class="['floating w-[26rem] max-w-[calc(100vw-1.5rem)] text-sm outline-none']">
        <AnimatedContent>
          <!-- reka sets the space left under the trigger on the content; the list scrolls inside it. -->
          <AxisPickerList v-model:metrics="metrics" v-model:categories="categories" :class="['max-h-[min(32rem,var(--reka-popover-content-available-height))]']" details="hover" :definition-of="props.definitionOf" :label-of="props.labelOf" :separation="props.separation" :table="props.table" :values-of="props.valuesOf" />
        </AnimatedContent>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
  <DrawerRoot v-else v-model:open="open">
    <button type="button" :class="[trigger]" data-testid="axis-picker" @click="open = true">
      <span class="muted">{{ t('metrics.axes.title') }}</span><span :class="['tabular-nums']">{{ metrics.length + categories.length }}</span><span class="i-mingcute-down-line muted" aria-hidden="true" />
    </button>
    <DrawerPortal>
      <DrawerOverlay :class="['fixed inset-0 z-50 bg-black/40']" />
      <DrawerContent :class="['floating fixed inset-x-0 bottom-0 max-h-[85dvh] flex flex-col rounded-b-none! rounded-t-2xl! border-b-0! pb-6 text-sm outline-none']">
        <DrawerHandle :class="['mt-3 bg-neutral-300! dark:bg-neutral-600!']" />
        <DrawerTitle :class="['sr-only']">
          {{ t('metrics.axes.title') }}
        </DrawerTitle>
        <DrawerDescription :class="['sr-only']">
          {{ t('metrics.axes.description') }}
        </DrawerDescription>
        <AxisPickerList v-model:metrics="metrics" v-model:categories="categories" :class="['flex-1']" details="drawer" :definition-of="props.definitionOf" :label-of="props.labelOf" :separation="props.separation" :table="props.table" :values-of="props.valuesOf" />
      </DrawerContent>
    </DrawerPortal>
  </DrawerRoot>
</template>
