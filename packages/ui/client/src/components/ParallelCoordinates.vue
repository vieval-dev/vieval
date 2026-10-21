<script setup lang="ts">
import type { ScaleContinuousNumeric, Selection } from 'd3'

import type { CaseFilters, CaseRow } from '../caseMetrics'

import { axisLeft, brushY, drag, line, scalePoint, select } from 'd3'
import { onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { caseOffset, categoryValueLabel, shortMetricName } from '../caseMetrics'
import { useElementWidth } from '../composables/useElementWidth'
import { formatTick } from '../format'

/** One vertical axis: a numeric metric (brushable) or a category (values are picked by clicking their label). */
export interface ParallelAxis {
  kind: 'category' | 'numeric'
  name: string
}

/**
 * Parallel coordinates of cases: one line per case across category and metric axes.
 *
 * Use for reading the make-up of a task at a glance (which group, how long, how many steps, how it ended) and for
 * selecting cases by dragging a range on an axis. Dragging an axis title moves the axis: lines only join neighbors,
 * so two axes read together best side by side. Hovering a line only reports it (the chart is not redrawn, which
 * keeps the pointer smooth over hundreds of lines); clicking pins it and marks its value on every axis. Selection, axis order, and the hovered and pinned case live with the parent ({@link CaseFilters}); this
 * chart only draws them and reports brushes, picks, the new order, hovers, and pins.
 */
const props = defineProps<{
  axes: readonly ParallelAxis[]
  /** Values of each category axis, top to bottom. */
  categoryValues: Readonly<Record<string, readonly string[]>>
  colorOf: (row: CaseRow) => string
  /**
   * Cut lines of the metric the cases are colored by, drawn as draggable lines across its axis; dragging one past an
   * end of the axis removes it.
   */
  cuts?: { name: string, values: readonly number[] }
  filters: CaseFilters
  /** Display name of an axis (a metric's localized label, or its name). */
  labelOf: (name: string) => string
  /** Key of the pinned case, drawn on top with its value marked on every axis. */
  pinnedKey?: string
  rows: readonly CaseRow[]
  scales: Readonly<Record<string, ScaleContinuousNumeric<number, number>>>
  /** Keys of the selected cases. */
  selected: ReadonlySet<string>
}>()
const emit = defineEmits<{
  brush: [name: string, range: [number, number] | null]
  /** New cut values of an axis (sorted) after a cut line was dragged or dragged off. */
  cuts: [name: string, values: number[]]
  /** Case line under the pointer and the pointer position in the viewport; `null` when the pointer left the lines. */
  hover: [row: CaseRow | null, point: null | { x: number, y: number }, axis: null | string]
  /** Axis title under the pointer and its box in the viewport, or `null` when the pointer left it. */
  inspect: [name: null | string, box: DOMRect | null]
  pick: [name: string, value: string]
  /** Clicked case line and the click position, or `null` after a click on the empty chart. */
  pin: [row: CaseRow | null, point: null | { x: number, y: number }, axis: null | string]
  /** Axis names in their new left-to-right order, after an axis title was dragged. */
  reorder: [names: string[]]
}>()

const { locale, t } = useI18n()
const root = useTemplateRef<HTMLElement>('root')
const width = useElementWidth(root, 800)
const height = 360
const margin = { bottom: 16, left: 96, right: 72, top: 40 }

/** Category values fan out this much (stable per case), so a hundred cases of one group do not draw one stroke. */
const CATEGORY_FAN_PX = 13

let paths: Selection<SVGPathElement, CaseRow, SVGGElement, unknown> | undefined
// Draws the pinned case over everything; set by each render, since it needs that render's scales.
let drawFocus: (() => void) | undefined
// Every case line, faded as one group while a case is pinned (one attribute instead of one per line).
let lineGroup: Selection<SVGGElement, unknown, null, undefined> | undefined
// Where each axis was drawn by the last render, and the space between two axes; the flash of a new axis uses both.
let axisPositions = new Map<string, number>()
let axisStep = 0
// Axes of the previous render; `undefined` before the first one, so the axes the chart opens with do not flash.
let previousAxes: Set<string> | undefined
/** How long a new axis stays highlighted: the length of the shared `vv-flash` animation in `styles.css`. */
const FLASH_MS = 1200
let flashCount = 0
// A column tinted with the shared `vv-flash` animation over each axis just added from the axis picker.
const flashes = shallowRef<{ id: number, left: number, width: number }[]>([])

function drawLines(svg: Selection<SVGSVGElement, unknown, null, undefined>) {
  const chartWidth = Math.max(width.value, props.axes.length * 96 + margin.left + margin.right)
  svg.attr('viewBox', `0 0 ${chartWidth} ${height}`).attr('width', chartWidth).attr('height', height)
  const x = scalePoint(props.axes.map(axis => axis.name), [margin.left, chartWidth - margin.right])
  const y = (axis: ParallelAxis) => {
    if (axis.kind === 'category')
      return scalePoint(props.categoryValues[axis.name] ?? [], [height - margin.bottom, margin.top]).padding(0.4)
    return props.scales[axis.name]!.copy().range([height - margin.bottom, margin.top])
  }
  const scales = new Map(props.axes.map(axis => [axis.name, y(axis)]))
  const position = (row: CaseRow, axis: ParallelAxis): null | number => {
    if (axis.kind === 'category') {
      const value = row.categories[axis.name]
      const at = value == null ? undefined : (scales.get(axis.name) as ReturnType<typeof scalePoint<string>>)(value)
      return at == null ? null : at + caseOffset(row.key) * CATEGORY_FAN_PX
    }
    const value = row.numbers[axis.name]
    return value == null ? null : (scales.get(axis.name) as ScaleContinuousNumeric<number, number>)(value)
  }
  // Where each axis is drawn; differs from `x` only while a title is dragged.
  const at = new Map(props.axes.map(axis => [axis.name, x(axis.name)!]))
  axisPositions = at
  axisStep = x.step()
  const ordered = () => props.axes.toSorted((left, right) => at.get(left.name)! - at.get(right.name)!)
  const draw = line<[number, null | number]>().defined(point => point[1] != null).x(point => point[0]).y(point => point[1]!)
  const pathOf = (row: CaseRow) => draw(ordered().map(axis => [at.get(axis.name)!, position(row, axis)]))
  /** Axis drawn closest to a viewport x; the SVG is drawn 1:1 with its `viewBox`, so only the box offset applies. */
  const axisAt = (clientX: number): null | string => {
    const x = clientX - svg.node()!.getBoundingClientRect().left
    let nearest: null | string = null
    let distance = Infinity
    for (const [name, axisX] of at) {
      if (Math.abs(axisX - x) < distance) {
        distance = Math.abs(axisX - x)
        nearest = name
      }
    }
    return nearest
  }
  let lastHover: { axis?: null | string, key?: string } = {}
  lineGroup = svg.append('g').attr('pointer-events', 'none')
  const lines = lineGroup
    .selectAll<SVGPathElement, CaseRow>('path')
    .data(props.rows, row => row.key)
    .join('path')
    .attr('fill', 'none')
    .attr('stroke-width', 1.2)
    .attr('d', pathOf)
  // A 1 px line is too thin to point at, so a transparent, wider copy of every line takes the pointer.
  const hits = svg.append('g')
    .selectAll<SVGPathElement, CaseRow>('path')
    .data(props.rows, row => row.key)
    .join('path')
    .attr('fill', 'none')
    .attr('stroke', 'transparent')
    .attr('stroke-width', 7)
    .attr('d', pathOf)
    .style('cursor', 'pointer')
    // Along one line the pointer only reports a change of the nearest axis, so moving over it stays cheap.
    .on('pointerenter pointermove', (event: PointerEvent, row) => {
      const axis = axisAt(event.clientX)
      if (row.key === lastHover.key && axis === lastHover.axis)
        return
      lastHover = { axis, key: row.key }
      emit('hover', row, { x: event.clientX, y: event.clientY }, axis)
    })
    .on('pointerleave', () => {
      lastHover = {}
      emit('hover', null, null, null)
    })
    .on('click', (event: MouseEvent, row) => emit('pin', row, { x: event.clientX, y: event.clientY }, axisAt(event.clientX)))
  svg.on('click', (event: MouseEvent) => {
    if (event.target === svg.node())
      emit('pin', null, null, null)
  })

  const groups = new Map<string, Selection<SVGGElement, unknown, null, undefined>>()

  props.axes.forEach((axis, index) => {
    const g = svg.append('g').attr('transform', `translate(${at.get(axis.name)},0)`)
    groups.set(axis.name, g)
    // Dragging the title moves the axis; the other axes keep their order in the remaining slots, and lines follow.
    const moveAxis = drag<SVGTextElement, unknown>()
      .container(svg.node()!)
      // The hover card would trail the dragged title, so dragging hides it.
      .on('start', () => emit('inspect', null, null))
      .on('drag', (event: { x: number }) => {
        at.set(axis.name, Math.min(chartWidth - margin.right, Math.max(margin.left, event.x)))
        ordered().forEach((item, slot) => {
          if (item.name !== axis.name)
            at.set(item.name, margin.left + slot * x.step())
        })
        for (const [name, group] of groups)
          group.attr('transform', `translate(${at.get(name)},0)`)
        lines.attr('d', pathOf)
        hits.attr('d', pathOf)
        drawFocus?.()
      })
      .on('end', () => emit('reorder', ordered().map(item => item.name)))
    g.append('text').attr('y', 14).attr('text-anchor', 'middle').attr('font-size', 12).attr('font-weight', 600).attr('fill', 'currentColor').style('cursor', 'grab').text(props.labelOf(axis.name) === axis.name ? shortMetricName(axis.name, props.axes.map(item => item.name)) : props.labelOf(axis.name)).on('pointerenter', (event: PointerEvent) => emit('inspect', axis.name, (event.currentTarget as SVGTextElement).getBoundingClientRect())).on('pointerleave', () => emit('inspect', null, null)).call(moveAxis)
    g.append('text').attr('y', 27).attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', 'var(--chart-text)').text(axis.kind === 'category' ? t('metrics.charts.clickToPick') : 'constant' in props.scales[axis.name]! ? t('metrics.charts.symlogDrag') : t('metrics.charts.dragToSelect'))
    if (axis.kind === 'category') {
      const scale = scales.get(axis.name) as ReturnType<typeof scalePoint<string>>
      const picked = props.filters.categories[axis.name]
      g.append('line').attr('y1', margin.top).attr('y2', height - margin.bottom).attr('stroke', 'var(--chart-grid)')
      g.selectAll('text.value').data(scale.domain()).join('text').attr('class', 'value stroke-white dark:stroke-neutral-900 [paint-order:stroke]').attr('stroke-width', 3).attr('stroke-linejoin', 'round').attr('x', index === 0 ? -8 : 8).attr('text-anchor', index === 0 ? 'end' : 'start').attr('y', value => scale(value)! + 3.5).attr('font-size', 11).attr('font-weight', value => (picked?.has(value) ? 700 : 400)).attr('fill', value => (picked?.has(value) ? 'var(--series-1)' : 'var(--chart-text)')).style('cursor', 'pointer').text(value => categoryValueLabel(axis.name, value)).on('click', (_, value) => emit('pick', axis.name, value))
      return
    }
    const scale = scales.get(axis.name) as ScaleContinuousNumeric<number, number>
    // NOTICE:
    // d3-axis writes `font-family="sans-serif"` (and `font-size="10"`) onto the axis group on every call,
    // so tick labels would render in the system sans instead of the viewer font. Drop the attribute so
    // the labels inherit `font.sans` from the page. See `node_modules/d3-axis/src/axis.js:109-110` (`selection.attr("font-family", "sans-serif")`).
    g.call(axisLeft(scale).ticks(5).tickFormat(value => formatTick(value as number)).tickSizeOuter(0))
      .attr('font-family', null)
      .call(axisGroup => axisGroup.selectAll('text').attr('fill', 'var(--chart-text)'))
      .call(axisGroup => axisGroup.selectAll('line, path').attr('stroke', 'var(--chart-grid)'))
    const brush = brushY<unknown>().extent([[-12, margin.top], [12, height - margin.bottom]]).on('brush end', (event: { selection: [number, number] | null, sourceEvent?: Event }) => {
      // Programmatic moves (restoring a brush after a redraw) carry no source event and change nothing.
      if (event.sourceEvent == null)
        return
      emit('brush', axis.name, event.selection == null ? null : [scale.invert(event.selection[1]), scale.invert(event.selection[0])])
    })
    const brushGroup = g.append('g').call(brush)
    brushGroup.select('.selection').attr('fill', 'var(--series-1)').attr('fill-opacity', 0.2).attr('stroke', 'var(--series-1)')
    const range = props.filters.ranges[axis.name]
    if (range != null)
      brushGroup.call(brush.move, [scale(range[1]), scale(range[0])])
    if (props.cuts?.name === axis.name)
      drawCuts(g, axis.name, scale)
  })

  // Over the axes, so the marks of the focused case are never hidden behind a brush or a label.
  const focus = svg.append('g').attr('pointer-events', 'none')
  drawFocus = () => {
    const pinned = props.pinnedKey == null ? undefined : props.rows.find(row => row.key === props.pinnedKey)
    const rows = pinned == null ? [] : [pinned]
    lineGroup?.attr('opacity', pinned == null ? 1 : 0.4)
    focus.selectAll<SVGPathElement, CaseRow>('path').data(rows, row => row.key).join('path').attr('fill', 'none').attr('stroke', row => props.colorOf(row)).attr('stroke-width', 3).attr('d', pathOf)
    const marks = pinned == null
      ? []
      : ordered().flatMap((axis) => {
          const y = position(pinned, axis)
          return y == null ? [] : [{ key: axis.name, x: at.get(axis.name)!, y }]
        })
    focus.selectAll<SVGCircleElement, (typeof marks)[number]>('circle').data(marks, mark => mark.key).join('circle').attr('cx', mark => mark.x).attr('cy', mark => mark.y).attr('r', 4.5).attr('fill', pinned == null ? 'none' : props.colorOf(pinned)).attr('class', 'stroke-white dark:stroke-neutral-900').attr('stroke-width', 2)
  }
  return lines
}

/** How far a cut line reaches to each side of its axis, and how far past an end of the axis a drag removes it. */
const CUT_REACH_PX = 32
const CUT_REMOVE_PX = 10

/**
 * Draws the cut lines of the colored metric across its axis, over the brush: a dashed line, a handle to drag it, and
 * its value. Dragging moves a line along the axis; dropping it past either end removes the cut. The new cuts are
 * reported once the drag ends, so the chart is redrawn once, not on every move.
 */
function drawCuts(g: Selection<SVGGElement, unknown, null, undefined>, name: string, scale: ScaleContinuousNumeric<number, number>): void {
  const values = [...(props.cuts?.values ?? [])]
  const top = margin.top
  const bottom = height - margin.bottom
  values.forEach((value, index) => {
    const cut = g.append('g').attr('transform', `translate(0,${scale(value)})`).style('cursor', 'ns-resize').attr('data-testid', 'cut-line')
    cut.append('line').attr('x1', -CUT_REACH_PX).attr('x2', CUT_REACH_PX).attr('stroke', 'currentColor').attr('stroke-width', 1.25).attr('stroke-dasharray', '4 3')
    // A wider transparent band takes the pointer, so the 1 px line is easy to grab.
    cut.append('rect').attr('x', -CUT_REACH_PX).attr('y', -5).attr('width', CUT_REACH_PX * 2).attr('height', 10).attr('fill', 'transparent')
    cut.append('circle').attr('cx', CUT_REACH_PX).attr('r', 4.5).attr('class', 'fill-white dark:fill-neutral-900').attr('stroke', 'currentColor').attr('stroke-width', 1.5)
    const label = cut.append('text').attr('x', CUT_REACH_PX + 8).attr('y', 3.5).attr('font-size', 11).attr('font-weight', 600).attr('fill', 'currentColor').attr('class', 'stroke-white dark:stroke-neutral-900 [paint-order:stroke]').attr('stroke-width', 3).text(formatTick(value))
    cut.call(drag<SVGGElement, unknown>()
      .on('drag', (event: { y: number }) => {
        cut.attr('transform', `translate(0,${event.y})`)
        const off = event.y < top - CUT_REMOVE_PX || event.y > bottom + CUT_REMOVE_PX
        cut.attr('opacity', off ? 0.35 : 1)
        label.text(off ? t('metrics.charts.removeCut') : formatTick(scale.invert(Math.min(bottom, Math.max(top, event.y)))))
      })
      .on('end', (event: { y: number }) => {
        const next = values.filter((_, other) => other !== index)
        if (event.y >= top - CUT_REMOVE_PX && event.y <= bottom + CUT_REMOVE_PX)
          next.push(Number(scale.invert(Math.min(bottom, Math.max(top, event.y))).toPrecision(3)))
        emit('cuts', name, next.sort((a, b) => a - b))
      }))
  })
}

/**
 * Tints the column of every axis added since the last render, and scrolls the first one into view: with many axes a
 * newly picked metric is otherwise hard to find. Reordering or removing axes adds none, so nothing flashes then.
 */
function flashNewAxes(): void {
  const names = props.axes.map(axis => axis.name)
  const added = previousAxes == null ? [] : names.filter(name => !previousAxes!.has(name))
  previousAxes = new Set(names)
  if (added.length === 0)
    return
  const columns = added.map(name => ({ id: ++flashCount, left: axisPositions.get(name)! - axisStep / 2, width: axisStep }))
  flashes.value = [...flashes.value, ...columns]
  setTimeout(() => {
    flashes.value = flashes.value.filter(flash => !columns.includes(flash))
  }, FLASH_MS)
  const first = columns[0]!
  const view = root.value
  if (view != null && (first.left < view.scrollLeft || first.left + first.width > view.scrollLeft + view.clientWidth))
    view.scrollTo({ behavior: 'smooth', left: Math.max(0, first.left - (view.clientWidth - first.width) / 2) })
}

function paint(): void {
  if (paths == null)
    return
  const many = props.selected.size > 120
  paths
    .attr('stroke', row => (props.selected.has(row.key) ? props.colorOf(row) : 'var(--chart-grid)'))
    .attr('stroke-opacity', row => (props.selected.has(row.key) ? (many ? 0.45 : 0.85) : 0.5))
    .filter(row => props.selected.has(row.key))
    .raise()
  drawFocus?.()
}

function render(): void {
  if (root.value == null)
    return
  const svg = select(root.value).select<SVGSVGElement>('svg')
  svg.selectAll('*').remove()
  paths = drawLines(svg)
  paint()
  flashNewAxes()
}

onMounted(render)
// Separate sources, compared one by one: a getter returning a fresh array would redraw on every brush event (it
// reads `props.filters`), which drops the brush the viewer is still dragging. Picked categories keep their object
// while a range is brushed, so only a pick redraws (to bold the picked label). The SVG text is written once per draw,
// so a change of language redraws too.
watch([() => props.rows, () => props.axes, () => props.categoryValues, () => props.scales, width, () => props.filters.categories, () => props.cuts, locale], render)
watch([() => props.selected, () => props.colorOf], paint)
// Pinning redraws only the pinned line and its marks.
watch(() => props.pinnedKey, () => drawFocus?.())
</script>

<template>
  <div ref="root" :class="['relative overflow-x-auto select-none text-neutral-800 dark:text-neutral-200']" data-testid="parallel-coordinates">
    <svg role="img" :aria-label="t('metrics.charts.parallel')" />
    <div
      v-for="flash in flashes" :key="flash.id"
      :class="['vv-flash absolute top-0 rounded-md pointer-events-none']"
      :style="{ height: `${height}px`, left: `${flash.left}px`, width: `${flash.width}px` }"
      aria-hidden="true"
    />
  </div>
</template>
