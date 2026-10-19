<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'

import type { MetricDefinition } from '../../../src/shared/contract'
import type { CaseFilters, CaseRow } from '../caseMetrics'
import type { BesideTarget } from './MetricBesideCard.vue'

import { DropdownMenuContent, DropdownMenuItemIndicator, DropdownMenuPortal, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import { computed, shallowRef, useTemplateRef, watch } from 'vue'

import AnimatedContent from './AnimatedContent.vue'
import MetricBesideCard from './MetricBesideCard.vue'

import { formatScore } from '../format'

/**
 * Cases grouped by one category (a stratum, a grading rule, a matrix axis): one row per value with a horizontal bar of
 * its cases in the chart's colors, the group's mean exact score (or pass rate without scores), and its case count.
 * Rows are sorted by that score, lowest first, so the groups that pull the score down lead. Clicking a row picks its
 * value, like clicking it on a chart axis.
 *
 * Use when:
 * - reading where a score comes from across the values of one category, side by side, without a chart to decode
 */
const props = defineProps<{
  /** Category axes the cases can be grouped by. */
  categories: readonly string[]
  colorOf: (row: CaseRow) => string
  /** Definition of a category (label, description) for the details beside the menu. */
  definitionOf: (name: string) => MetricDefinition | undefined
  filters: CaseFilters
  labelOf: (name: string) => string
  /** Colors of the legend in its order, so the segments of every bar stack the same way. */
  legendColors: readonly string[]
  rows: readonly CaseRow[]
  /** Every case's value of a category, for the distribution beside the menu. */
  valuesOf: (name: string) => readonly unknown[]
}>()
const emit = defineEmits<{ pick: [name: string, value: string] }>()

/** Group by the first category that is not the outcome itself; `state` only when nothing else exists. */
const picked = shallowRef<string>()
const groupBy = computed<string>({
  get: () => (picked.value != null && props.categories.includes(picked.value) ? picked.value : props.categories.find(name => name !== 'state' && name !== 'exact') ?? props.categories[0] ?? 'state'),
  set: (name) => {
    picked.value = name
  },
})
watch(() => props.categories, (names) => {
  if (picked.value != null && !names.includes(picked.value))
    picked.value = undefined
})

/** The category under the pointer or the keyboard in the open menu, described beside it. */
const highlighted = shallowRef<BesideTarget>()
const menu = useTemplateRef<ComponentPublicInstance>('menu')
const menuElement = computed(() => (menu.value?.$el instanceof HTMLElement ? menu.value.$el : undefined))

const scored = computed(() => props.rows.some(row => row.numbers.exact != null))
const groups = computed(() => {
  const name = groupBy.value
  const byValue = new Map<string, CaseRow[]>()
  for (const row of props.rows) {
    const value = row.categories[name]
    if (value == null)
      continue
    const list = byValue.get(value)
    if (list == null)
      byValue.set(value, [row])
    else
      list.push(row)
  }
  const colorRank = new Map(props.legendColors.map((color, index) => [color, index]))
  return [...byValue].map(([value, rows]) => {
    const scores = rows.map(row => row.numbers.exact).filter((score): score is number => score != null)
    const finished = rows.filter(row => row.state === 'passed' || row.state === 'failed' || row.state === 'errored' || row.state === 'timeout')
    const score = scored.value
      ? (scores.length === 0 ? null : scores.reduce((sum, item) => sum + item, 0) / scores.length)
      : (finished.length === 0 ? null : finished.filter(row => row.state === 'passed').length / finished.length)
    // Cases per color, in legend order, so equal colors line up from bar to bar.
    const counts = new Map<string, number>()
    for (const row of rows)
      counts.set(props.colorOf(row), (counts.get(props.colorOf(row)) ?? 0) + 1)
    const segments = [...counts].sort(([a], [b]) => (colorRank.get(a) ?? Infinity) - (colorRank.get(b) ?? Infinity)).map(([color, count]) => ({ color, count, width: `${(count / rows.length) * 100}%` }))
    return { active: props.filters.categories[name]?.has(value) === true, count: rows.length, score, segments, value }
  }).sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity) || b.count - a.count)
})
</script>

<template>
  <div :class="['grid gap-2']" data-testid="group-bars">
    <div :class="['flex flex-wrap items-center gap-2 text-xs']">
      <DropdownMenuRoot @update:open="open => { if (!open) highlighted = undefined }">
        <DropdownMenuTrigger :class="['option-trigger max-w-60']" data-testid="group-by">
          <span :class="['muted shrink-0']">Group by</span><span :class="['truncate']">{{ props.labelOf(groupBy) }}</span><span class="i-mingcute-down-line muted" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent as-child align="start" :side-offset="6" :collision-padding="12" :class="['floating min-w-52 p-1 text-sm']">
            <AnimatedContent ref="menu">
              <DropdownMenuRadioGroup v-model="groupBy" :class="['max-h-[min(24rem,var(--reka-dropdown-menu-content-available-height))] overflow-y-auto']">
                <DropdownMenuRadioItem v-for="name in props.categories" :key="name" :value="name" :class="['menu-item']" @focus="(event: FocusEvent) => highlighted = { item: event.currentTarget as Element, name }">
                  <span :class="['size-4 shrink-0 grid place-items-center']">
                    <DropdownMenuItemIndicator><span class="i-mingcute-check-line" aria-hidden="true" /></DropdownMenuItemIndicator>
                  </span>
                  <span :class="['truncate']">{{ props.labelOf(name) }}</span>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </AnimatedContent>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
      <MetricBesideCard :anchor="menuElement" :target="highlighted" :definition-of="props.definitionOf" :values-of="props.valuesOf" />
      <span class="muted">{{ scored ? 'mean exact score' : 'pass rate' }} per group, lowest first · bars colored like the chart · click a group to select it</span>
    </div>
    <ul :class="['m-0 p-0 list-none grid']">
      <li v-for="group in groups" :key="group.value">
        <button
          type="button"
          :class="['grid w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-neutral-500/8 focus-visible:(outline-2 outline-primary-500)', 'grid-cols-[minmax(6rem,12rem)_minmax(0,1fr)_4rem_3rem]', group.active && 'selected']"
          :aria-pressed="group.active"
          data-testid="group-bar"
          @click="emit('pick', groupBy, group.value)"
        >
          <span :class="['truncate']" :title="group.value">{{ group.value }}</span>
          <span :class="['flex h-2 gap-[2px] overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800']" role="img" :aria-label="`${group.count} cases`">
            <span v-for="segment in group.segments" :key="segment.color" :class="['h-full rounded-full min-w-1.5']" :style="{ background: segment.color, width: segment.width }" />
          </span>
          <b :class="['mono text-right']">{{ formatScore(group.score) }}</b>
          <span :class="['mono text-xs muted text-right']">n={{ group.count }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
