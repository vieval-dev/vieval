<script setup lang="ts">
import type { ScaleBand, ScaleContinuousNumeric, Selection } from 'd3'

import type { CaseFilters, CaseRow } from '../caseMetrics'
import type { ParallelAxis } from './ParallelCoordinates.vue'

import { axisBottom, axisLeft, brush, brushX, brushY, format, scaleBand, select } from 'd3'
import { onMounted, useTemplateRef, watch } from 'vue'

import { useElementWidth } from '../composables/useElementWidth'

/**
 * Cases on one or two axes, one dot per case: a strip along one axis, or a plane of two. A metric axis is a scale
 * (dragged to select a range); a category axis is one band per value (its label clicked to pick it), with the dots
 * spread inside the band so that many cases of one value stay countable.
 *
 * Use when the case charts show fewer than three axes, where parallel coordinates would be one or two lines between
 * two posts; with three or more the parent switches to {@link ParallelCoordinates}. It reports the same brushes,
 * picks, hovers, and pins, so the selection, the case card, and the case list behave the same either way.
 */
const props = defineProps<{
  /** One axis (horizontal) or two (horizontal, then vertical). */
  axes: readonly ParallelAxis[]
  /** Values of each category axis, in drawing order. */
  categoryValues: Readonly<Record<string, readonly string[]>>
  colorOf: (row: CaseRow) => string
  filters: CaseFilters
  labelOf: (name: string) => string
  /** Key of the pinned case, drawn larger and ringed over the others. */
  pinnedKey?: string
  rows: readonly CaseRow[]
  scales: Readonly<Record<string, ScaleContinuousNumeric<number, number>>>
  /** Keys of the selected cases. */
  selected: ReadonlySet<string>
}>()
const emit = defineEmits<{
  brush: [name: string, range: [number, number] | null]
  /** Dot under the pointer and the pointer position in the viewport; `null` when the pointer left the dots. */
  hover: [row: CaseRow | null, point: null | { x: number, y: number }, axis: null | string]
  pick: [name: string, value: string]
  /** Clicked dot and the click position, or `null` after a click on the empty plot. */
  pin: [row: CaseRow | null, point: null | { x: number, y: number }, axis: null | string]
}>()

const root = useTemplateRef<HTMLElement>('root')
const width = useElementWidth(root, 800)
/** A strip needs less height than a plane; both leave room for the axis labels. */
const heights = { plane: 360, strip: 200 }
const margin = { bottom: 40, left: 120, right: 24, top: 16 }
const tick = format('~s')

let dots: ReturnType<typeof drawDots> | undefined
let drawPinned: (() => void) | undefined

/** Position of one case on one axis, in pixels; `null` without a value. */
type Placement = (row: CaseRow) => null | number

function drawDots(svg: Selection<SVGSVGElement, unknown, null, undefined>) {
  const [xAxis, yAxis] = props.axes
  const height = yAxis == null ? heights.strip : heights.plane
  const chartWidth = Math.max(320, width.value)
  svg.attr('viewBox', `0 0 ${chartWidth} ${height}`).attr('width', chartWidth).attr('height', height)
  const xRange: [number, number] = [margin.left, chartWidth - margin.right]
  const yRange: [number, number] = [height - margin.bottom, margin.top]
  const x = placement(xAxis, xRange, 1)
  const y = placement(yAxis, yRange, 2)

  // Axes: ticks for a metric, clickable value labels for a category.
  const axisGroup = (horizontal: boolean, axis: ParallelAxis | undefined, scale: typeof x.scale) => {
    if (axis == null || scale == null)
      return
    const g = svg.append('g').attr('transform', horizontal ? `translate(0,${height - margin.bottom})` : `translate(${margin.left},0)`)
    // One call per scale kind: a band axis and a numeric axis are different generator types.
    if ('bandwidth' in scale)
      g.call((horizontal ? axisBottom(scale) : axisLeft(scale)).tickSizeOuter(0))
    else
      g.call((horizontal ? axisBottom(scale) : axisLeft(scale)).ticks(horizontal ? 8 : 5).tickFormat(tick).tickSizeOuter(0))
    g.call(group => group.selectAll('line, path').attr('stroke', 'var(--chart-grid)'))
      .call(group => group.selectAll('text').attr('fill', 'var(--chart-text)').attr('font-size', 11))
    if (axis.kind === 'category') {
      const picked = props.filters.categories[axis.name]
      g.selectAll<SVGTextElement, string>('.tick text')
        .style('cursor', 'pointer')
        .attr('font-weight', value => (picked?.has(value) ? 700 : 400))
        .attr('fill', value => (picked?.has(value) ? 'var(--series-1)' : 'var(--chart-text)'))
        .on('click', (_, value) => emit('pick', axis.name, value))
    }
    g.append('text')
      .attr('fill', 'currentColor')
      .attr('font-size', 12)
      .attr('font-weight', 600)
      .attr('text-anchor', horizontal ? 'middle' : 'start')
      .attr('x', horizontal ? (xRange[0] + xRange[1]) / 2 : -margin.left + 8)
      .attr('y', horizontal ? 34 : margin.top - 4)
      .text(`${props.labelOf(axis.name)}${axis.kind === 'category' ? ' · click a value to pick' : ''}`)
  }
  axisGroup(true, xAxis, x.scale)
  axisGroup(false, yAxis, y.scale)

  // Brushes for the metric directions, under the dots so the dots keep the pointer.
  const numericScale = (axis: ParallelAxis | undefined, scale: typeof x.scale) => (axis?.kind === 'numeric' && scale != null && !('bandwidth' in scale) ? scale : undefined)
  const xNumeric = numericScale(xAxis, x.scale)
  const yNumeric = numericScale(yAxis, y.scale)
  const extent: [[number, number], [number, number]] = [[xRange[0], yRange[1]], [xRange[1], yRange[0]]]
  const brushGroup = svg.append('g')
  const report = (selection: [number, number] | null, axis: ParallelAxis, scale: ScaleContinuousNumeric<number, number>, vertical: boolean) => {
    if (selection == null) {
      emit('brush', axis.name, null)
      return
    }
    const [a, b] = selection.map(pixel => scale.invert(pixel))
    emit('brush', axis.name, vertical ? [b!, a!] : [a!, b!])
  }
  // A redraw (a picked category, a new run event) keeps the brushed ranges; programmatic moves carry no source event.
  const xRange0 = xAxis == null ? undefined : props.filters.ranges[xAxis.name]
  const yRange0 = yAxis == null ? undefined : props.filters.ranges[yAxis.name]
  if (xNumeric != null && yNumeric != null) {
    const behavior = brush<unknown>().extent(extent).on('end', (event: { selection: [[number, number], [number, number]] | null, sourceEvent?: Event }) => {
      if (event.sourceEvent == null)
        return
      report(event.selection == null ? null : [event.selection[0][0], event.selection[1][0]], xAxis!, xNumeric, false)
      report(event.selection == null ? null : [event.selection[0][1], event.selection[1][1]], yAxis!, yNumeric, true)
    })
    brushGroup.call(behavior)
    if (xRange0 != null && yRange0 != null)
      brushGroup.call(behavior.move, [[xNumeric(xRange0[0]), yNumeric(yRange0[1])], [xNumeric(xRange0[1]), yNumeric(yRange0[0])]])
  }
  else if (xNumeric != null) {
    const behavior = brushX<unknown>().extent(extent).on('end', (event: { selection: [number, number] | null, sourceEvent?: Event }) => {
      if (event.sourceEvent != null)
        report(event.selection, xAxis!, xNumeric, false)
    })
    brushGroup.call(behavior)
    if (xRange0 != null)
      brushGroup.call(behavior.move, [xNumeric(xRange0[0]), xNumeric(xRange0[1])])
  }
  else if (yNumeric != null) {
    const behavior = brushY<unknown>().extent(extent).on('end', (event: { selection: [number, number] | null, sourceEvent?: Event }) => {
      if (event.sourceEvent != null)
        report(event.selection, yAxis!, yNumeric, true)
    })
    brushGroup.call(behavior)
    if (yRange0 != null)
      brushGroup.call(behavior.move, [yNumeric(yRange0[1]), yNumeric(yRange0[0])])
  }
  brushGroup.select('.selection').attr('fill', 'var(--series-1)').attr('fill-opacity', 0.15).attr('stroke', 'var(--series-1)')
  // A click on the empty plot (not a drag) lets the pinned case go, as in the parallel coordinates.
  brushGroup.select('.overlay').on('click.unpin', () => emit('pin', null, null, null))

  const points = props.rows.flatMap((row) => {
    const px = x.place(row)
    const py = y.place(row)
    return px == null || py == null ? [] : [{ px, py, row }]
  })
  const circles = svg.append('g').selectAll<SVGCircleElement, (typeof points)[number]>('circle').data(points, point => point.row.key).join('circle').attr('cx', point => point.px).attr('cy', point => point.py).attr('r', 3.2).style('cursor', 'pointer').on('pointerenter', (event: PointerEvent, point) => emit('hover', point.row, { x: event.clientX, y: event.clientY }, xAxis?.name ?? null)).on('pointerleave', () => emit('hover', null, null, null)).on('click', (event: MouseEvent, point) => emit('pin', point.row, { x: event.clientX, y: event.clientY }, xAxis?.name ?? null))

  const pinnedLayer = svg.append('g').attr('pointer-events', 'none')
  drawPinned = () => {
    const pinned = points.filter(point => point.row.key === props.pinnedKey)
    pinnedLayer.selectAll('circle').data(pinned).join('circle').attr('cx', point => point.px).attr('cy', point => point.py).attr('r', 6).attr('fill', point => props.colorOf(point.row)).attr('class', 'stroke-white dark:stroke-neutral-900').attr('stroke-width', 2)
    circles.attr('fill-opacity', point => (props.selected.has(point.row.key) ? (pinned.length > 0 ? 0.35 : 0.75) : 0.5))
  }
  return circles
}

function paint(): void {
  dots?.attr('fill', point => (props.selected.has(point.row.key) ? props.colorOf(point.row) : 'var(--chart-grid)'))
    .filter(point => props.selected.has(point.row.key))
    .raise()
  drawPinned?.()
}

function placement(axis: ParallelAxis | undefined, range: [number, number], salt: number): { place: Placement, scale?: ScaleBand<string> | ScaleContinuousNumeric<number, number> } {
  // No axis in this direction (a strip): spread every case over the middle of the range.
  if (axis == null) {
    const middle = (range[0] + range[1]) / 2
    const reach = Math.abs(range[1] - range[0]) * 0.4
    return { place: row => middle + spread(row.key, salt) * 2 * reach }
  }
  if (axis.kind === 'category') {
    const band = scaleBand(props.categoryValues[axis.name] ?? [], range).paddingInner(0.15).paddingOuter(0.05)
    return {
      place: (row) => {
        const value = row.categories[axis.name]
        const start = value == null ? undefined : band(value)
        return start == null ? null : start + band.bandwidth() / 2 + spread(row.key, salt) * band.bandwidth() * 0.85
      },
      scale: band,
    }
  }
  const scale = props.scales[axis.name]!.copy().range(range)
  return { place: row => (row.numbers[axis.name] == null ? null : scale(row.numbers[axis.name]!)), scale }
}

function render(): void {
  if (root.value == null)
    return
  const svg = select(root.value).select<SVGSVGElement>('svg')
  svg.selectAll('*').remove()
  dots = drawDots(svg)
  paint()
}

/**
 * Stable offset in `-0.5..0.5` per case and salt, so a case keeps its spot inside a band (or the free direction of a
 * strip) across redraws instead of jumping on every update.
 */
function spread(key: string, salt: number): number {
  let hash = salt * 2654435761
  for (let index = 0; index < key.length; index++)
    hash = Math.imul(hash ^ key.charCodeAt(index), 2654435761)
  return ((hash >>> 0) % 1000) / 1000 - 0.5
}

onMounted(render)
// Same rule as the parallel coordinates: brushing must not redraw (it would drop the brush being dragged), so the
// sources are compared one by one and only a category pick (a new object) redraws.
watch([() => props.rows, () => props.axes, () => props.categoryValues, () => props.scales, width, () => props.filters.categories], render)
watch([() => props.selected, () => props.colorOf], paint)
watch(() => props.pinnedKey, () => drawPinned?.())
</script>

<template>
  <div ref="root" :class="['relative overflow-x-auto select-none text-neutral-800 dark:text-neutral-200']" data-testid="case-cartesian">
    <svg role="img" :aria-label="`Cases by ${props.axes.map(axis => props.labelOf(axis.name)).join(' and ')}`" />
  </div>
</template>
