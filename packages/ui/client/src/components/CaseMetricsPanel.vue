<script setup lang="ts">
import type { ScaleContinuousNumeric } from 'd3'

import type { CaseNode, MetricDefinition } from '../../../src/shared/contract'
import type { CaseFilters, CaseRow } from '../caseMetrics'
import type { ParallelAxis } from './ParallelCoordinates.vue'

import { useQuery } from '@pinia/colada'
import { onKeyStroke, useMediaQuery, usePreferredReducedMotion, useScreenSafeArea } from '@vueuse/core'
import { animate } from 'animejs'
import { format } from 'd3'
import { DropdownMenuContent, DropdownMenuItemIndicator, DropdownMenuPortal, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuRoot, DropdownMenuTrigger, PopoverAnchor, PopoverArrow, PopoverContent, PopoverPortal, PopoverRoot } from 'reka-ui'
import { DrawerContent, DrawerDescription, DrawerHandle, DrawerOverlay, DrawerPortal, DrawerRoot, DrawerTitle } from 'vaul-vue'
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'

import AnimatedContent from './AnimatedContent.vue'
import AxisPicker from './AxisPicker.vue'
import CaseCard from './CaseCard.vue'
import CaseCartesian from './CaseCartesian.vue'
import MetricSummary from './MetricSummary.vue'
import PairsHeatmap from './PairsHeatmap.vue'
import ParallelCoordinates from './ParallelCoordinates.vue'
import ScatterMatrix from './ScatterMatrix.vue'
import SegmentedControl from './SegmentedControl.vue'
import StateView from './StateView.vue'

import { api } from '../api'
import { buildCaseTable, matchesFilters, metricScale, separationOf } from '../caseMetrics'
import { localize } from '../localize'
import { href, navigate } from '../router'

/**
 * Cases of one task against their metrics: a metric picker, a color-by choice, parallel coordinates, and a
 * scatterplot matrix that share one selection. The selection is handed to the parent, which filters its case list.
 */
const props = defineProps<{
  cases: readonly CaseNode[]
  /** Changes when the run advanced, at most once per refetch interval (`useRunLive().refreshKey`). */
  refreshKey: number | undefined
  runKey: string
  taskId: string
}>()
/** Keys of the selected cases; `undefined` while nothing is filtered. */
const selection = defineModel<ReadonlySet<string> | undefined>('selection')

const metrics = useQuery({
  key: () => ['runs', props.runKey, 'task', props.taskId, 'metrics'],
  query: () => api.metrics(props.runKey, { taskId: props.taskId }),
})
watch(() => props.refreshKey, () => void metrics.refetch())

const table = computed(() => buildCaseTable(props.cases, metrics.data.value))
// Labels, descriptions, and units the task announced with `metric.defined`.
const definitions = computed(() => new Map<string, MetricDefinition>((metrics.data.value?.definitions ?? []).map(definition => [definition.name, definition])))
const labelOf = (name: string) => localize(definitions.value.get(name)?.label) ?? name
/** Every case's value of one metric or category, for the distribution in its hover card. */
const valuesOf = (name: string) => table.value.rows.map(row => row.numbers[name] ?? row.categories[name])
// Axis title under the pointer in the parallel coordinates, with where to show its card.
const inspected = shallowRef<{ left: number, name: string, top: number }>()
const scales = computed(() => {
  const result: Record<string, ScaleContinuousNumeric<number, number>> = {}
  for (const group of table.value.groups) {
    for (const name of [group.representative, ...group.members.map(member => member.name)])
      result[name] = metricScale(table.value, name)
  }
  return result
})

/**
 * The chart opens on the metrics that best tell failed from passed cases (so few that every line stays readable);
 * the scatterplot matrix shows at most five metrics.
 */
const DEFAULT_METRIC_AXES = 5
const MAX_MATRIX_METRICS = 5

const separation = computed(() => separationOf(table.value))
// `undefined` until the viewer changes the pick: the defaults follow the table while the run is live.
const pickedMetrics = shallowRef<string[]>()
const pickedCategories = shallowRef<string[]>()
const numericAxes = computed<string[]>({
  // Ranked by separation; metrics without one (scores, one-outcome metrics) come after, in recording order.
  get: () => pickedMetrics.value ?? table.value.groups.map(group => group.representative)
    .toSorted((a, b) => (separation.value.get(b)?.auc ?? 0) - (separation.value.get(a)?.auc ?? 0))
    .slice(0, DEFAULT_METRIC_AXES),
  set: (names) => {
    pickedMetrics.value = names
    dropFiltersOutside()
  },
})
const categoryAxes = computed<string[]>({
  get: () => pickedCategories.value ?? table.value.categories,
  set: (names) => {
    pickedCategories.value = names
    dropFiltersOutside()
  },
})

// Order the viewer gave the axes by dragging; `undefined` keeps the default order.
const axisOrder = shallowRef<string[]>()
/**
 * Category axes on both sides by default: the case group on the left (what it is), the state on the right (how it
 * ended). A dragged order wins; axes picked after the drag keep their default place relative to each other, at the end.
 */
const axes = computed<ParallelAxis[]>(() => {
  const left = categoryAxes.value.filter(name => name !== 'state').map(name => ({ kind: 'category' as const, name }))
  const right = categoryAxes.value.includes('state') ? [{ kind: 'category' as const, name: 'state' }] : []
  const all = [...left, ...numericAxes.value.map(name => ({ kind: 'numeric' as const, name })), ...right]
  const order = axisOrder.value
  if (order == null)
    return all
  const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length)
  return all.toSorted((a, b) => rank(a.name) - rank(b.name))
})
/**
 * The chart follows how many dimensions are picked. `state` does not count: it is the outcome every chart colors by
 * (by default), so "one metric and state" is one dimension, not two. One or two dimensions read best as dots on a
 * strip or a plane; parallel coordinates only pay off from three, where the plane runs out of directions.
 */
const PARALLEL_FROM_DIMENSIONS = 3
/**
 * Motion of a swap (animejs). Switching views (Chart, Matrix, Pairs) slides sideways, toward the side of the tab that
 * was picked, like turning pages; a swap of chart type inside the Chart view (strip or plane to parallel coordinates)
 * fades and settles 4 px vertically instead. Leaving is quicker than entering; with reduced motion the swap is instant.
 * Meanwhile the stage holds the old height while the old view leaves, then eases to the new view's height, so the
 * case list below glides instead of jumping when a 600 px matrix gives way to a 200 px strip.
 */
const reducedMotion = usePreferredReducedMotion()
const SWAP = { enterMs: 260, leaveMs: 140, resizeMs: 320, shiftPx: 4, slidePx: 28 }
const stage = useTemplateRef<HTMLElement>('stage')
let resize: ReturnType<typeof animate> | undefined
/** Pins the stage at its current height (mid-resize too), clipping whatever the views inside do meanwhile. */
function holdStageHeight(): void {
  if (stage.value == null)
    return
  resize?.pause()
  stage.value.style.height = `${stage.value.offsetHeight}px`
  stage.value.style.overflow = 'clip'
}
/** Eases the held stage to the height of what it now holds, then lets it size itself again. */
async function releaseStageHeight(): Promise<void> {
  // Vue calls the enter hook before the entering chart's `onMounted`, where it draws its SVG; measured right away, the
  // stage would ease to an empty chart's height and then jump to the drawn one. After this tick the chart is drawn.
  await nextTick()
  const element = stage.value
  if (element == null || element.style.height === '')
    return
  const from = element.offsetHeight
  element.style.height = ''
  const to = element.offsetHeight
  const settle = () => {
    element.style.removeProperty('height')
    element.style.removeProperty('overflow')
  }
  if (from === to)
    return settle()
  element.style.height = `${from}px`
  resize = animate(element, { duration: SWAP.resizeMs, ease: 'outCubic', height: [from, to], onComplete: settle })
}
// -1 / 1 while a view swap to an earlier / later tab is running; 0 for a chart-type swap.
let slide = 0
function fadeIn(element: Element, done: () => void): void {
  if (reducedMotion.value === 'reduce')
    return done()
  void releaseStageHeight()
  const { offset, property } = swapMotion()
  animate(element, {
    duration: SWAP.enterMs,
    ease: 'outCubic',
    // The settled chart keeps no inline transform: one would become the containing block of fixed descendants.
    onComplete: () => {
      if (element instanceof HTMLElement) {
        element.style.removeProperty('transform')
        element.style.removeProperty('opacity')
      }
      slide = 0
      done()
    },
    opacity: [0, 1],
    // A sideways swap enters from the side opposite to where the old view left; a vertical one settles from below.
    [property]: [slide === 0 ? offset : -offset, 0],
  })
}
function fadeOut(element: Element, done: () => void): void {
  if (reducedMotion.value === 'reduce')
    return done()
  holdStageHeight()
  const { offset, property } = swapMotion()
  animate(element, { duration: SWAP.leaveMs, ease: 'inQuad', onComplete: () => done(), opacity: [1, 0], [property]: [0, offset] })
}
/** Which way a swap moves, and how far the leaving element goes (the entering one comes from the other side). */
function swapMotion() {
  return slide === 0
    ? { offset: SWAP.shiftPx, property: 'translateY' }
    : { offset: -slide * SWAP.slidePx, property: 'translateX' }
}
const dimensions = computed(() => axes.value.filter(axis => axis.name !== 'state'))
const parallel = computed(() => dimensions.value.length >= PARALLEL_FROM_DIMENSIONS)
// On a plane a metric runs across and a category stacks its bands down the side, where its value labels fit.
const planeAxes = computed(() => dimensions.value.toSorted((a, b) => Number(a.kind === 'category') - Number(b.kind === 'category')))
const matrixMetrics = computed(() => numericAxes.value.slice(0, MAX_MATRIX_METRICS))

/**
 * How the picked axes are drawn: the chart for their count of dimensions, every pair of metrics as small
 * scatterplots (matrix), or every pair as one cell colored by correlation with the picked pair's scatterplot under it
 * (pairs). Matrix and pairs need two metrics; with fewer the chart is the only view.
 */
type CaseView = 'chart' | 'matrix' | 'pairs'
const view = shallowRef<CaseView>('chart')
const VIEW_ORDER: CaseView[] = ['chart', 'matrix', 'pairs']
// Sync, so the direction is set before the transition hooks of this same update run.
watch(view, (next, previous) => {
  slide = Math.sign(VIEW_ORDER.indexOf(next) - VIEW_ORDER.indexOf(previous))
}, { flush: 'sync' })
const views = computed(() => numericAxes.value.length < 2
  ? []
  : [
      { icon: 'i-mingcute-chart-line-line', label: 'Chart', value: 'chart' as const },
      { icon: 'i-mingcute-grid-line', label: 'Matrix', value: 'matrix' as const },
      { icon: 'i-mingcute-layout-grid-line', label: 'Pairs', value: 'pairs' as const },
    ])
watch(views, (items) => {
  if (items.length === 0)
    view.value = 'chart'
})
// The pair picked in the heatmap; it is dropped when one of its metrics leaves the axes.
const pickedPair = shallowRef<[string, string]>()
watch(numericAxes, (names) => {
  if (pickedPair.value != null && !pickedPair.value.every(name => names.includes(name)))
    pickedPair.value = undefined
})
const pairAxes = computed<ParallelAxis[]>(() => (pickedPair.value ?? []).map(name => ({ kind: 'numeric' as const, name })))

/** Values of each category, most frequent first (`state` in its usual order). */
const categoryValues = computed(() => {
  const result: Record<string, string[]> = {}
  for (const name of table.value.categories) {
    const counts = new Map<string, number>()
    for (const row of table.value.rows) {
      const value = row.categories[name]
      if (value != null)
        counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    const order = ['passed', 'failed', 'timeout', 'skipped', 'running', 'unfinished']
    result[name] = [...counts.keys()].sort((a, b) => (name === 'state' ? order.indexOf(a) - order.indexOf(b) : (counts.get(b)! - counts.get(a)!)))
  }
  return result
})

const filters = shallowRef<CaseFilters>({ box: null, categories: {}, ranges: {} })
function clearFilters(): void {
  filters.value = { box: null, categories: {}, ranges: {} }
}
function dropFiltersOutside(): void {
  const { box, categories, ranges } = filters.value
  const numeric = new Set(numericAxes.value)
  filters.value = {
    box: box != null && matrixMetrics.value.includes(box.x) && matrixMetrics.value.includes(box.y) ? box : null,
    categories: Object.fromEntries(Object.entries(categories).filter(([name]) => categoryAxes.value.includes(name))),
    ranges: Object.fromEntries(Object.entries(ranges).filter(([name]) => numeric.has(name))),
  }
}
function onBrush(name: string, range: [number, number] | null): void {
  const ranges = { ...filters.value.ranges }
  if (range == null)
    delete ranges[name]
  else
    ranges[name] = range
  filters.value = { ...filters.value, ranges }
}
function onPick(name: string, value: string): void {
  const picked = new Set(filters.value.categories[name])
  if (picked.has(value))
    picked.delete(value)
  else
    picked.add(value)
  filters.value = { ...filters.value, categories: { ...filters.value.categories, [name]: picked } }
}
const filtering = computed(() => filters.value.box != null || Object.keys(filters.value.ranges).length > 0 || Object.values(filters.value.categories).some(set => set.size > 0))
const selected = computed(() => new Set(table.value.rows.filter(row => matchesFilters(row, filters.value)).map(row => row.key)))
watch([selected, filtering], () => {
  selection.value = filtering.value ? selected.value : undefined
}, { immediate: true })

function passRate(rows: readonly CaseRow[]): string {
  const finished = rows.filter(row => row.state === 'passed' || row.state === 'failed' || row.state === 'timeout')
  return finished.length === 0 ? '—' : `${((finished.filter(row => row.state === 'passed').length / finished.length) * 100).toFixed(1)}%`
}
const selectedRows = computed(() => table.value.rows.filter(row => selected.value.has(row.key)))

// Color by the case state (default), a category, or a metric in five steps.
const colorBy = shallowRef('state')
const colorOptions = computed(() => [...table.value.categories, ...numericAxes.value])
watch(colorOptions, (options) => {
  if (!options.includes(colorBy.value))
    colorBy.value = 'state'
})
/** Categorical series slots; values past the eighth share the neutral chart text color. */
const SERIES_SLOTS = 8
const SEQUENTIAL_STEPS = 5
const legend = computed<{ color: string, label: string }[]>(() => {
  const name = colorBy.value
  if (name === 'state')
    return (categoryValues.value.state ?? []).map(value => ({ color: `var(--mark-${value})`, label: value }))
  if (table.value.categories.includes(name)) {
    const values = categoryValues.value[name] ?? []
    const shown = values.slice(0, SERIES_SLOTS).map((value, index) => ({ color: `var(--series-${index + 1})`, label: value }))
    return values.length > SERIES_SLOTS ? [...shown, { color: 'var(--chart-text)', label: `${values.length - SERIES_SLOTS} more` }] : shown
  }
  const scale = scales.value[name]
  if (scale == null)
    return []
  const [low, high] = scale.domain() as [number, number]
  const step = format('~s')
  return Array.from({ length: SEQUENTIAL_STEPS }, (_, index) => ({
    color: `var(--seq-${index + 1})`,
    label: `${step(scale.invert(scale(low) + ((scale(high) - scale(low)) * index) / SEQUENTIAL_STEPS))}+`,
  }))
})
const colorOf = computed(() => {
  const name = colorBy.value
  if (name === 'state')
    return (row: CaseRow) => `var(--mark-${row.state})`
  if (table.value.categories.includes(name)) {
    const slots = new Map((categoryValues.value[name] ?? []).slice(0, SERIES_SLOTS).map((value, index) => [value, `var(--series-${index + 1})`]))
    return (row: CaseRow) => slots.get(row.categories[name] ?? '') ?? 'var(--chart-text)'
  }
  const scale = scales.value[name]?.copy().range([0, 1])
  return (row: CaseRow) => {
    const value = row.numbers[name]
    if (value == null || scale == null)
      return 'var(--chart-grid)'
    return `var(--seq-${Math.min(SEQUENTIAL_STEPS, Math.floor(scale(value) * SEQUENTIAL_STEPS) + 1)})`
  }
})

// The case under the pointer, and the case pinned by a click. Both points are page coordinates, so a pinned card
// stays on its line while the page scrolls.
// Same split as the Live2D report of AIRI (`stage-ui/.../reports/live2d/modal.vue`): a floating card on desktop, a
// bottom drawer (vaul) on phones, where a floating card would cover the chart under the finger.
const isDesktop = useMediaQuery('(min-width: 768px)')
// iOS home indicator and Android gesture bar: the drawer pads its bottom by the safe area, at least 1.5 rem.
const safeArea = useScreenSafeArea()
const drawerPaddingBottom = computed(() => `max(1.5rem, ${safeArea.bottom.value || '0px'})`)
interface FocusPoint { axis: null | string, key: string, pageX: number, pageY: number }
const hovered = shallowRef<FocusPoint>()
const pinned = shallowRef<FocusPoint>()
const pinnedRow = computed(() => (pinned.value == null ? undefined : table.value.rows.find(row => row.key === pinned.value!.key)))
const pageOf = (point: { x: number, y: number }) => ({ pageX: point.x + window.scrollX, pageY: point.y + window.scrollY })
/** Leaving a line waits this long before the preview closes, so sweeping across dense lines does not flicker it. */
const HOVER_LEAVE_DELAY_MS = 120
let leaveTimer: ReturnType<typeof setTimeout> | undefined
function onHover(row: CaseRow | null, point: null | { x: number, y: number }, axis: null | string): void {
  clearTimeout(leaveTimer)
  // Touch screens have no hover; a tap also fires pointerenter, which must not open a preview behind the drawer.
  if (!isDesktop.value)
    return
  if (row == null || point == null) {
    leaveTimer = setTimeout(() => {
      hovered.value = undefined
    }, HOVER_LEAVE_DELAY_MS)
    return
  }
  // Moving along the same line changes only the axis; the card stays where the line was entered.
  if (hovered.value?.key === row.key)
    hovered.value = { ...hovered.value, axis }
  else
    hovered.value = { axis, key: row.key, ...pageOf(point) }
}
/** A click pins a case; clicking it again, the empty chart, Esc, or Unpin lets it go. */
function onPin(row: CaseRow | null, point: null | { x: number, y: number }, axis: null | string): void {
  pinned.value = row == null || point == null || pinned.value?.key === row.key ? undefined : { axis, key: row.key, ...pageOf(point) }
  hovered.value = undefined
}
// Hovering another case previews it; otherwise the pinned case keeps its card, which then takes clicks.
const card = computed(() => {
  const preview = hovered.value != null && hovered.value.key !== pinned.value?.key
  const focus = preview ? hovered.value : pinned.value
  const row = focus == null ? undefined : table.value.rows.find(item => item.key === focus.key)
  // The axis under the pointer wins, also over the pinned case's own line; else the axis it was pinned at.
  const axis = hovered.value?.key === focus?.key ? hovered.value?.axis : focus?.axis
  return row == null || focus == null ? undefined : { axis: axis ?? undefined, focus, pinned: !preview, row }
})
// The card stays filled while its popover plays the closing animation (reka keeps the content mounted until then).
const shownCard = shallowRef<NonNullable<typeof card.value>>()
watch(card, (value) => {
  if (value != null)
    shownCard.value = value
})
// Floating UI positions against this virtual element; it reads the scroll position on every update. It follows
// `shownCard`, not `card`: while the popover plays its closing animation `card` is already empty, and an empty
// reference would make reka fall back to the (empty) anchor element, so the card jumped to the panel's corner.
const cardAnchor = computed(() => {
  const focus = shownCard.value?.focus
  return focus == null ? undefined : { getBoundingClientRect: () => new DOMRect(focus.pageX - window.scrollX, focus.pageY - window.scrollY, 0, 0) }
})
// Enter opens the pinned case, unless the key belongs to a control (a chip, the color select, a link) that has focus.
onKeyStroke('Enter', (event) => {
  const row = card.value?.pinned === true ? card.value.row : undefined
  if (row == null || (event.target instanceof Element && event.target.closest('a, button, input, select, textarea') != null))
    return
  navigate({ caseId: row.caseId, name: 'case', runKey: props.runKey, taskId: props.taskId })
})
const caseHref = (row: CaseRow) => href({ caseId: row.caseId, name: 'case', runKey: props.runKey, taskId: props.taskId })
const unitOf = (name: string) => definitions.value.get(name)?.unit
</script>

<template>
  <section :class="['card mb-4']" data-testid="case-metrics">
    <h2 :class="['card-title flex-wrap']">
      <span class="i-mingcute-chart-line-line" aria-hidden="true" />Case metrics
      <span class="text-xs muted font-normal">every case against its recorded metrics</span>
    </h2>
    <StateView :error="metrics.error.value" :loading="metrics.isPending.value" :empty="table.rows.length === 0" empty-text="No cases yet" @retry="metrics.refetch()">
      <div :class="['grid gap-3 p-3']">
        <!-- One toolbar row: the axes behind a button, the color, and what the selection holds. -->
        <div :class="['flex flex-wrap items-center gap-x-2 gap-y-2 text-xs select-none']">
          <SegmentedControl v-if="views.length > 0" v-model="view" :items="views" label="View" size="md" />
          <AxisPicker v-model:metrics="numericAxes" v-model:categories="categoryAxes" :label-of="labelOf" :separation="separation" :table="table" />
          <DropdownMenuRoot>
            <DropdownMenuTrigger :class="['option-trigger max-w-60']" data-testid="color-by">
              <span class="muted">Color by</span><span :class="['truncate']">{{ labelOf(colorBy) }}</span><span class="i-mingcute-down-line muted" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent as-child align="start" :side-offset="6" :collision-padding="12" :class="['floating min-w-52 p-1 text-sm']">
                <AnimatedContent>
                  <!-- Scrolls inside the space reka leaves under the trigger; the animated root clips its own overflow. -->
                  <DropdownMenuRadioGroup v-model="colorBy" :class="['max-h-[min(24rem,var(--reka-dropdown-menu-content-available-height))] overflow-y-auto']">
                    <DropdownMenuRadioItem v-for="option in colorOptions" :key="option" :value="option" :class="['menu-item']">
                      <span :class="['size-4 shrink-0 grid place-items-center']">
                        <DropdownMenuItemIndicator><span class="i-mingcute-check-line" aria-hidden="true" /></DropdownMenuItemIndicator>
                      </span>
                      <span :class="['truncate']">{{ labelOf(option) }}</span>
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </AnimatedContent>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
          <span :class="['inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 ml-1']">
            <span v-for="item in legend" :key="item.label" :class="['inline-flex items-center gap-1']">
              <span :class="['inline-block w-3 h-1.5 rounded-sm']" :style="{ background: item.color }" />{{ item.label }}
            </span>
          </span>
          <span :class="['md:ml-auto text-sm']">
            <b class="mono">{{ selected.size }}</b><span class="muted"> / {{ table.rows.length }} · pass </span><b class="mono">{{ passRate(selectedRows) }}</b>
          </span>
          <button v-if="filtering" type="button" class="btn" @click="clearFilters">
            <span class="i-mingcute-close-line" aria-hidden="true" />Clear selection
          </button>
        </div>

        <!-- Switching views, or the chart between strip/plane and parallel coordinates, fades one out and the other in. -->
        <!-- The stage carries the height between the two: it grows or shrinks to the new view instead of jumping. -->
        <div ref="stage">
          <Transition mode="out-in" :css="false" @enter="fadeIn" @leave="fadeOut">
            <div v-if="view === 'matrix'" key="matrix" :class="['grid gap-1']">
              <div :class="['text-xs muted']">
                Every pair of {{ matrixMetrics.map(labelOf).join(', ') }}<template v-if="numericAxes.length > MAX_MATRIX_METRICS">
                  (the first {{ MAX_MATRIX_METRICS }} picked metrics)
                </template>
                · drag in a cell to select
              </div>
              <ScatterMatrix :color-of="colorOf" :filters="filters" :metrics="matrixMetrics" :label-of="labelOf" :rows="table.rows" :scales="scales" :selected="selected" :pinned-key="pinned?.key" @box="box => filters = { ...filters, box }" @hover="onHover" @pin="onPin" />
            </div>
            <div v-else-if="view === 'pairs'" key="pairs" :class="['grid gap-3']">
              <PairsHeatmap :label-of="labelOf" :metrics="numericAxes" :rows="table.rows" :selected-pair="pickedPair" :separation="separation" @select="pair => pickedPair = pair" />
              <CaseCartesian
                v-if="pickedPair"
                :axes="pairAxes" :category-values="categoryValues" :color-of="colorOf" :filters="filters" :label-of="labelOf" :rows="table.rows" :scales="scales" :selected="selected"
                :pinned-key="pinned?.key"
                @brush="onBrush" @pick="onPick" @hover="onHover" @pin="onPin"
              />
            </div>
            <p v-else-if="dimensions.length === 0" key="empty" :class="['text-sm muted py-6 text-center']">
              Pick a metric or a category in <b>Axes</b> to draw the cases.
            </p>
            <CaseCartesian
              v-else-if="!parallel" key="plane"
              :axes="planeAxes" :category-values="categoryValues" :color-of="colorOf" :filters="filters" :label-of="labelOf" :rows="table.rows" :scales="scales" :selected="selected"
              :pinned-key="pinned?.key"
              @brush="onBrush" @pick="onPick" @hover="onHover" @pin="onPin"
            />
            <ParallelCoordinates
              v-else key="parallel"
              :axes="axes" :category-values="categoryValues" :color-of="colorOf" :filters="filters" :label-of="labelOf" :rows="table.rows" :scales="scales" :selected="selected"
              :pinned-key="pinned?.key"
              @brush="onBrush" @pick="onPick" @hover="onHover" @pin="onPin" @reorder="names => axisOrder = names"
              @inspect="(name, box) => inspected = name == null || box == null ? undefined : { left: box.left, name, top: box.bottom + 6 }"
            />
          </Transition>
        </div>
        <!-- SVG axis titles cannot host a hover card, so the chart reports the hovered title and the card floats here. -->
        <div v-if="inspected" :class="['floating fixed p-2.5 text-xs pointer-events-none']" :style="{ left: `${inspected.left}px`, top: `${inspected.top}px` }">
          <MetricSummary :name="inspected.name" :definition="definitions.get(inspected.name)" :values="valuesOf(inspected.name)" />
        </div>
      </div>
    </StateView>
    <!-- One popover for the hovered or pinned case of both charts; a preview ignores the pointer, a pinned card takes it. -->
    <PopoverRoot v-if="isDesktop" :open="card != null">
      <PopoverAnchor :reference="cardAnchor" />
      <PopoverPortal>
        <PopoverContent
          as-child side="right" align="start" :side-offset="14" :collision-padding="12"
          :class="['floating p-3 text-xs', shownCard?.pinned !== true && 'pointer-events-none']"
          @open-auto-focus.prevent @close-auto-focus.prevent @interact-outside.prevent @escape-key-down="pinned = undefined"
        >
          <AnimatedContent>
            <div v-if="shownCard" :class="['w-80 max-w-[calc(100vw-2rem)]']">
              <CaseCard :active-axis="shownCard.axis" :axes="axes" :href="caseHref(shownCard.row)" :label-of="labelOf" :pinned="shownCard.pinned" :row="shownCard.row" :rows="table.rows" :scales="scales" :unit-of="unitOf" @unpin="pinned = undefined" />
            </div>
            <PopoverArrow :class="['floating-arrow']" />
          </AnimatedContent>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
    <!-- Phones: a tapped line opens the same card in a bottom drawer; dismissing the drawer unpins the case. -->
    <DrawerRoot v-else :open="pinnedRow != null" @update:open="open => { if (!open) pinned = undefined }">
      <DrawerPortal>
        <DrawerOverlay :class="['fixed inset-0 z-50 bg-black/40']" />
        <DrawerContent
          :class="['floating fixed inset-x-0 bottom-0 max-h-[85dvh] flex flex-col gap-3 rounded-b-none! rounded-t-2xl! border-b-0! px-4 pt-3 text-xs outline-none']"
          :style="{ paddingBottom: drawerPaddingBottom }"
        >
          <DrawerHandle :class="['bg-neutral-300! dark:bg-neutral-600!']" />
          <DrawerTitle :class="['sr-only']">
            Case {{ pinnedRow?.name }}
          </DrawerTitle>
          <DrawerDescription :class="['sr-only']">
            The case's value on every axis and where it sits among all cases.
          </DrawerDescription>
          <div v-if="pinnedRow" :class="['overflow-y-auto min-h-0']">
            <CaseCard :active-axis="pinned?.axis ?? undefined" :axes="axes" :href="caseHref(pinnedRow)" :label-of="labelOf" layout="drawer" pinned :row="pinnedRow" :rows="table.rows" :scales="scales" :unit-of="unitOf" @unpin="pinned = undefined" />
          </div>
        </DrawerContent>
      </DrawerPortal>
    </DrawerRoot>
  </section>
</template>
