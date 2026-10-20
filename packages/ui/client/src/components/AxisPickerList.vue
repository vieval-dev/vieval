<script setup lang="ts">
import type { CaseTable, MetricSeparation } from '../caseMetrics'
import type { ColumnDefinition } from '../scores'
import type { BesideTarget } from './MetricBesideCard.vue'

import { DrawerContent, DrawerDescription, DrawerHandle, DrawerOverlay, DrawerPortal, DrawerRootNested, DrawerTitle } from 'vaul-vue'
import { computed, shallowRef, useTemplateRef } from 'vue'

import MetricBesideCard from './MetricBesideCard.vue'
import MetricSummary from './MetricSummary.vue'

import { localize } from '../localize'

/**
 * Body of {@link AxisPicker}: a search box and the axes grouped as on the chart, available (metrics ranked by how
 * well they separate failed from passed cases), repeats of another metric, and hidden automatically. Shared by the
 * desktop popover and the phone drawer, the same way AIRI's Live2D report shares its content.
 */
const props = defineProps<{
  definitionOf: (name: string) => ColumnDefinition | undefined
  /**
   * How a metric's details open: `hover` (desktop popover) floats them beside the row; `drawer` (phone) shows the
   * description as one line under the name and opens the details in a second drawer from an info button.
   */
  details: 'drawer' | 'hover'
  labelOf: (name: string) => string
  separation: ReadonlyMap<string, MetricSeparation>
  table: CaseTable
  valuesOf: (name: string) => readonly unknown[]
}>()
/** Numeric axes on the chart, in chart order. */
const metrics = defineModel<string[]>('metrics', { required: true })
/** Category axes on the chart. */
const categories = defineModel<string[]>('categories', { required: true })

const query = shallowRef('')
function matches(name: string) {
  const text = query.value.trim().toLowerCase()
  return text === '' || name.toLowerCase().includes(text) || props.labelOf(name).toLowerCase().includes(text)
}
const aucOf = (name: string) => props.separation.get(name)?.auc
const byAuc = (a: string, b: string) => (aucOf(b) ?? 0) - (aucOf(a) ?? 0)

const onChart = computed(() => [...categories.value, ...metrics.value].filter(matches))
const available = computed(() => [
  ...props.table.groups.map(group => group.representative).filter(name => !metrics.value.includes(name)).toSorted(byAuc),
  ...props.table.categories.filter(name => !categories.value.includes(name)),
].filter(matches))
const repeats = computed(() => props.table.groups.flatMap(group => group.members
  .filter(member => !metrics.value.includes(member.name) && matches(member.name))
  .map(member => ({ ...member, of: group.representative }))))

function toggle(name: string): void {
  const list = props.table.categories.includes(name) ? categories : metrics
  list.value = list.value.includes(name) ? list.value.filter(item => item !== name) : [...list.value, name]
}

/** The metric under the pointer or the keyboard, described beside the list (desktop). */
const highlighted = shallowRef<BesideTarget>()
const listRoot = useTemplateRef<HTMLElement>('listRoot')
/** The metric whose details are open in the second drawer (phones). */
const detail = shallowRef<string>()
const descriptionOf = (name: string) => localize(props.definitionOf(name)?.description)
const onChartNames = computed(() => new Set([...categories.value, ...metrics.value]))

const row = 'flex items-center gap-2.5 w-full rounded-md px-2 py-1.5 text-left hover:bg-neutral-500/8 focus-visible:(outline-2 outline-primary-500)'
const heading = 'px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider muted'
/** Checkbox glyphs sized to the row text, so they read as controls and are easy to aim at. */
const check = 'shrink-0 text-lg'
</script>

<template>
  <div ref="listRoot" :class="['flex flex-col min-h-0']" @pointerleave="highlighted = undefined">
    <div :class="['p-2 border-b border-neutral-200/70 dark:border-neutral-700/50']">
      <input v-model="query" type="search" placeholder="Search metrics…" aria-label="Search metrics" :class="['w-full rounded-md border border-neutral-300/70 dark:border-neutral-700/60 bg-transparent px-2.5 py-1.5 outline-none focus-visible:(border-primary-500)']">
    </div>
    <div :class="['overflow-y-auto min-h-0 p-1']" data-testid="axis-picker-list">
      <div :class="[heading]">
        On the chart
      </div>
      <div v-for="name in onChart" :key="name" :class="['flex items-center gap-1']">
        <button type="button" :class="[row, 'flex-1 min-w-0']" :aria-pressed="true" @click="toggle(name)" @focus="event => highlighted = { item: event.currentTarget as Element, name }" @pointerenter="event => highlighted = { item: event.currentTarget as Element, name }">
          <span :class="['i-mingcute-checkbox-fill text-primary-600 dark:text-primary-300', check]" aria-hidden="true" />
          <span :class="['flex flex-col min-w-0']"><span :class="['truncate']" :title="name">{{ props.labelOf(name) }}</span><span v-if="props.details === 'drawer' && descriptionOf(name)" :class="['truncate text-xs muted']">{{ descriptionOf(name) }}</span></span>
          <span v-if="aucOf(name) !== undefined" :class="['ml-auto mono text-xs muted']">AUC {{ aucOf(name)!.toFixed(2) }}</span>
        </button>
        <button v-if="props.details === 'drawer'" type="button" :class="['icon-btn size-10']" :aria-label="`Details of ${props.labelOf(name)}`" @click="detail = name">
          <span class="i-mingcute-information-line" aria-hidden="true" />
        </button>
      </div>

      <div :class="[heading]">
        Available · best at telling failed from passed (or low from high scores) first
      </div>
      <div v-for="name in available" :key="name" :class="['flex items-center gap-1']">
        <button type="button" :class="[row, 'flex-1 min-w-0']" :aria-pressed="false" @click="toggle(name)" @focus="event => highlighted = { item: event.currentTarget as Element, name }" @pointerenter="event => highlighted = { item: event.currentTarget as Element, name }">
          <span :class="['i-mingcute-square-line muted', check]" aria-hidden="true" />
          <span :class="['flex flex-col min-w-0']"><span :class="['truncate']" :title="name">{{ props.labelOf(name) }}</span><span v-if="props.details === 'drawer' && descriptionOf(name)" :class="['truncate text-xs muted']">{{ descriptionOf(name) }}</span></span>
          <span v-if="table.categories.includes(name)" :class="['ml-auto text-xs muted']">category</span>
          <!-- Separation as a bar from 0.5 (none) to 1 (perfect), with the AUC beside it. -->
          <span v-else-if="aucOf(name) !== undefined" :class="['ml-auto flex items-center gap-1.5 shrink-0']" :title="`AUC ${aucOf(name)!.toFixed(2)}: higher in ${separation.get(name)!.higherIn} cases`">
            <span :class="['block w-16 h-1.5 rounded-full bg-neutral-500/15 overflow-hidden']">
              <span :class="['block h-full bg-[var(--series-1)]']" :style="{ width: `${(aucOf(name)! - 0.5) * 200}%` }" />
            </span>
            <span :class="['mono text-xs muted w-8 text-right']">{{ aucOf(name)!.toFixed(2) }}</span>
          </span>
        </button>
        <button v-if="props.details === 'drawer'" type="button" :class="['icon-btn size-10']" :aria-label="`Details of ${props.labelOf(name)}`" @click="detail = name">
          <span class="i-mingcute-information-line" aria-hidden="true" />
        </button>
      </div>

      <template v-if="repeats.length > 0">
        <div :class="[heading]">
          Repeats of a metric above
        </div>
        <div v-for="member in repeats" :key="member.name" :class="['flex items-center gap-1']">
          <button type="button" :class="[row, 'flex-1 min-w-0']" :aria-pressed="false" @click="toggle(member.name)" @focus="event => highlighted = { item: event.currentTarget as Element, name: member.name }" @pointerenter="event => highlighted = { item: event.currentTarget as Element, name: member.name }">
            <span :class="['i-mingcute-square-line muted', check]" aria-hidden="true" />
            <span :class="['flex flex-col min-w-0']"><span :class="['truncate']" :title="member.name">{{ props.labelOf(member.name) }}</span><span v-if="props.details === 'drawer' && descriptionOf(member.name)" :class="['truncate text-xs muted']">{{ descriptionOf(member.name) }}</span></span>
            <span :class="['ml-auto text-xs muted truncate']">≈ {{ props.labelOf(member.of) }} · r {{ member.r.toFixed(2) }}</span>
          </button>
          <button v-if="props.details === 'drawer'" type="button" :class="['icon-btn size-10']" :aria-label="`Details of ${props.labelOf(member.name)}`" @click="detail = member.name">
            <span class="i-mingcute-information-line" aria-hidden="true" />
          </button>
        </div>
      </template>

      <template v-if="table.constants.length + table.duplicates.length > 0">
        <div :class="[heading]">
          Hidden automatically
        </div>
        <p :class="['px-2 pb-2 m-0 muted leading-relaxed']">
          <span v-for="item in table.constants" :key="item.name" :class="['inline-block mr-2']">{{ props.labelOf(item.name) }} <span class="mono">= {{ item.value }}</span></span>
          <span v-for="item in table.duplicates" :key="item.name" :class="['inline-block mr-2']">{{ props.labelOf(item.name) }} = {{ props.labelOf(item.of) }}</span>
        </p>
      </template>
    </div>
    <MetricBesideCard v-if="props.details === 'hover'" :anchor="listRoot" :target="highlighted" :definition-of="props.definitionOf" :values-of="props.valuesOf" />
    <!-- Phones: a metric's details in a second drawer over the list; closing it returns to the list. -->
    <DrawerRootNested v-if="props.details === 'drawer'" :open="detail != null" @update:open="open => { if (!open) detail = undefined }">
      <DrawerPortal>
        <DrawerOverlay :class="['fixed inset-0 z-50 bg-black/40']" />
        <DrawerContent :class="['floating fixed inset-x-0 bottom-0 max-h-[80dvh] flex flex-col gap-3 rounded-b-none! rounded-t-2xl! border-b-0! px-4 pt-3 pb-6 text-sm outline-none']">
          <DrawerHandle :class="['bg-neutral-300! dark:bg-neutral-600!']" />
          <DrawerTitle :class="['sr-only']">
            {{ detail ? props.labelOf(detail) : '' }}
          </DrawerTitle>
          <DrawerDescription :class="['sr-only']">
            What the metric is and how its values spread.
          </DrawerDescription>
          <div v-if="detail" :class="['overflow-y-auto min-h-0 grid gap-3']">
            <MetricSummary :class="['w-full!']" :name="detail" :definition="props.definitionOf(detail)" :values="props.valuesOf(detail)" />
            <button type="button" :class="['btn justify-center', onChartNames.has(detail) && 'btn-active']" @click="toggle(detail)">
              <span :class="[onChartNames.has(detail) ? 'i-mingcute-checkbox-fill' : 'i-mingcute-square-line']" aria-hidden="true" />{{ onChartNames.has(detail) ? 'On the chart' : 'Add to the chart' }}
            </button>
          </div>
        </DrawerContent>
      </DrawerPortal>
    </DrawerRootNested>
  </div>
</template>
