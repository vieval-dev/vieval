<script setup lang="ts">
import type { Ref } from 'vue'

import type { CompareAxis, Interval, PairedDelta } from '../comparison'
import type { PointAxisReading } from './ComparePointCard.vue'

import { useMediaQuery, usePreferredReducedMotion } from '@vueuse/core'
import { scaleLinear, scaleLog } from 'd3'
import { PopoverAnchor, PopoverArrow, PopoverContent, PopoverPortal, PopoverRoot } from 'reka-ui'
import { DrawerContent, DrawerDescription, DrawerHandle, DrawerOverlay, DrawerPortal, DrawerRoot, DrawerTitle } from 'vaul-vue'
import { computed, onBeforeUnmount, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AnimatedContent from './AnimatedContent.vue'
import ComparePointCard from './ComparePointCard.vue'

import { useElementWidth } from '../composables/useElementWidth'

/** One compared column on the plane: its mean on both axes with their 95% intervals. */
export interface PlanePoint {
  /** Paired differences from the baseline on each axis; absent for the baseline. */
  delta: { x?: PairedDelta, y?: PairedDelta }
  href?: string
  id: string
  label: string
  x: Interval
  y: Interval
}

/** How an axis of the plane maps values to positions. */
export type ScaleKind = 'linear' | 'log'

/**
 * The compared columns on two axes (a score against a cost, or two scores), one dot per column with whiskers for the
 * 95% confidence interval of each mean, the way harness benchmarks put agents on "score vs. cost" planes.
 *
 * Use for reading trade-offs between a handful of columns: the Pareto front (columns no other column beats on both
 * axes) is filled and joined by a dashed line, beaten columns are hollow, and the baseline is gray. Labels sit beside
 * the dots where they fit without covering another dot or label; a label that fits nowhere shows on hover. Hovering a
 * dot previews its card (score interval, and advantage over the baseline with its interval); clicking pins the card,
 * which can make the column the baseline or open its run, as the case charts pin a case.
 */
const props = defineProps<{
  baseline?: string
  baselineLabel?: string
  formatDeltaX: (value: number) => string
  formatDeltaY: (value: number) => string
  formatX: (value: number) => string
  formatY: (value: number) => string
  /** Ids on the Pareto front, ordered along x. */
  front: readonly string[]
  points: readonly PlanePoint[]
  x: CompareAxis
  /**
   * `log` spreads values that span orders of magnitude (a 4 ms baseline beside 2.5 s rewrites); only for an axis whose
   * means are all positive (`canLogScale` in `comparison.ts`), scores included.
   * @default 'linear'
   */
  xScaleKind?: ScaleKind
  y: CompareAxis
  /** @default 'linear' */
  yScaleKind?: ScaleKind
}>()
const emit = defineEmits<{
  baseline: [id: string]
  /** Hide the column from the charts (an outlier that squeezes the others). */
  hide: [id: string]
}>()

const { t } = useI18n()
const root = useTemplateRef<HTMLElement>('root')
const svg = useTemplateRef<SVGSVGElement>('svg')
const width = useElementWidth(root, 640)
const height = computed(() => Math.round(Math.min(420, Math.max(260, width.value * 0.5))))
const margin = { bottom: 34, left: 52, right: 16, top: 24 }

/**
 * Domain of an axis: every interval with a little room, rounded to nice ticks. A score axis stays inside 0–100%, but
 * it is not forced to start at 0: dots compare by position, so zooming to the range in use loses nothing.
 */
function domainOf(intervals: readonly Interval[], axis: CompareAxis): [number, number] {
  const low = Math.min(...intervals.map(interval => interval.low))
  const high = Math.max(...intervals.map(interval => interval.high))
  const pad = (high - low) * 0.08 || Math.abs(high) * 0.1 || 0.05
  const domain: [number, number] = [low - pad, high + pad]
  if (axis.kind === 'score')
    return [Math.max(0, domain[0]), Math.min(1, domain[1])]
  // Durations and costs cannot go below 0.
  return [axis.kind === 'duration' || low >= 0 ? Math.max(0, domain[0]) : domain[0], domain[1]]
}

/**
 * Domain of a log axis: the smallest mean halved to the largest interval end with room. An interval end at or below 0
 * (a wide interval of a small mean) has no place on a log scale, so its whisker is cut at the lower edge.
 */
function logDomainOf(intervals: readonly Interval[], axis: CompareAxis): [number, number] {
  const low = Math.min(...intervals.map(interval => interval.mean).filter(value => value > 0)) / 2
  const high = Math.max(...intervals.map(interval => interval.high)) * 1.25
  // A score ends at 100%; past that the axis would show values no case can have.
  return axis.kind === 'score' ? [low, Math.max(Math.min(1, high), low * 1.5)] : [low, Math.max(high, low * 10)]
}

/** Length of the zoom when the plane's domain changes; long enough to follow, short enough not to wait on. */
const ZOOM_MS = 450

/** Ticks of an axis; a log axis keeps the 1, 2, and 5 of each power of ten, so its labels do not crowd. */
function ticksOf(scale: { ticks: (count?: number) => number[] }, kind: ScaleKind, count: number): number[] {
  const ticks = scale.ticks(count)
  if (kind === 'linear')
    return ticks
  return ticks.filter(tick => [1, 2, 5].includes(Math.round(tick / 10 ** Math.floor(Math.log10(tick)))))
}

/**
 * The domain an axis shows, eased toward its target when the columns change (one hidden or shown again, another axis
 * picked), so the plane zooms instead of jumping and the eye can follow every dot to its new place. A log domain eases
 * in log space; a change between linear and log, or a reader who asks for reduced motion, jumps at once, since easing
 * between the two kinds would pass through domains neither has.
 */
function useDomainTween(target: Ref<{ domain: [number, number], kind: ScaleKind }>): Ref<[number, number]> {
  const shown = shallowRef<[number, number]>(target.value.domain)
  const reduced = usePreferredReducedMotion()
  let frame = 0
  watch(target, (next, previous) => {
    cancelAnimationFrame(frame)
    if (previous == null || next.kind !== previous.kind || reduced.value === 'reduce') {
      shown.value = next.domain
      return
    }
    const into = (value: number) => (next.kind === 'log' ? Math.log10(value) : value)
    const out = (value: number) => (next.kind === 'log' ? 10 ** value : value)
    const from = shown.value.map(into)
    const to = next.domain.map(into)
    const start = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / ZOOM_MS)
      // easeOutCubic: quick at first, settling gently on the new domain.
      const eased = 1 - (1 - progress) ** 3
      shown.value = [out(from[0]! + (to[0]! - from[0]!) * eased), out(from[1]! + (to[1]! - from[1]!) * eased)]
      if (progress < 1)
        frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  })
  onBeforeUnmount(() => cancelAnimationFrame(frame))
  return shown
}

// NOTICE: one x tick per ~90 px keeps tick labels such as "1.5K ms" apart on phones.
const xTicks = computed(() => Math.max(2, Math.min(6, Math.floor((width.value - margin.left - margin.right) / 90))))
const xKind = computed<ScaleKind>(() => props.xScaleKind ?? 'linear')
const yKind = computed<ScaleKind>(() => props.yScaleKind ?? 'linear')
/** Domain each axis settles on: the nice linear domain, or the log domain. */
const xTarget = computed(() => {
  const intervals = props.points.map(point => point.x)
  return { domain: xKind.value === 'log' ? logDomainOf(intervals, props.x) : scaleLinear(domainOf(intervals, props.x), [0, 1]).nice(xTicks.value).domain() as [number, number], kind: xKind.value }
})
const yTarget = computed(() => {
  const intervals = props.points.map(point => point.y)
  return { domain: yKind.value === 'log' ? logDomainOf(intervals, props.y) : scaleLinear(domainOf(intervals, props.y), [0, 1]).nice(5).domain() as [number, number], kind: yKind.value }
})
const xDomain = useDomainTween(xTarget)
const yDomain = useDomainTween(yTarget)
const xScale = computed(() => {
  const range: [number, number] = [margin.left, width.value - margin.right]
  return xKind.value === 'log' ? scaleLog(xDomain.value, range).clamp(true) : scaleLinear(xDomain.value, range)
})
const yScale = computed(() => {
  const range: [number, number] = [height.value - margin.bottom, margin.top]
  return yKind.value === 'log' ? scaleLog(yDomain.value, range).clamp(true) : scaleLinear(yDomain.value, range)
})
const xTickValues = computed(() => ticksOf(xScale.value, xKind.value, xTicks.value))
const yTickValues = computed(() => ticksOf(yScale.value, yKind.value, 5))

const frontSet = computed(() => new Set(props.front))
const frontPath = computed(() => props.front
  .map(id => props.points.find(point => point.id === id))
  .filter(point => point != null)
  .map((point, index) => `${index === 0 ? 'M' : 'L'}${xScale.value(point.x.mean)},${yScale.value(point.y.mean)}`)
  .join(''))

interface Box { x0: number, x1: number, y0: number, y1: number }
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/**
 * Dots with their labels. Each label takes the first spot around its dot (right, left, above, below) that stays inside
 * the plot and covers no dot and no label placed before it; the baseline and the front are placed first. A label with
 * no free spot is hidden until its dot is hovered or pinned, where it is drawn on top with a halo.
 */
const marks = computed(() => {
  const dots = props.points.map(point => ({ ...point, cx: xScale.value(point.x.mean), cy: yScale.value(point.y.mean) }))
  const dotBoxes = dots.map(dot => ({ box: { x0: dot.cx - 7, x1: dot.cx + 7, y0: dot.cy - 7, y1: dot.cy + 7 }, id: dot.id }))
  const placed: Box[] = []
  const priority = (id: string) => (id === props.baseline ? 0 : frontSet.value.has(id) ? 1 : 2)
  const spots = new Map<string, undefined | { anchor: 'end' | 'start', x: number, y: number }>()
  for (const dot of dots.toSorted((left, right) => priority(left.id) - priority(right.id) || left.cy - right.cy)) {
    // NOTICE: 6.2 px per character approximates 11 px labels in the viewer font; the baseline tag adds ~52 px.
    const w = dot.label.length * 6.2 + (dot.id === props.baseline ? 52 : 0)
    const candidates = [
      { anchor: 'start' as const, x: dot.cx + 10, y: dot.cy + 4 },
      { anchor: 'end' as const, x: dot.cx - 10, y: dot.cy + 4 },
      { anchor: 'start' as const, x: dot.cx + 4, y: dot.cy - 10 },
      { anchor: 'start' as const, x: dot.cx + 4, y: dot.cy + 18 },
      { anchor: 'end' as const, x: dot.cx - 4, y: dot.cy - 10 },
      { anchor: 'end' as const, x: dot.cx - 4, y: dot.cy + 18 },
    ]
    const spot = candidates.find((candidate) => {
      const box = { x0: candidate.anchor === 'start' ? candidate.x : candidate.x - w, x1: candidate.anchor === 'start' ? candidate.x + w : candidate.x, y0: candidate.y - 10, y1: candidate.y + 3 }
      const fits = box.x0 >= margin.left && box.x1 <= width.value - margin.right && box.y0 >= margin.top - 6 && box.y1 <= height.value - margin.bottom
        && !placed.some(other => overlaps(box, other)) && !dotBoxes.some(other => other.id !== dot.id && overlaps(box, other.box))
      if (fits)
        placed.push(box)
      return fits
    })
    spots.set(dot.id, spot)
  }
  return dots.map(dot => ({ ...dot, spot: spots.get(dot.id) }))
})

/** Corner both axes point to as better, marked with an arrow so the reader knows which way to look. */
const betterCorner = computed(() => {
  if (props.x.better == null || props.y.better == null)
    return undefined
  const right = props.x.better === 'higher'
  const top = props.y.better === 'higher'
  return {
    anchor: right ? 'end' : 'start',
    arrow: `${top ? '↑' : '↓'}${right ? '→' : '←'}`,
    x: right ? width.value - margin.right - 4 : margin.left + 4,
    y: top ? margin.top + 10 : height.value - margin.bottom - 6,
  }
})
const colorOf = (id: string) => (id === props.baseline ? 'var(--chart-text)' : 'var(--series-1)')

// The dot under the pointer previews its card; a click pins it (a second click, Esc, or the close button lets it go).
// Same split as the case charts (`CaseMetricsPanel.vue`): a floating card on desktop, a bottom drawer on phones.
const isDesktop = useMediaQuery('(min-width: 768px)')
const hovered = shallowRef<string>()
const pinned = shallowRef<string>()
function pin(id: string): void {
  pinned.value = pinned.value === id ? undefined : id
  hovered.value = undefined
}
// A pinned column that left the plane (other runs picked) has no dot to point at.
watch(() => props.points, (points) => {
  if (pinned.value != null && !points.some(point => point.id === pinned.value))
    pinned.value = undefined
})
const focusId = computed(() => (hovered.value != null && hovered.value !== pinned.value ? hovered.value : pinned.value))
const focused = computed(() => marks.value.find(mark => mark.id === focusId.value))
// The card stays filled while its popover plays the closing animation (reka keeps the content mounted until then).
const shown = shallowRef<{ mark: NonNullable<typeof focused.value>, pinned: boolean }>()
watch(focused, (mark) => {
  if (mark != null)
    shown.value = { mark, pinned: mark.id === pinned.value }
})
/** Floating UI positions the card against the dot, read from the drawn SVG so any scroll container works. */
const anchor = computed(() => {
  const mark = shown.value?.mark
  if (mark == null)
    return undefined
  // NOTICE: the card opens beside the box of the column's whole interval and its value labels (the x ends with half a
  // label, the y ends' labels right of the dot at about 64 px), not beside the dot, so it covers none of the numbers it
  // repeats. Floating UI flips it to the other side of the box when there is no room.
  const box = {
    x0: Math.min(xScale.value(mark.x.low) - 32, mark.cx - 14),
    x1: Math.max(xScale.value(mark.x.high) + 32, mark.cx + 72),
    y0: Math.min(yScale.value(mark.y.high) - 12, mark.cy - 14),
    y1: Math.max(yScale.value(mark.y.low) + 12, mark.cy + 30),
  }
  return {
    getBoundingClientRect: () => {
      const rect = svg.value?.getBoundingClientRect()
      const k = rect == null ? 1 : rect.width / width.value
      return new DOMRect((rect?.left ?? 0) + box.x0 * k, (rect?.top ?? 0) + box.y0 * k, (box.x1 - box.x0) * k, (box.y1 - box.y0) * k)
    },
  }
})
function hide(id: string): void {
  emit('hide', id)
  pinned.value = undefined
  hovered.value = undefined
}
function makeBaseline(id: string): void {
  emit('baseline', id)
  pinned.value = undefined
}
function readingsOf(point: PlanePoint): PointAxisReading[] {
  return [
    { axis: props.y, delta: point.delta.y, formatDelta: props.formatDeltaY, formatValue: props.formatY, value: point.y },
    ...(props.x.name === props.y.name ? [] : [{ axis: props.x, delta: point.delta.x, formatDelta: props.formatDeltaX, formatValue: props.formatX, value: point.x }]),
  ]
}
const pinnedPoint = computed(() => props.points.find(point => point.id === pinned.value))

/** The pointer inside the plot, in SVG coordinates; the SVG is drawn at its own pixel size, so only a zoom scales it. */
const pointer = shallowRef<{ x: number, y: number }>()
function track(event: MouseEvent): void {
  const rect = svg.value?.getBoundingClientRect()
  if (rect == null || rect.width === 0)
    return
  const k = width.value / rect.width
  const x = (event.clientX - rect.left) * k
  const y = (event.clientY - rect.top) * k
  const inside = x >= margin.left && x <= width.value - margin.right && y >= margin.top && y <= height.value - margin.bottom
  pointer.value = inside ? { x, y } : undefined
}
/**
 * Where the crosshair reads the axes: the focused dot (hovered or pinned) snaps it to the column's means, else it
 * follows the pointer and reads the values under it.
 */
const crosshair = computed(() => {
  const mark = focused.value
  if (mark != null)
    return { x: mark.cx, xValue: mark.x.mean, y: mark.cy, yValue: mark.y.mean }
  const at = pointer.value
  return at == null ? undefined : { x: at.x, xValue: xScale.value.invert(at.x), y: at.y, yValue: yScale.value.invert(at.y) }
})
/**
 * Values at the ends of the focused dot's whiskers (the 95% interval on each axis), next to the ends they name. An end
 * closer than 22 px to the dot would sit on it, so it is left out; the card has every number.
 */
const whiskerLabels = computed(() => {
  const mark = focused.value
  if (mark == null)
    return []
  const ends = [
    { key: 'x-low', left: xScale.value(mark.x.low), text: props.formatX(mark.x.low), top: mark.cy + 8, transform: 'translate(-50%, 0)' },
    { key: 'x-high', left: xScale.value(mark.x.high), text: props.formatX(mark.x.high), top: mark.cy + 8, transform: 'translate(-50%, 0)' },
    { key: 'y-low', left: mark.cx + 8, text: props.formatY(mark.y.low), top: yScale.value(mark.y.low), transform: 'translate(0, -50%)' },
    { key: 'y-high', left: mark.cx + 8, text: props.formatY(mark.y.high), top: yScale.value(mark.y.high), transform: 'translate(0, -50%)' },
  ]
  return ends.filter(end => Math.hypot(end.left - mark.cx, end.top - mark.cy) > 22)
})
/** Value pill: its own backdrop keeps it readable over lines and dots, as the interval chart's hover values have. */
const pill = 'absolute rounded px-1 text-xs tabular-nums whitespace-nowrap pointer-events-none bg-neutral-100 dark:bg-neutral-800'
</script>

<template>
  <figure ref="root" :class="['relative w-full']" data-testid="compare-plane">
    <svg ref="svg" :viewBox="`0 0 ${width} ${height}`" :class="['w-full h-auto select-none']" role="img" :aria-label="t('compare.chart.planeAria', { x: props.x.label, y: props.y.label })" @mouseleave="hovered = undefined; pointer = undefined" @mousemove="track">
      <g>
        <line v-for="tick in xTickValues" :key="`x${tick}`" :x1="xScale(tick)" :x2="xScale(tick)" :y1="margin.top" :y2="height - margin.bottom" stroke="var(--chart-grid)" stroke-width="1" />
        <line v-for="tick in yTickValues" :key="`y${tick}`" :x1="margin.left" :x2="width - margin.right" :y1="yScale(tick)" :y2="yScale(tick)" stroke="var(--chart-grid)" stroke-width="1" />
        <text v-for="tick in xTickValues" :key="`xt${tick}`" :x="xScale(tick)" :y="height - margin.bottom + 14" font-size="10" text-anchor="middle" fill="var(--chart-text)">{{ props.formatX(tick) }}</text>
        <text v-for="tick in yTickValues" :key="`yt${tick}`" :x="margin.left - 6" :y="yScale(tick) + 3" font-size="10" text-anchor="end" fill="var(--chart-text)">{{ props.formatY(tick) }}</text>
        <text :x="width - margin.right" :y="height - 4" font-size="11" text-anchor="end" fill="var(--chart-text)" font-weight="600">{{ props.x.label }} →</text>
        <text :x="margin.left - 6" :y="12" font-size="11" text-anchor="start" fill="var(--chart-text)" font-weight="600">↑ {{ props.y.label }}</text>
        <text v-if="betterCorner" :x="betterCorner.x" :y="betterCorner.y" font-size="10" :text-anchor="betterCorner.anchor" fill="var(--chart-text)" opacity="0.7">{{ t('compare.chart.better', { arrow: betterCorner.arrow }) }}</text>
      </g>

      <path v-if="props.front.length > 1" :d="frontPath" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-dasharray="4 4" opacity="0.55" pointer-events="none" />

      <!-- Whiskers first, so every dot and label is drawn over every whisker. -->
      <g v-for="mark in marks" :key="`w${mark.id}`" :stroke="colorOf(mark.id)" stroke-width="1.5" pointer-events="none" :opacity="focusId == null || focusId === mark.id ? 0.35 : 0.1" :class="['transition-opacity']">
        <line :x1="xScale(mark.x.low)" :x2="xScale(mark.x.high)" :y1="mark.cy" :y2="mark.cy" />
        <line :x1="xScale(mark.x.low)" :x2="xScale(mark.x.low)" :y1="mark.cy - 3" :y2="mark.cy + 3" />
        <line :x1="xScale(mark.x.high)" :x2="xScale(mark.x.high)" :y1="mark.cy - 3" :y2="mark.cy + 3" />
        <line :x1="mark.cx" :x2="mark.cx" :y1="yScale(mark.y.low)" :y2="yScale(mark.y.high)" />
        <line :x1="mark.cx - 3" :x2="mark.cx + 3" :y1="yScale(mark.y.low)" :y2="yScale(mark.y.low)" />
        <line :x1="mark.cx - 3" :x2="mark.cx + 3" :y1="yScale(mark.y.high)" :y2="yScale(mark.y.high)" />
      </g>

      <g v-for="mark in marks" :key="mark.id" :opacity="focusId == null || focusId === mark.id ? 1 : 0.35" :class="['transition-opacity cursor-pointer']" @mouseenter="isDesktop && (hovered = mark.id)" @mouseleave="hovered = undefined" @click="pin(mark.id)">
        <circle v-if="mark.id === pinned" :cx="mark.cx" :cy="mark.cy" r="10" fill="none" :stroke="colorOf(mark.id)" stroke-width="2" opacity="0.5" />
        <!-- Front and baseline dots are filled, beaten ones hollow (filled with the card surface). -->
        <circle
          :cx="mark.cx" :cy="mark.cy" r="5.5"
          :fill="frontSet.has(mark.id) || mark.id === props.baseline ? colorOf(mark.id) : 'var(--chart-surface)'"
          :stroke="colorOf(mark.id)" stroke-width="2"
        />
        <circle :cx="mark.cx" :cy="mark.cy" r="14" fill="transparent" />
        <!-- A halo of the card surface keeps the label readable over whiskers and grid lines. -->
        <text
          v-if="mark.spot"
          :x="mark.spot.x" :y="mark.spot.y" :text-anchor="mark.spot.anchor" font-size="11" fill="var(--chart-text)"
          :font-weight="frontSet.has(mark.id) ? 600 : 400" pointer-events="none"
          stroke="var(--chart-surface)" stroke-width="3" paint-order="stroke" stroke-linejoin="round"
        >{{ mark.label }}<tspan v-if="mark.id === props.baseline" font-size="10" opacity="0.7"> · {{ t('compare.chart.baselineTag') }}</tspan></text>
      </g>
      <!-- A label with no free spot shows over everything while its dot is focused. -->
      <text
        v-if="focused && !focused.spot"
        :x="focused.cx + 10" :y="focused.cy + 4" font-size="11" font-weight="600" fill="var(--chart-text)" pointer-events="none"
        stroke="var(--chart-surface)" stroke-width="3" paint-order="stroke" stroke-linejoin="round"
      >{{ focused.label }}</text>
      <!-- Crosshair: dashed guides from the read point down to the x axis and across to the y axis. -->
      <g v-if="crosshair" stroke="var(--chart-text)" stroke-width="1" stroke-dasharray="3 3" opacity="0.6" pointer-events="none" data-testid="compare-plane-crosshair">
        <line :x1="crosshair.x" :x2="crosshair.x" :y1="crosshair.y" :y2="height - margin.bottom" />
        <line :x1="margin.left" :x2="crosshair.x" :y1="crosshair.y" :y2="crosshair.y" />
      </g>
    </svg>
    <!-- The crosshair's values on the axes, over the tick labels they replace while it is shown. -->
    <template v-if="crosshair">
      <span :class="[pill, 'font-semibold']" :style="{ left: `${(crosshair.x / width) * 100}%`, top: `${height - margin.bottom + 3}px`, transform: 'translateX(-50%)' }" data-testid="compare-plane-x-value">{{ props.formatX(crosshair.xValue) }}</span>
      <span :class="[pill, 'font-semibold']" :style="{ left: `${margin.left - 4}px`, top: `${crosshair.y}px`, transform: 'translate(-100%, -50%)' }" data-testid="compare-plane-y-value">{{ props.formatY(crosshair.yValue) }}</span>
    </template>
    <span v-for="end in whiskerLabels" :key="end.key" :class="[pill, 'muted']" :style="{ left: `${(end.left / width) * 100}%`, top: `${end.top}px`, transform: end.transform }" data-testid="compare-plane-whisker-value">{{ end.text }}</span>

    <PopoverRoot v-if="isDesktop" :open="focused != null">
      <PopoverAnchor :reference="anchor" />
      <PopoverPortal>
        <PopoverContent
          as-child side="right" align="start" :side-offset="14" :collision-padding="12"
          :class="['floating p-3', shown?.pinned !== true && 'pointer-events-none']"
          @open-auto-focus.prevent @close-auto-focus.prevent @interact-outside.prevent @escape-key-down="pinned = undefined"
        >
          <AnimatedContent>
            <div v-if="shown" :class="['w-72 max-w-[calc(100vw-2rem)]']">
              <ComparePointCard
                :label="shown.mark.label" :href="shown.mark.href" :pinned="shown.pinned" :is-baseline="shown.mark.id === props.baseline"
                :baseline-label="props.baselineLabel" :readings="readingsOf(shown.mark)"
                @unpin="pinned = undefined" @baseline="makeBaseline(shown.mark.id)" @hide="hide(shown.mark.id)"
              />
            </div>
            <PopoverArrow :class="['floating-arrow']" />
          </AnimatedContent>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
    <!-- Phones: a tapped dot opens the same card in a bottom drawer; dismissing the drawer unpins the column. -->
    <DrawerRoot v-else :open="pinnedPoint != null" @update:open="open => { if (!open) pinned = undefined }">
      <DrawerPortal>
        <DrawerOverlay :class="['fixed inset-0 z-50 bg-black/40']" />
        <DrawerContent :class="['floating fixed inset-x-0 bottom-0 max-h-[85dvh] flex flex-col gap-3 rounded-b-none! rounded-t-2xl! border-b-0! px-4 pt-3 pb-6 outline-none']">
          <DrawerHandle :class="['bg-neutral-300! dark:bg-neutral-600!']" />
          <DrawerTitle :class="['sr-only']">
            {{ pinnedPoint?.label }}
          </DrawerTitle>
          <DrawerDescription :class="['sr-only']">
            {{ t('compare.chart.card.description') }}
          </DrawerDescription>
          <div v-if="pinnedPoint" :class="['overflow-y-auto min-h-0']">
            <ComparePointCard
              :label="pinnedPoint.label" :href="pinnedPoint.href" pinned :is-baseline="pinnedPoint.id === props.baseline"
              :baseline-label="props.baselineLabel" :readings="readingsOf(pinnedPoint)"
              @unpin="pinned = undefined" @baseline="makeBaseline(pinnedPoint.id)" @hide="hide(pinnedPoint.id)"
            />
          </div>
        </DrawerContent>
      </DrawerPortal>
    </DrawerRoot>
  </figure>
</template>
