<script setup lang="ts">
import { computed } from 'vue'

/**
 * Coverage of one point of the line (see `cellCoverageSchema`): `full` points are joined by the line; a `partial` or
 * `other` point (a score over other cases) is a dashed ring off the line, and a point `none` (no result) is an amber
 * ring on the floor.
 */
export type SparklineCoverage = 'full' | 'none' | 'other' | 'partial'

/**
 * Tiny line of scores (0–1) in run order, for cards and matrix cells: the trend, not the exact values.
 *
 * Missing scores (`null`) break the line. Fewer than two scores draw nothing. With `coverage`, only fully covered
 * points are joined, so a partial re-run, a run over other cases, or a run without a result never bends the trend; they are drawn as rings.
 */
const props = withDefaults(defineProps<{
  /** Coverage of each value, in the same order; every value counts as `full` without it. */
  coverage?: readonly SparklineCoverage[]
  height?: number
  /** Accessible summary, for example "Pass of 10 runs" (the label of the primary score). */
  label: string
  /** Tooltip of each point (for example its time and score), in the same order as `values`. */
  titles?: readonly string[]
  values: readonly (null | number)[]
  width?: number
}>(), { height: 20, width: 72 })

const coverageAt = (index: number): SparklineCoverage => props.coverage?.[index] ?? 'full'
const yOf = (value: number) => 1 + (1 - Math.min(1, Math.max(0, value))) * (props.height - 2)

const segments = computed(() => {
  const { values, width } = props
  if (values.length < 2)
    return []
  const step = width / (values.length - 1)
  const parts: string[] = []
  let current = ''
  values.forEach((value, index) => {
    // A run that measured only some cases, or none, is not a point of the trend: it neither joins nor breaks the line.
    if (coverageAt(index) !== 'full')
      return
    if (value == null || !Number.isFinite(value)) {
      if (current !== '')
        parts.push(current)
      current = ''
      return
    }
    // 1 px margin so a 0 % or 100 % score is not cut by the stroke.
    current += `${current === '' ? 'M' : 'L'}${(index * step).toFixed(1)},${yOf(value).toFixed(1)}`
  })
  if (current !== '')
    parts.push(current)
  return parts
})
interface Mark { kind: 'full' | 'last' | 'none' | 'partial', title?: string, x: number, y: number }
/** Rings of the points that are not part of the line, and the dot of the newest full point. */
const marks = computed<Mark[]>(() => {
  const { values, width } = props
  if (values.length < 2)
    return []
  const step = width / (values.length - 1)
  const lastFull = values.findLastIndex((value, index) => coverageAt(index) === 'full' && value != null && Number.isFinite(value))
  return values.flatMap((value, index): Mark[] => {
    const coverage = coverageAt(index)
    const title = props.titles?.[index]
    const x = index * step
    if (coverage === 'none')
      return [{ kind: 'none', title, x, y: props.height - 1 }]
    if (value == null || !Number.isFinite(value))
      return []
    if (coverage === 'partial' || coverage === 'other')
      return [{ kind: 'partial', title, x, y: yOf(value) }]
    return index === lastFull || title != null ? [{ kind: index === lastFull ? 'last' : 'full', title, x, y: yOf(value) }] : []
  })
})
const visible = computed(() => segments.value.length > 0 || marks.value.some(mark => mark.kind !== 'full'))
</script>

<template>
  <svg v-if="visible" :width="props.width" :height="props.height" :viewBox="`-3 -3 ${props.width + 6} ${props.height + 6}`" role="img" :aria-label="props.label" :class="['shrink-0 overflow-visible']">
    <path v-for="(segment, index) in segments" :key="index" :d="segment" fill="none" stroke="var(--series-1)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
    <g v-for="(mark, index) in marks" :key="index">
      <circle v-if="mark.kind === 'none'" :cx="mark.x" :cy="mark.y" r="2.25" fill="none" stroke="var(--mark-errored)" stroke-width="1.25" data-testid="sparkline-none" />
      <circle v-else-if="mark.kind === 'partial'" :cx="mark.x" :cy="mark.y" r="2.25" fill="none" stroke="var(--series-1)" stroke-width="1.25" stroke-dasharray="1.5 1.2" data-testid="sparkline-partial" />
      <circle v-else :cx="mark.x" :cy="mark.y" :r="mark.kind === 'last' ? 2 : 1.25" fill="var(--series-1)" />
      <!-- A wider transparent target, so a 2 px point can be hovered for its tooltip. -->
      <circle v-if="mark.title" :cx="mark.x" :cy="mark.y" r="5" fill="transparent"><title>{{ mark.title }}</title></circle>
    </g>
  </svg>
</template>
