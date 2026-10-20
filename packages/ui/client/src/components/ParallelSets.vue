<script setup lang="ts">
import type { CaseFilters, CaseRow } from '../caseMetrics'

import { computed, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { useElementWidth } from '../composables/useElementWidth'
import { formatCount, formatScore } from '../format'

/**
 * Parallel sets of cases over category axes (matrix axes such as `tts` and `language`, string metrics such as a
 * stratum): every axis stacks one block per value, as tall as its share of the cases, and ribbons as wide as the cases
 * they carry join neighbor axes. Ribbons take the chart's case colors; cases outside the selection fade to gray.
 * Beside each value, its cases' mean primary score (of the selection, when one is made), so brushing `tts=official`
 * reads as "within official, ko is worst". Blocks are sorted by that score, best on top.
 *
 * Use when:
 * - several category axes split the cases and the question is which values lose the score, where parallel
 *   coordinates collapse every case of a value onto one point
 *
 * Expects:
 * - at least two category axes; numeric axes belong in the parallel coordinates
 */
const props = defineProps<{
  /** Category axes, left to right. */
  axes: readonly string[]
  colorOf: (row: CaseRow) => string
  filters: CaseFilters
  labelOf: (name: string) => string
  rows: readonly CaseRow[]
  /** Score beside each value (`CaseTable.primary`); without it, the blocks show their case counts only. */
  score?: string
  /** Keys of the selected cases. */
  selected: ReadonlySet<string>
}>()
const emit = defineEmits<{
  /** Axis title under the pointer and its box in the viewport, or `null` when the pointer left it (as in the parallel coordinates). */
  inspect: [name: null | string, box: DOMRect | null]
  pick: [name: string, value: string]
  /** Axis names in their new left-to-right order, after an axis title was dragged. */
  reorder: [names: string[]]
}>()
const { t } = useI18n()

const root = useTemplateRef<HTMLElement>('root')
const width = useElementWidth(root, 800)
const height = 420
const margin = { bottom: 12, left: 150, right: 24, top: 40 }
/** Space between two blocks of one axis, and the width of a block. */
const GAP_PX = 4
const BLOCK_PX = 10
/** A block shorter than this keeps its label off, so neighbors do not overlap; its value is in the tooltip. */
const MIN_LABEL_PX = 14

/** The axis whose title is being dragged, and where the pointer is in chart coordinates. */
const dragging = shallowRef<{ name: string, x: number }>()

const filtering = computed(() => props.selected.size < props.rows.length)
interface Block { count: number, from: number, height: number, mean: null | number, picked: boolean, value: string }

function meanOf(rows: readonly CaseRow[]) {
  if (props.score == null)
    return null
  const scores = rows.map(row => row.numbers[props.score!]).filter((value): value is number => value != null)
  return scores.length === 0 ? null : scores.reduce((sum, value) => sum + value, 0) / scores.length
}

const layout = computed(() => {
  const rows = props.rows.filter(row => props.axes.every(axis => row.categories[axis] != null))
  const usable = height - margin.top - margin.bottom
  // Neighbor axes keep at least 140 px between them; a narrow screen scrolls the chart instead.
  const chartWidth = Math.max(width.value, margin.left + margin.right + (props.axes.length - 1) * 140)
  const step = props.axes.length > 1 ? (chartWidth - margin.left - margin.right) / (props.axes.length - 1) : 0
  // While a title is dragged, the axes take the order of their positions with the dragged one under the pointer; the
  // others keep the remaining slots, and ribbons follow.
  const slotOf = (name: string, index: number) => (dragging.value?.name === name ? dragging.value.x : margin.left + index * step)
  const axes = props.axes.toSorted((a, b) => slotOf(a, props.axes.indexOf(a)) - slotOf(b, props.axes.indexOf(b)))
  const xOf = (index: number) => (dragging.value?.name === axes[index] ? dragging.value.x : margin.left + index * step)
  const blocks = new Map<string, Map<string, Block>>()
  for (const axis of axes) {
    const byValue = new Map<string, CaseRow[]>()
    for (const row of rows) {
      const value = row.categories[axis]!
      const members = byValue.get(value)
      if (members == null)
        byValue.set(value, [row])
      else
        members.push(row)
    }
    // The score of the selection orders the blocks, so the axis reads best to worst for what is being looked at.
    const entries = [...byValue].map(([value, members]) => ({
      count: members.length,
      mean: meanOf(filtering.value ? members.filter(row => props.selected.has(row.key)) : members),
      value,
    })).sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1) || b.count - a.count)
    const space = usable - GAP_PX * Math.max(0, entries.length - 1)
    let y = margin.top
    const axisBlocks = new Map<string, Block>()
    for (const entry of entries) {
      const blockHeight = (space * entry.count) / Math.max(1, rows.length)
      axisBlocks.set(entry.value, { ...entry, from: y, height: blockHeight, picked: props.filters.categories[axis]?.has(entry.value) === true })
      y += blockHeight + GAP_PX
    }
    blocks.set(axis, axisBlocks)
  }

  // Ribbons between neighbor axes: cases grouped by (left value, right value, color, selected). Inside a block, cases
  // stack by their value on the other side, then selected first, then color, so every ribbon is one slice at both ends.
  const ribbons: { color: string, d: string, key: string, selected: boolean, title: string }[] = []
  axes.slice(0, -1).forEach((left, index) => {
    const right = axes[index + 1]!
    const leftBlocks = blocks.get(left)!
    const rightBlocks = blocks.get(right)!
    const rank = (axis: string, value: string) => [...blocks.get(axis)!.keys()].indexOf(value)
    const groups = new Map<string, { color: string, count: number, leftValue: string, rightValue: string, selected: boolean }>()
    for (const row of rows) {
      const selected = !filtering.value || props.selected.has(row.key)
      const color = props.colorOf(row)
      const key = [row.categories[left], row.categories[right], selected, color].join('\u0000')
      const group = groups.get(key)
      if (group == null)
        groups.set(key, { color, count: 1, leftValue: row.categories[left]!, rightValue: row.categories[right]!, selected })
      else
        group.count += 1
    }
    const list = [...groups.values()]
    const sortFor = (own: 'leftValue' | 'rightValue', other: 'leftValue' | 'rightValue', axis: string) =>
      list.toSorted((a, b) => a[own].localeCompare(b[own]) || rank(axis, a[other]) - rank(axis, b[other]) || Number(b.selected) - Number(a.selected) || a.color.localeCompare(b.color))
    const offsets = new Map<object, { left: number, right: number }>()
    // Each block's height is its share of the cases, so a ribbon's slice is its count over the block's count.
    const place = (ordered: typeof list, own: 'leftValue' | 'rightValue', blocksOf: Map<string, Block>, side: 'left' | 'right') => {
      const used = new Map<string, number>()
      for (const group of ordered) {
        const block = blocksOf.get(group[own])!
        const start = used.get(group[own]) ?? 0
        const slice = (block.height * group.count) / Math.max(1, block.count)
        used.set(group[own], start + slice)
        const entry = offsets.get(group) ?? { left: 0, right: 0 }
        entry[side] = block.from + start
        offsets.set(group, entry)
      }
    }
    place(sortFor('leftValue', 'rightValue', right), 'leftValue', leftBlocks, 'left')
    place(sortFor('rightValue', 'leftValue', left), 'rightValue', rightBlocks, 'right')
    const x0 = xOf(index) + BLOCK_PX / 2
    const x1 = xOf(index + 1) - BLOCK_PX / 2
    const xm = (x0 + x1) / 2
    // Unselected ribbons first, so the selection is drawn over them.
    for (const group of list.toSorted((a, b) => Number(a.selected) - Number(b.selected))) {
      const { left: y0, right: y1 } = offsets.get(group)!
      const h0 = (leftBlocks.get(group.leftValue)!.height * group.count) / Math.max(1, leftBlocks.get(group.leftValue)!.count)
      const h1 = (rightBlocks.get(group.rightValue)!.height * group.count) / Math.max(1, rightBlocks.get(group.rightValue)!.count)
      ribbons.push({
        color: group.color,
        d: `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + h1} C${xm},${y1 + h1} ${xm},${y0 + h0} ${x0},${y0 + h0} Z`,
        key: `${index}\u0000${group.leftValue}\u0000${group.rightValue}\u0000${group.selected}\u0000${group.color}`,
        selected: group.selected,
        title: [
          t('matrix.parallelSets.ribbonTitle', { from: group.leftValue, n: formatCount(group.count), to: group.rightValue }, group.count),
          ...(filtering.value && !group.selected ? [t('matrix.parallelSets.notSelected')] : []),
        ].join(' '),
      })
    }
  })
  return {
    axes: axes.map((axis, index) => ({ blocks: [...blocks.get(axis)!.values()], name: axis, x: xOf(index) })),
    order: axes,
    ribbons,
    width: chartWidth,
  }
})

/** Moves an axis by its title: the pointer is followed until release, then the new order is reported. */
function startDrag(name: string, event: PointerEvent): void {
  const svg = (event.currentTarget as SVGElement).ownerSVGElement
  if (svg == null)
    return
  emit('inspect', null, null)
  const toChart = (clientX: number) => Math.min(layout.value.width - margin.right, Math.max(margin.left, clientX - svg.getBoundingClientRect().left))
  const move = (moveEvent: PointerEvent) => {
    dragging.value = { name, x: toChart(moveEvent.clientX) }
  }
  const end = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    const order = layout.value.order
    dragging.value = undefined
    if (order.join('\u0000') !== props.axes.join('\u0000'))
      emit('reorder', [...order])
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
}
</script>

<template>
  <div ref="root" :class="['overflow-x-auto select-none']" data-testid="parallel-sets">
    <svg :width="layout.width" :height="height" :viewBox="`0 0 ${layout.width} ${height}`" role="img" :aria-label="t('matrix.parallelSets.label', { axes: props.axes.map(props.labelOf).join(', '), n: formatCount(props.rows.length) }, props.rows.length)" :class="['block']">
      <path v-for="ribbon in layout.ribbons" :key="ribbon.key" :d="ribbon.d" :fill="ribbon.selected ? ribbon.color : 'var(--chart-text)'" :fill-opacity="ribbon.selected ? 0.55 : 0.08" :class="['transition-[fill-opacity] hover:fill-opacity-80']">
        <title>{{ ribbon.title }}</title>
      </path>
      <g v-for="axis in layout.axes" :key="axis.name">
        <!-- Dragging the title moves the axis; hovering it shows what the axis is (the card floats from the parent). -->
        <text
          :x="axis.x" y="14" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor"
          :class="[dragging?.name === axis.name ? 'cursor-grabbing' : 'cursor-grab']" data-testid="sets-axis-title"
          @pointerdown.prevent="event => startDrag(axis.name, event)"
          @pointerenter="event => dragging == null && emit('inspect', axis.name, (event.currentTarget as SVGTextElement).getBoundingClientRect())"
          @pointerleave="emit('inspect', null, null)"
        >{{ props.labelOf(axis.name) }}</text>
        <text :x="axis.x" y="27" text-anchor="middle" font-size="10" fill="var(--chart-text)">{{ t('matrix.parallelSets.axisHint') }}</text>
        <g v-for="block in axis.blocks" :key="block.value" :class="['cursor-pointer']" @click="emit('pick', axis.name, block.value)">
          <title>{{ t('matrix.parallelSets.blockTitle', { n: formatCount(block.count), value: block.value }, block.count) }}<template v-if="props.score"> · {{ props.labelOf(props.score) }} {{ formatScore(block.mean) }}</template></title>
          <rect
            :x="axis.x - BLOCK_PX / 2" :y="block.from" :width="BLOCK_PX" :height="Math.max(1, block.height)" rx="2"
            :fill="block.picked ? 'var(--series-1)' : 'var(--chart-grid)'" :stroke="block.picked ? 'var(--series-1)' : 'none'"
          />
          <!-- The value and its score left of the block, haloed like the value labels of the parallel coordinates. -->
          <text
            v-if="block.height >= MIN_LABEL_PX"
            :x="axis.x - BLOCK_PX / 2 - 6" :y="block.from + block.height / 2 + 4" text-anchor="end" font-size="11"
            :class="['stroke-white dark:stroke-neutral-900 [paint-order:stroke]']" stroke-width="3" stroke-linejoin="round"
            :fill="block.picked ? 'var(--series-1)' : 'var(--chart-text)'" :font-weight="block.picked ? 700 : 400"
          >
            {{ block.value }}<tspan v-if="block.mean != null" dx="6" font-weight="700" fill="currentColor" font-family="var(--font-mono, monospace)">{{ formatScore(block.mean) }}</tspan>
          </text>
        </g>
      </g>
    </svg>
  </div>
</template>
