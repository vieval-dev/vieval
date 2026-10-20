<script setup lang="ts">
import type { ScaleContinuousNumeric } from 'd3'

import type { CaseRow } from '../caseMetrics'
import type { ParallelAxis } from './ParallelCoordinates.vue'

import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui'
import { computed, shallowRef, watch } from 'vue'

import StateBadge from './StateBadge.vue'

/**
 * One case of the case charts, sized to be read at a glance: its state and the value of the axis under the pointer,
 * its name with its actions, its categories as one line of values, and only its most unusual metrics (furthest from
 * the median of all cases) with a small histogram each; the metrics near the median fold behind "more".
 *
 * Use inside the case charts' popover (desktop) or drawer (phones, `layout="drawer"`); `pinned` adds the actions.
 */
const props = defineProps<{
  /** Axis under the pointer (or where the case was pinned); its row is emphasized and its value leads the card. */
  activeAxis?: string
  axes: readonly ParallelAxis[]
  /** Formats a numeric value of an axis: a score as a percentage, a metric with its unit (`formatColumnValue`). */
  formatOf: (name: string, value: number) => string
  /** Link to the case page. */
  href: string
  labelOf: (name: string) => string
  /**
   * `popover` (desktop): compact rows, actions beside the name, rows of other axes faded.
   * `drawer` (phones): two-line rows with full values and full-width distributions, actions at the bottom, no fading
   * (a tap has no "axis under the pointer" to keep the others faded for).
   * @default 'popover'
   */
  layout?: 'drawer' | 'popover'
  pinned: boolean
  row: CaseRow
  /** Every case of the charts, the population the value is placed in. */
  rows: readonly CaseRow[]
  scales: Readonly<Record<string, ScaleContinuousNumeric<number, number>>>
  /** Cases per value of each category axis (`CaseTable.valueCounts`), for "46 / 361 cases". */
  valueCounts: Readonly<Record<string, ReadonlyMap<string, number>>>
}>()
const emit = defineEmits<{ unpin: [] }>()
const drawer = computed(() => props.layout === 'drawer')

/** Bins of each numeric row's histogram; enough to show a long tail or two peaks in a row about 10 rem wide. */
const BINS = 24

/**
 * Histogram of every metric axis over all cases, independent of the case shown, so moving between cases only moves
 * the marker. Bins are taken on the axis's own scale (symlog for heavy tails), the way the chart draws it.
 */
const distributions = computed(() => new Map(props.axes.filter(axis => axis.kind === 'numeric').map((axis) => {
  const position = props.scales[axis.name]?.copy().range([0, 1])
  const counts = Array.from<number>({ length: BINS }).fill(0)
  for (const row of props.rows) {
    const value = row.numbers[axis.name]
    if (value != null && position != null)
      counts[Math.min(BINS - 1, Math.max(0, Math.floor(position(value) * BINS)))]! += 1
  }
  const peak = Math.max(1, ...counts)
  return [axis.name, { heights: counts.map(count => count / peak), position }]
})))

const lines = computed(() => props.axes.map((axis) => {
  if (axis.kind === 'category') {
    const value = props.row.categories[axis.name]
    const counts = props.valueCounts[axis.name]
    const total = [...counts?.values() ?? []].reduce((sum, count) => sum + count, 0)
    return { detail: value == null ? '' : `${counts?.get(value) ?? 0} / ${total} cases`, kind: 'category' as const, name: axis.name, text: value ?? '—', value }
  }
  const distribution = distributions.value.get(axis.name)
  const value = props.row.numbers[axis.name]
  const heights = distribution?.heights ?? []
  if (value == null)
    return { bin: undefined, detail: '', heights, kind: 'numeric' as const, name: axis.name, notability: 0, position: undefined, text: '—' }
  const values = props.rows.map(row => row.numbers[axis.name]).filter((item): item is number => item != null)
  // Mid-rank percentile: cases below count fully and ties count half, so a value most cases share (0 AUV errors)
  // reads near p50 instead of p99.
  const below = values.filter(item => item < value).length
  const tied = values.filter(item => item === value).length
  const percentile = Math.round(((below + tied / 2) / values.length) * 100)
  const position = distribution?.position?.(value)
  const bin = position == null ? undefined : Math.min(BINS - 1, Math.max(0, Math.floor(position * BINS)))
  // How far the value sits from the middle of all cases: 0 at the median, 1 at either end.
  const notability = Math.abs(percentile - 50) / 50
  return { bin, detail: `p${percentile}`, heights, kind: 'numeric' as const, name: axis.name, notability, position, text: props.formatOf(axis.name, value) }
}))
/** Small round icon action beside the case name; finger-sized on phones (the card opens in a drawer there). */
const action = 'grid place-items-center size-9 md:size-6 shrink-0 rounded-full border border-neutral-200 dark:border-neutral-700/60 text-neutral-600 dark:text-neutral-300 transition-colors hover:(text-primary-700 dark:text-primary-200 border-primary-500/50 bg-primary-500/8) focus-visible:(outline-2 outline-offset-1 outline-primary-500)'
const active = computed(() => lines.value.find(line => line.name === props.activeAxis))

/** Numeric rows shown before "more": the values that sit furthest from the middle of all cases. */
const NOTABLE_ROWS = 4
/**
 * Categories read as one line of values (`multi_apps · ran out of steps · none`); the state is already the badge.
 * Their share bars said little, and a row each made the card the longest part of it.
 */
const categoryLine = computed(() => lines.value.filter(line => line.kind === 'category' && line.name !== 'state' && line.value != null))
/**
 * Text of one category value in the line; a bare flag says nothing alone, so it reads as the category's name.
 *
 * Before:
 * - "GUI only", "true" / "GUI only", "false" / "group", "multi_apps"
 *
 * After:
 * - "GUI only" / "not GUI only" / "multi_apps"
 */
function categoryText(name: string, value: string): string {
  if (value === 'true')
    return props.labelOf(name)
  if (value === 'false')
    return `not ${props.labelOf(name)}`
  return value
}
const numericLines = computed(() => lines.value.filter(line => line.kind === 'numeric'))
const notable = computed(() => {
  const ranked = numericLines.value.toSorted((a, b) => (b.kind === 'numeric' ? b.notability : 0) - (a.kind === 'numeric' ? a.notability : 0))
  const shown = ranked.slice(0, NOTABLE_ROWS)
  // The axis being read always has its row, even when its value is typical.
  const extra = numericLines.value.find(line => line.name === props.activeAxis && !shown.includes(line))
  return extra == null ? shown : [...shown, extra]
})
const typical = computed(() => numericLines.value.filter(line => !notable.value.includes(line)))
const showTypical = shallowRef(false)
// Another case starts folded again.
watch(() => props.row.key, () => {
  showTypical.value = false
})
const rows = computed(() => (showTypical.value ? [...notable.value, ...typical.value] : notable.value))
</script>

<template>
  <div :class="['grid w-full min-w-0', drawer ? 'gap-3' : 'gap-2']" data-testid="case-card">
    <div :class="['flex items-center gap-2 min-w-0']">
      <StateBadge :state="props.row.state" />
      <span v-if="active && !drawer" :class="['ml-auto flex items-baseline gap-1.5 min-w-0']" data-testid="case-card-active">
        <span :class="['muted truncate']">{{ props.labelOf(active.name) }}</span>
        <b :class="['mono text-sm whitespace-nowrap']">{{ active.text }}</b>
      </span>
    </div>
    <!-- Small round actions beside the name keep it as wide as possible; a preview ignores the pointer, so it has none. -->
    <div :class="['flex items-center gap-1 min-w-0']">
      <span :class="['mono font-medium min-w-0 flex-1', drawer ? 'text-sm break-all' : 'text-xs truncate']" :title="props.row.name">{{ props.row.name }}</span>
      <template v-if="props.pinned && !drawer">
        <TooltipRoot>
          <TooltipTrigger as-child>
            <a :href="props.href" :class="[action]" aria-label="Open case">
              <span class="i-mingcute-arrow-right-up-line" aria-hidden="true" />
            </a>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent :side-offset="4" :class="['tooltip']">
              Open case <kbd :class="['mono opacity-70']">Enter</kbd>
            </TooltipContent>
          </TooltipPortal>
        </TooltipRoot>
        <TooltipRoot>
          <TooltipTrigger as-child>
            <button type="button" :class="[action]" aria-label="Unpin" @click="emit('unpin')">
              <span class="i-mingcute-close-line" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent :side-offset="4" :class="['tooltip']">
              Unpin <kbd :class="['mono opacity-70']">Esc</kbd>
            </TooltipContent>
          </TooltipPortal>
        </TooltipRoot>
      </template>
    </div>
    <div v-if="categoryLine.length > 0" :class="['flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs', drawer && 'text-sm']" data-testid="case-card-categories">
      <template v-for="(line, index) in categoryLine" :key="line.name">
        <span v-if="index > 0" :class="['muted']" aria-hidden="true">·</span>
        <span :class="[line.name === props.activeAxis && 'font-semibold']" :title="`${props.labelOf(line.name)}: ${line.text} (${line.detail})`">{{ categoryText(line.name, line.text) }}</span>
      </template>
    </div>
    <div :class="['grid', drawer ? 'gap-2.5' : 'gap-1']">
      <div
        v-for="line in rows" :key="line.name"
        :class="[
          drawer ? 'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm' : 'grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_minmax(0,5.5rem)] items-center gap-2 transition-opacity',
          !drawer && props.activeAxis != null && line.name !== props.activeAxis && 'opacity-45',
        ]"
      >
        <span :class="['muted', drawer ? 'min-w-0' : 'truncate', line.name === props.activeAxis && 'text-neutral-900! dark:text-neutral-100! font-medium']" :title="line.name">{{ props.labelOf(line.name) }}</span>
        <!-- Drawer rows put the value on the label's line and the distribution under both, at full width. -->
        <span v-if="drawer" :class="['mono text-right break-all']">{{ line.text }}</span>
        <!--
          Where the value sits among all cases: a small histogram on the axis's scale, this case's bin solid and a tick
          at its exact value. (Categories are the line of values above, not rows.)
        -->
        <svg v-if="line.kind === 'numeric'" viewBox="0 0 96 14" preserveAspectRatio="none" :class="['w-full block', drawer ? 'col-span-2 h-5' : 'h-3.5']" role="img" :aria-label="`${props.labelOf(line.name)}: ${line.text}, ${line.detail}`">
          <title>{{ line.detail }}</title>
          <rect
            v-for="(height, index) in line.heights" :key="index"
            :x="index * 4 + 0.4" width="3.2" :y="14 - Math.max(height > 0 ? 1 : 0, height * 13)" :height="Math.max(height > 0 ? 1 : 0, height * 13)"
            fill="var(--series-1)" :fill-opacity="index === line.bin ? 1 : drawer ? 0.4 : 0.28"
          />
          <line v-if="line.position !== undefined" :x1="line.position * 96" :x2="line.position * 96" y1="0" y2="14" stroke="currentColor" stroke-width="1.2" vector-effect="non-scaling-stroke" />
        </svg>
        <span v-if="!drawer" :class="['mono text-right truncate']" :title="line.text">{{ line.text }}</span>
      </div>
    </div>
    <button
      v-if="typical.length > 0" type="button"
      :class="['justify-self-start inline-flex items-center gap-1 rounded px-1 -mx-1 text-xs muted hover:text-neutral-900 dark:hover:text-neutral-100 focus-visible:(outline-2 outline-primary-500)', drawer && 'text-sm py-1']"
      :aria-expanded="showTypical"
      @click="showTypical = !showTypical"
    >
      <span :class="['i-mingcute-right-line transition-transform', showTypical && 'rotate-90']" aria-hidden="true" />{{ showTypical ? 'Show fewer' : `${typical.length} more, near the median` }}
    </button>
    <!-- Drawer: the actions sit under the content, where the thumb already is. -->
    <div v-if="drawer && props.pinned" :class="['grid grid-cols-2 gap-2 pt-1']">
      <a :href="props.href" :class="['btn justify-center py-2.5! text-sm! font-medium bg-primary-500/15! text-primary-800! dark:text-primary-200!']">
        <span class="i-mingcute-arrow-right-up-line" aria-hidden="true" />Open case
      </a>
      <button type="button" :class="['btn justify-center py-2.5! text-sm! border border-neutral-200 dark:border-neutral-700/60']" @click="emit('unpin')">
        <span class="i-mingcute-close-line" aria-hidden="true" />Close
      </button>
    </div>
  </div>
</template>
