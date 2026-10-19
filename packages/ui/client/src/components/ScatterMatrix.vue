<script setup lang="ts">
import type { BrushBehavior, ScaleContinuousNumeric, Selection } from 'd3'

import type { CaseFilters, CaseRow } from '../caseMetrics'

import { axisBottom, axisLeft, bin, brush, max, select } from 'd3'
import { onMounted, useTemplateRef, watch } from 'vue'

import { shortMetricName } from '../caseMetrics'
import { formatTick } from '../format'

/**
 * Scatterplot matrix of cases: every pair of the given metrics in the lower triangle, the distribution of each
 * metric on the diagonal.
 *
 * Use for spotting how two metrics move together (steps against duration, output tokens against steps) and for
 * selecting cases with a rectangle in one cell. Keep it to a handful of metrics: cells grow with the square.
 */
const props = defineProps<{
  colorOf: (row: CaseRow) => string
  filters: CaseFilters
  /** Display name of a metric (its localized label, or its name). */
  labelOf: (name: string) => string
  /** Metrics in matrix order. */
  metrics: readonly string[]
  /** Key of the pinned case, drawn larger and ringed in every cell over the other dots. */
  pinnedKey?: string
  rows: readonly CaseRow[]
  scales: Readonly<Record<string, ScaleContinuousNumeric<number, number>>>
  /** Keys of the selected cases. */
  selected: ReadonlySet<string>
}>()
const emit = defineEmits<{
  box: [box: CaseFilters['box']]
  /** Dot under the pointer and the pointer position in the viewport; `null` when the pointer left the dots. */
  hover: [row: CaseRow | null, point: null | { x: number, y: number }, axis: null | string]
  /** Clicked dot and the click position. */
  pin: [row: CaseRow | null, point: null | { x: number, y: number }, axis: null | string]
}>()

const root = useTemplateRef<HTMLElement>('root')
const cell = 128
const pad = 14
const gutter = 36

type Group = Selection<SVGGElement, unknown, null, undefined>
let dots: Selection<SVGCircleElement, CaseRow, SVGGElement, unknown>[] = []
// One overlay per cell for the pinned dot, so pinning touches one circle per cell instead of every dot.
let marks: { group: Group, x: (row: CaseRow) => null | number, y: (row: CaseRow) => null | number }[] = []
let histograms: { group: Group, metric: string }[] = []
// The dots of every cell as one group each, faded together while a case is pinned (one attribute per cell).
let dotGroups: Group[] = []

/** Draws the pinned case as one ringed dot per cell, over the other dots. */
/**
 * Draws the pinned case: a ringed dot in every cell over the other dots, which step back so it can be found, and a
 * tick at its value on each diagonal histogram.
 */
function drawPinned(): void {
  const pinned = props.pinnedKey == null ? undefined : props.rows.find(row => row.key === props.pinnedKey)
  for (const group of dotGroups)
    group.attr('opacity', pinned == null ? 1 : 0.3)
  for (const { group, metric } of histograms) {
    const value = pinned?.numbers[metric]
    const at = value == null ? [] : [props.scales[metric]!.copy().range([pad, cell - pad])(value)]
    group.selectAll<SVGLineElement, number>('line.pinned').data(at).join('line').attr('class', 'pinned').attr('x1', x => x).attr('x2', x => x).attr('y1', 26).attr('y2', cell - pad).attr('stroke', pinned == null ? 'none' : props.colorOf(pinned)).attr('stroke-width', 2).raise()
  }
  for (const mark of marks) {
    const x = pinned == null ? null : mark.x(pinned)
    const y = pinned == null ? null : mark.y(pinned)
    const points = pinned == null || x == null || y == null ? [] : [{ x, y }]
    mark.group.selectAll('circle').data(points).join('circle').attr('cx', point => point.x).attr('cy', point => point.y).attr('r', 5).attr('fill', pinned == null ? 'none' : props.colorOf(pinned)).attr('class', 'stroke-white dark:stroke-neutral-900').attr('stroke-width', 1.5)
  }
}

function paint(): void {
  for (const group of dots) {
    group
      .attr('fill', item => (props.selected.has(item.key) ? props.colorOf(item) : 'var(--chart-grid)'))
      .attr('fill-opacity', item => (props.selected.has(item.key) ? 0.85 : 0.6))
      .filter(item => props.selected.has(item.key))
      .raise()
  }
  // Diagonal: every case in the grid color, the selected ones over it in the accent color.
  for (const { group, metric } of histograms) {
    const scale = props.scales[metric]!.copy().range([pad, cell - pad])
    const positions = (rows: readonly CaseRow[]) => rows.map(item => item.numbers[metric]).filter((value): value is number => value != null).map(value => scale(value))
    const binner = bin().domain([pad, cell - pad]).thresholds(14)
    const all = binner(positions(props.rows))
    const picked = binner(positions(props.rows.filter(item => props.selected.has(item.key))))
    const height = (value: number) => (value / Math.max(1, max(all, item => item.length) ?? 1)) * (cell - 44)
    for (const [className, bins, fill] of [['all', all, 'var(--chart-grid)'], ['picked', picked, 'var(--series-1)']] as const) {
      group.selectAll<SVGRectElement, (typeof bins)[number]>(`rect.${className}`).data(bins).join('rect').attr('class', className).attr('fill', fill).attr('x', item => item.x0! + 0.5).attr('width', item => Math.max(0, item.x1! - item.x0! - 1)).attr('y', item => cell - pad - height(item.length)).attr('height', item => height(item.length)).attr('rx', 1)
    }
  }
  // Bars joined for a new selection are appended last; the pinned case's tick stays on top of them.
  for (const { group } of histograms)
    group.select('line.pinned').raise()
}

function render(): void {
  if (root.value == null)
    return
  const svg = select(root.value).select<SVGSVGElement>('svg')
  svg.selectAll('*').remove()
  const count = props.metrics.length
  const size = gutter + count * cell
  svg.attr('viewBox', `0 0 ${size} ${size}`).attr('width', size).attr('height', size)
  const x: Record<string, ScaleContinuousNumeric<number, number>> = {}
  const y: Record<string, ScaleContinuousNumeric<number, number>> = {}
  for (const metric of props.metrics) {
    x[metric] = props.scales[metric]!.copy().range([pad, cell - pad])
    y[metric] = props.scales[metric]!.copy().range([cell - pad, pad])
  }
  dots = []
  dotGroups = []
  marks = []
  histograms = []
  const brushes: { behavior: BrushBehavior<unknown>, group: Group }[] = []
  props.metrics.forEach((rowMetric, row) => props.metrics.forEach((columnMetric, column) => {
    if (column > row)
      return
    const g = svg.append('g').attr('transform', `translate(${gutter + column * cell},${row * cell})`)
    g.append('rect').attr('x', 3).attr('y', 3).attr('width', cell - 6).attr('height', cell - 6).attr('rx', 6).attr('fill', 'none').attr('stroke', 'var(--chart-grid)')
    if (row === column) {
      g.append('text').attr('x', cell / 2).attr('y', 18).attr('text-anchor', 'middle').attr('font-size', 11).attr('font-weight', 600).attr('fill', 'currentColor').text(props.labelOf(columnMetric) === columnMetric ? shortMetricName(columnMetric, props.metrics) : props.labelOf(columnMetric)).append('title').text(columnMetric)
      histograms.push({ group: g.append('g'), metric: columnMetric })
      return
    }
    const xs = x[columnMetric]!
    const ys = y[rowMetric]!
    const dotGroup = g.append('g')
    dotGroups.push(dotGroup)
    dots.push(dotGroup.selectAll<SVGCircleElement, CaseRow>('circle')
      .data(props.rows.filter(item => item.numbers[columnMetric] != null && item.numbers[rowMetric] != null), item => item.key)
      .join('circle')
      .attr('r', 2.4)
      .attr('cx', item => xs(item.numbers[columnMetric]!))
      .attr('cy', item => ys(item.numbers[rowMetric]!))
      .style('cursor', 'pointer')
      // A dot stands for two metrics; the card leads with the one of the cell's column.
      .on('pointerenter', (event: PointerEvent, item) => emit('hover', item, { x: event.clientX, y: event.clientY }, columnMetric))
      .on('pointerleave', () => emit('hover', null, null, null))
      .on('click', (event: MouseEvent, item) => emit('pin', item, { x: event.clientX, y: event.clientY }, columnMetric)))
    marks.push({
      group: g.append('g').attr('pointer-events', 'none'),
      x: item => (item.numbers[columnMetric] == null ? null : xs(item.numbers[columnMetric]!)),
      y: item => (item.numbers[rowMetric] == null ? null : ys(item.numbers[rowMetric]!)),
    })
    // Under the dots: the brush overlay covers the whole cell and would otherwise take every pointer event.
    const group = g.insert('g', 'g')
    const behavior = brush<unknown>().extent([[3, 3], [cell - 3, cell - 3]]).on('start', (event: { sourceEvent?: Event }) => {
      // One rectangle at a time: starting one clears the others.
      if (event.sourceEvent == null)
        return
      for (const other of brushes) {
        if (other.group !== group)
          other.group.call(other.behavior.move, null)
      }
    }).on('end', (event: { selection: [[number, number], [number, number]] | null, sourceEvent?: Event }) => {
      if (event.sourceEvent == null)
        return
      if (event.selection == null) {
        emit('box', null)
        return
      }
      const [[left, top], [right, bottom]] = event.selection
      emit('box', { x: columnMetric, x0: xs.invert(left), x1: xs.invert(right), y: rowMetric, y0: ys.invert(bottom), y1: ys.invert(top) })
    })
    group.call(behavior)
    group.select('.selection').attr('fill', 'var(--series-1)').attr('fill-opacity', 0.2).attr('stroke', 'var(--series-1)')
    brushes.push({ behavior, group })
    const box = props.filters.box
    if (box != null && box.x === columnMetric && box.y === rowMetric)
      group.call(behavior.move, [[xs(box.x0), ys(box.y1)], [xs(box.x1), ys(box.y0)]])
    // Ticks only along the outer edge, so the cells stay readable.
    if (column === 0) {
      g.append('g').attr('transform', `translate(${pad - 3},0)`).call(axisLeft(ys).ticks(3).tickFormat(value => formatTick(value as number)).tickSize(3)).call(axisGroup => axisGroup.select('.domain').remove()).call(axisGroup => axisGroup.selectAll('text').attr('fill', 'var(--chart-text)'))
    }
    if (row === count - 1) {
      g.append('g').attr('transform', `translate(0,${cell - pad + 3})`).call(axisBottom(xs).ticks(3).tickFormat(value => formatTick(value as number)).tickSize(3)).call(axisGroup => axisGroup.select('.domain').remove()).call(axisGroup => axisGroup.selectAll('text').attr('fill', 'var(--chart-text)'))
    }
  }))
  paint()
  drawPinned()
}

onMounted(render)
watch([() => props.rows, () => props.metrics, () => props.scales], render)
watch([() => props.selected, () => props.colorOf], paint)
watch(() => props.pinnedKey, drawPinned)
</script>

<template>
  <div ref="root" :class="['relative overflow-x-auto select-none text-neutral-800 dark:text-neutral-200']" data-testid="scatter-matrix">
    <svg role="img" aria-label="Scatterplot matrix of the cases" />
  </div>
</template>
