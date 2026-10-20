<script setup lang="ts">
import type { ScaleContinuousNumeric } from 'd3'
import type { ComponentPublicInstance } from 'vue'

import type { CaseNode } from '../../../src/shared/contract'
import type { CaseFilters, CaseRow } from '../caseMetrics'
import type { BesideTarget } from './MetricBesideCard.vue'
import type { ParallelAxis } from './ParallelCoordinates.vue'

import { useQuery } from '@pinia/colada'
import { onKeyStroke, useMediaQuery, usePreferredReducedMotion, useScreenSafeArea } from '@vueuse/core'
import { animate } from 'animejs'
import { DropdownMenuContent, DropdownMenuItemIndicator, DropdownMenuPortal, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuRoot, DropdownMenuTrigger, PopoverAnchor, PopoverArrow, PopoverContent, PopoverPortal, PopoverRoot } from 'reka-ui'
import { DrawerContent, DrawerDescription, DrawerHandle, DrawerOverlay, DrawerPortal, DrawerRoot, DrawerTitle } from 'vaul-vue'
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'

import AnimatedContent from './AnimatedContent.vue'
import AxisPicker from './AxisPicker.vue'
import CaseCard from './CaseCard.vue'
import CaseCartesian from './CaseCartesian.vue'
import GroupBars from './GroupBars.vue'
import MetricBesideCard from './MetricBesideCard.vue'
import MetricSummary from './MetricSummary.vue'
import PairsHeatmap from './PairsHeatmap.vue'
import ParallelCoordinates from './ParallelCoordinates.vue'
import ParallelSets from './ParallelSets.vue'
import ScatterMatrix from './ScatterMatrix.vue'
import SegmentedControl from './SegmentedControl.vue'
import StateView from './StateView.vue'

import { api } from '../api'
import { buildCaseTable, columnDefinitions, formatColumnValue, matchesFilters, metricDefinition, metricLabel, metricScale, separationOf } from '../caseMetrics'
import { formatScore, formatTick } from '../format'
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
  /** Task of the cases; without it the panel covers every case of the run, with the matrix axes as categories. */
  taskId?: string
}>()
/** Keys of the selected cases; `undefined` while nothing is filtered. */
const selection = defineModel<ReadonlySet<string> | undefined>('selection')

const metrics = useQuery({
  // The same cache entries as the task page and the run's scores panel.
  key: () => (props.taskId == null ? ['runs', props.runKey, 'metrics'] : ['runs', props.runKey, 'task', props.taskId, 'metrics']),
  query: () => api.metrics(props.runKey, props.taskId == null ? {} : { taskId: props.taskId }),
})
watch(() => props.refreshKey, () => void metrics.refetch())

const table = computed(() => buildCaseTable(props.cases, metrics.data.value))
// Labels, descriptions, and units the task announced with `metric.defined`, and its scores' `score.defined`.
const definitions = computed(() => columnDefinitions(metrics.data.value?.definitions ?? [], metrics.data.value?.scoreDefinitions ?? []))
const labelOf = (name: string) => metricLabel(name, definitions.value)
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
  // The primary score first (what the cases are read by), then ranked by separation; metrics without one (the other
  // scores, one-outcome metrics) come after, in recording order.
  get: () => pickedMetrics.value ?? table.value.groups.map(group => group.representative)
    .toSorted((a, b) => Number(b === table.value.primary) - Number(a === table.value.primary) || (separation.value.get(b)?.auc ?? 0) - (separation.value.get(a)?.auc ?? 0))
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

/** Category axes of the parallel sets: the picked ones in chart order, without the state (an all-passed outcome). */
const setAxes = computed(() => axes.value.filter(axis => axis.kind === 'category' && axis.name !== 'state').map(axis => axis.name))
/** Categories worth grouping by: everything but the outcome itself. */
const groupCategories = computed(() => table.value.categories.filter(name => name !== 'state'))
/**
 * How the picked axes are drawn: the chart for their count of dimensions, the category axes as parallel sets (sets),
 * every pair of metrics as small scatterplots (matrix), every pair as one cell colored by correlation with the picked
 * pair's scatterplot under it (pairs), or the cases of each value of one category side by side (groups). Matrix and
 * pairs need two metrics, sets two category axes; with none of them the chart is the only view.
 */
type CaseView = 'chart' | 'groups' | 'matrix' | 'pairs' | 'sets'
const VIEW_ORDER: CaseView[] = ['chart', 'sets', 'matrix', 'pairs', 'groups']
// A run-wide panel opens on the parallel sets once the matrix splits the cases (see `views`); a task opens on the chart.
const pickedView = shallowRef<CaseView>()
const views = computed(() => {
  const items: { icon: string, label: string, value: CaseView }[] = [{ icon: 'i-mingcute-chart-line-line', label: 'Chart', value: 'chart' }]
  // Parallel sets need two category axes besides the outcome.
  if (setAxes.value.length >= 2)
    items.push({ icon: 'i-mingcute-sitemap-line', label: 'Sets', value: 'sets' })
  if (numericAxes.value.length >= 2) {
    items.push({ icon: 'i-mingcute-grid-line', label: 'Matrix', value: 'matrix' })
    items.push({ icon: 'i-mingcute-layout-grid-line', label: 'Pairs', value: 'pairs' })
  }
  // Groups need a category to group by besides the state.
  if (groupCategories.value.length > 0)
    items.push({ icon: 'i-mingcute-chart-horizontal-line', label: 'Groups', value: 'groups' })
  return items.length > 1 ? items : []
})
const view = computed<CaseView>({
  get: () => pickedView.value ?? (props.taskId == null && views.value.some(item => item.value === 'sets') ? 'sets' : 'chart'),
  set: (value) => {
    pickedView.value = value
  },
})
watch(views, (items) => {
  if (pickedView.value != null && !items.some(item => item.value === pickedView.value))
    pickedView.value = undefined
})
// Sync, so the direction is set before the transition hooks of this same update run.
watch(view, (next, previous) => {
  slide = Math.sign(VIEW_ORDER.indexOf(next) - VIEW_ORDER.indexOf(previous))
}, { flush: 'sync' })
// The pair picked in the heatmap; it is dropped when one of its metrics leaves the axes.
const pickedPair = shallowRef<[string, string]>()
watch(numericAxes, (names) => {
  if (pickedPair.value != null && !pickedPair.value.every(name => names.includes(name)))
    pickedPair.value = undefined
})
const pairAxes = computed<ParallelAxis[]>(() => (pickedPair.value ?? []).map(name => ({ kind: 'numeric' as const, name })))

/** Values of each category axis in drawing order (see {@link CaseTable.valueCounts}). */
const categoryValues = computed(() => Object.fromEntries(Object.entries(table.value.valueCounts).map(([name, counts]) => [name, [...counts.keys()]])))

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
// The parent cleared the selection (the case list's chip): the filters that made it go too.
watch(selection, (value) => {
  if (value == null && filtering.value)
    clearFilters()
})

const selectedRows = computed(() => table.value.rows.filter(row => selected.value.has(row.key)))
/**
 * What the selection holds: the mean primary score of its scored cases in a scored eval (where a score of 0 is a
 * result, not a failure), else the share of finished cases that passed.
 */
const selectionSummary = computed(() => {
  const rows = selectedRows.value
  const primary = table.value.primary
  if (primary != null) {
    const scores = rows.map(row => row.numbers[primary]).filter((value): value is number => value != null)
    return { label: labelOf(primary), value: formatScore(scores.length === 0 ? null : scores.reduce((sum, value) => sum + value, 0) / scores.length) }
  }
  const finished = rows.filter(row => row.state === 'passed' || row.state === 'failed' || row.state === 'errored' || row.state === 'timeout')
  return { label: 'pass', value: finished.length === 0 ? '—' : `${((finished.filter(row => row.state === 'passed').length / finished.length) * 100).toFixed(1)}%` }
})

/**
 * Color by the case state, a category, or a metric in steps. A task with a primary score opens colored by it (a
 * failed case scores 0, so the score already tells wrong results apart, and it ranks the passed ones too); without
 * one, by the state.
 */
const pickedColor = shallowRef<string>()
const colorOptions = computed(() => [...table.value.categories, ...numericAxes.value])
const defaultColor = computed(() => {
  const primary = table.value.primary
  return primary != null && colorOptions.value.includes(primary) ? primary : 'state'
})
const colorBy = computed<string>({
  get: () => (pickedColor.value != null && colorOptions.value.includes(pickedColor.value) ? pickedColor.value : defaultColor.value),
  set: (name) => {
    pickedColor.value = name
  },
})
/** Where the viewer cut each metric into color bands (sorted, inside the metric's range); five equal steps without. */
const cuts = shallowRef<Record<string, number[]>>({})
/** Categorical series slots; values past the eighth share the neutral chart text color. */
const SERIES_SLOTS = 8
const SEQUENTIAL_STEPS = 5
/**
 * Index (1–5) of the sequential color of step `index` out of `count`, spread over the whole ramp. The ramp gains ink
 * toward step 5 in both color schemes; for a score (higher is better) the low end takes the most ink instead, so the
 * cases that lose the score stand out rather than fade into the background.
 */
function sequentialSlot(index: number, count: number, lowStandsOut = false) {
  const slot = count <= 1 ? SEQUENTIAL_STEPS : Math.round(1 + (index * (SEQUENTIAL_STEPS - 1)) / (count - 1))
  return lowStandsOut ? SEQUENTIAL_STEPS + 1 - slot : slot
}
/** Whether higher is better for a metric: the scores (their columns say so), and metrics defined with `better: 'higher'`. */
const higherIsBetter = (name: string) => metricDefinition(name, definitions.value)?.better === 'higher'

/** One entry of the color legend; clicking it selects its cases (`select`), and `active` marks a selected one. */
interface LegendItem { active?: boolean, color: string, count: number, label: string, select?: () => void }

/** How each case is colored, and the legend that explains it: one source, so the two never disagree. */
const palette = computed<{ colorOf: (row: CaseRow) => string, legend: LegendItem[] }>(() => {
  const name = colorBy.value
  const rows = table.value.rows
  const picked = filters.value.categories[name]
  const categoryItem = (value: string, color: string): LegendItem => ({
    active: picked?.has(value) === true,
    color,
    count: rows.filter(row => row.categories[name] === value).length,
    label: value,
    select: () => onPick(name, value),
  })
  if (name === 'state')
    return { colorOf: row => `var(--mark-${row.state})`, legend: (categoryValues.value.state ?? []).map(value => categoryItem(value, `var(--mark-${value})`)) }
  const values = categoryValues.value[name]
  if (values != null) {
    // A two-valued score or count (a 0 / 1 score) is ordered: low to high along the sequential ramp, not series hues.
    if (values.every(value => value.trim() !== '' && Number.isFinite(Number(value)))) {
      const ordered = values.toSorted((a, b) => Number(a) - Number(b))
      const slots = new Map(ordered.map((value, index) => [value, `var(--seq-${sequentialSlot(index, ordered.length, higherIsBetter(name))})`]))
      const definition = metricDefinition(name, definitions.value)
      return { colorOf: row => slots.get(row.categories[name] ?? '') ?? 'var(--chart-grid)', legend: ordered.map(value => ({ ...categoryItem(value, slots.get(value)!), label: formatColumnValue(Number(value), definition) })) }
    }
    const slots = new Map(values.slice(0, SERIES_SLOTS).map((value, index) => [value, `var(--series-${index + 1})`]))
    const legend = [...slots].map(([label, color]) => categoryItem(label, color))
    if (values.length > SERIES_SLOTS)
      legend.push({ color: 'var(--chart-text)', count: rows.filter(row => !slots.has(row.categories[name] ?? '')).length, label: `${values.length - SERIES_SLOTS} more` })
    return { colorOf: row => slots.get(row.categories[name] ?? '') ?? 'var(--chart-text)', legend }
  }
  // A metric in bands of one hue: the viewer's cuts, else five equal steps along its scale (symlog for heavy tails).
  const scale = scales.value[name] ?? metricScale(table.value, name)
  const unit = scale.copy().range([0, 1])
  const [low, high] = scale.domain() as [number, number]
  const custom = (cuts.value[name] ?? []).filter(cut => cut > low && cut < high)
  const edges = custom.length > 0 ? [low, ...custom, high] : Array.from({ length: SEQUENTIAL_STEPS + 1 }, (_, index) => unit.invert(index / SEQUENTIAL_STEPS))
  const bands = edges.slice(0, -1).map((from, index) => ({ from, to: edges[index + 1]! }))
  const bandOf = (value: number) => Math.max(0, bands.findLastIndex(band => value >= band.from))
  const range = filters.value.ranges[name]
  return {
    colorOf: (row) => {
      const value = row.numbers[name]
      return value == null ? 'var(--chart-grid)' : `var(--seq-${sequentialSlot(bandOf(value), bands.length, higherIsBetter(name))})`
    },
    legend: bands.map((band, index) => {
      const last = index === bands.length - 1
      // A value on a cut belongs to the band above it; the selected range stops just short of the next cut.
      const to = last ? band.to : band.to - (high - low) * 1e-9
      return {
        active: range != null && range[0] === band.from && range[1] === to,
        color: `var(--seq-${sequentialSlot(index, bands.length, higherIsBetter(name))})`,
        count: rows.filter(row => row.numbers[name] != null && bandOf(row.numbers[name]!) === index).length,
        label: metricDefinition(name, definitions.value)?.score == null ? `${formatTick(band.from)}–${formatTick(band.to)}` : `${formatScore(band.from)}–${formatScore(band.to)}`,
        select: () => onBrush(name, range != null && range[0] === band.from && range[1] === to ? null : [band.from, to]),
      }
    }),
  }
})
/** The color option under the pointer or the keyboard, described beside the open menu. */
const highlightedColor = shallowRef<BesideTarget>()
const colorMenu = useTemplateRef<ComponentPublicInstance>('colorMenu')
const colorMenuElement = computed(() => (colorMenu.value?.$el instanceof HTMLElement ? colorMenu.value.$el : undefined))
const colorIsMetric = computed(() => categoryValues.value[colorBy.value] == null && colorBy.value !== 'state')
/** Cut lines of the colored metric for the parallel coordinates; one object per change, so the chart redraws only then. */
const cutLines = computed(() => (colorIsMetric.value ? { name: colorBy.value, values: cuts.value[colorBy.value] ?? [] } : undefined))
/**
 * Adds a cut to the colored metric: the middle of its range for the first one, then the middle of the widest band,
 * so a click always splits something visible. The cut is then dragged into place on the metric's axis.
 */
function addCut(): void {
  const name = colorBy.value
  const scale = scales.value[name] ?? metricScale(table.value, name)
  const [low, high] = scale.domain() as [number, number]
  const edges = [low, ...(cuts.value[name] ?? []), high]
  let widest = 0
  for (let index = 1; index < edges.length - 1; index++) {
    if (edges[index + 1]! - edges[index]! > edges[widest + 1]! - edges[widest]!)
      widest = index
  }
  const middle = Number(((edges[widest]! + edges[widest + 1]!) / 2).toPrecision(3))
  setCuts(name, [...new Set([...(cuts.value[name] ?? []), middle])].sort((a, b) => a - b))
}
function setCuts(name: string, values: number[]): void {
  const next = { ...cuts.value }
  if (values.length === 0)
    delete next[name]
  else
    next[name] = values
  cuts.value = next
}
const colorOf = computed(() => palette.value.colorOf)

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
  navigate({ caseId: row.caseId, name: 'case', runKey: props.runKey, taskId: row.taskId })
})
const caseHref = (row: CaseRow) => href({ caseId: row.caseId, name: 'case', runKey: props.runKey, taskId: row.taskId })
const formatOf = (name: string, value: number) => formatColumnValue(value, metricDefinition(name, definitions.value))
</script>

<template>
  <section :class="['card mb-4']" data-testid="case-metrics">
    <h2 :class="['card-title flex-wrap']">
      <span class="i-mingcute-chart-line-line" aria-hidden="true" />Case metrics
      <span class="text-xs muted font-normal">every case against its recorded metrics</span>
    </h2>
    <StateView :error="metrics.error.value" :loading="metrics.isPending.value" :empty="table.rows.length === 0" empty-text="No cases yet" @retry="metrics.refetch()">
      <!-- `minmax(0,1fr)`: a chart wider than the card scrolls inside its own wrapper instead of widening the grid. -->
      <div :class="['grid grid-cols-[minmax(0,1fr)] gap-3 p-3']">
        <!-- One toolbar row: the axes behind a button, the color, and what the selection holds. -->
        <div :class="['flex flex-wrap items-center gap-x-2 gap-y-2 text-xs select-none']">
          <SegmentedControl v-if="views.length > 0" v-model="view" :items="views" label="View" :size="isDesktop ? 'md' : 'sm'" />
          <AxisPicker v-model:metrics="numericAxes" v-model:categories="categoryAxes" :definition-of="name => metricDefinition(name, definitions)" :label-of="labelOf" :separation="separation" :table="table" :values-of="valuesOf" />
          <DropdownMenuRoot @update:open="open => { if (!open) highlightedColor = undefined }">
            <DropdownMenuTrigger :class="['option-trigger max-w-60']" data-testid="color-by">
              <span :class="['muted shrink-0']">Color by</span><span :class="['truncate']">{{ labelOf(colorBy) }}</span><span class="i-mingcute-down-line muted" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent as-child align="start" :side-offset="6" :collision-padding="12" :class="['floating min-w-52 p-1 text-sm']">
                <AnimatedContent>
                  <!-- Scrolls inside the space reka leaves under the trigger; the animated root clips its own overflow. -->
                  <DropdownMenuRadioGroup ref="colorMenu" v-model="colorBy" :class="['max-h-[min(24rem,var(--reka-dropdown-menu-content-available-height))] overflow-y-auto']">
                    <DropdownMenuRadioItem v-for="option in colorOptions" :key="option" :value="option" :class="['menu-item']" @focus="(event: FocusEvent) => highlightedColor = { item: event.currentTarget as Element, name: option }">
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
          <!-- What each metric is, beside the menu, for the item under the pointer or the keyboard. -->
          <MetricBesideCard :anchor="colorMenuElement" :target="highlightedColor" :definition-of="name => metricDefinition(name, definitions)" :values-of="valuesOf" />
          <!-- The legend selects: a click picks the category or the band of a metric, a second click lets it go. A
               metric's bands sit in one gray track with a button that adds a cut; cuts are dragged on its axis. -->
          <span
            :class="['inline-flex flex-wrap items-center gap-0.5', colorIsMetric && 'rounded-lg bg-neutral-500/10 p-0.5']"
            data-testid="color-legend"
          >
            <span v-if="colorIsMetric" :class="['muted px-2 whitespace-nowrap']">Bands of {{ labelOf(colorBy) }}</span>
            <component
              :is="item.select ? 'button' : 'span'"
              v-for="item in palette.legend" :key="item.label"
              :type="item.select ? 'button' : undefined"
              :class="[item.select ? 'btn text-xs px-1.5! py-0.5!' : 'inline-flex items-center gap-1 px-1.5 py-0.5', item.active && 'btn-active']"
              :aria-pressed="item.select ? item.active === true : undefined"
              :title="`${item.count} case(s)`"
              @click="item.select?.()"
            >
              <span :class="['inline-block w-3 h-1.5 rounded-sm']" :style="{ background: item.color }" />{{ item.label }}<b v-if="colorIsMetric" :class="['mono']">{{ item.count }}</b>
            </component>
            <template v-if="colorIsMetric">
              <button type="button" :class="['btn text-xs px-1.5! py-0.5!']" title="Split the widest band; drag the new line on the metric's axis" data-testid="add-cut" @click="addCut">
                <span class="i-mingcute-add-line" aria-hidden="true" />cut
              </button>
              <button v-if="(cuts[colorBy] ?? []).length > 0" type="button" :class="['btn text-xs px-1.5! py-0.5! muted']" title="Back to five equal steps" @click="setCuts(colorBy, [])">
                <span class="i-mingcute-refresh-2-line" aria-hidden="true" />steps
              </button>
            </template>
          </span>
          <span :class="['md:ml-auto text-sm']" data-testid="selection-summary">
            <b class="mono">{{ selected.size }}</b><span class="muted"> / {{ table.rows.length }} · {{ selectionSummary.label }}&nbsp;</span><b class="mono">{{ selectionSummary.value }}</b>
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
            <ParallelSets
              v-else-if="view === 'sets'" key="sets"
              :axes="setAxes" :color-of="colorOf" :filters="filters" :label-of="labelOf" :rows="table.rows" :score="table.primary" :selected="selected"
              @pick="onPick"
              @reorder="names => axisOrder = [...names, ...axes.map(axis => axis.name).filter(name => !names.includes(name))]"
              @inspect="(name, box) => inspected = name == null || box == null ? undefined : { left: box.left, name, top: box.bottom + 6 }"
            />
            <GroupBars
              v-else-if="view === 'groups'" key="groups"
              :categories="groupCategories" :color-of="colorOf" :definition-of="name => metricDefinition(name, definitions)" :filters="filters" :label-of="labelOf" :legend-colors="palette.legend.map(item => item.color)" :rows="table.rows" :score="table.primary" :values-of="valuesOf"
              @pick="onPick"
            />
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
              :pinned-key="pinned?.key" :cuts="cutLines"
              @brush="onBrush" @pick="onPick" @hover="onHover" @pin="onPin" @reorder="names => axisOrder = names" @cuts="setCuts"
              @inspect="(name, box) => inspected = name == null || box == null ? undefined : { left: box.left, name, top: box.bottom + 6 }"
            />
          </Transition>
        </div>
        <!-- SVG axis titles cannot host a hover card, so the chart reports the hovered title and the card floats here. -->
        <div v-if="inspected" :class="['floating fixed p-2.5 text-xs pointer-events-none']" :style="{ left: `${inspected.left}px`, top: `${inspected.top}px` }">
          <MetricSummary :name="inspected.name" :definition="metricDefinition(inspected.name, definitions)" :values="valuesOf(inspected.name)" />
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
              <CaseCard :active-axis="shownCard.axis" :axes="axes" :href="caseHref(shownCard.row)" :label-of="labelOf" :pinned="shownCard.pinned" :row="shownCard.row" :rows="table.rows" :scales="scales" :format-of="formatOf" :value-counts="table.valueCounts" @unpin="pinned = undefined" />
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
            <CaseCard :active-axis="pinned?.axis ?? undefined" :axes="axes" :href="caseHref(pinnedRow)" :label-of="labelOf" layout="drawer" pinned :row="pinnedRow" :rows="table.rows" :scales="scales" :format-of="formatOf" :value-counts="table.valueCounts" @unpin="pinned = undefined" />
          </div>
        </DrawerContent>
      </DrawerPortal>
    </DrawerRoot>
  </section>
</template>
