<script setup lang="ts">
import { createTimeline, stagger } from 'animejs'
import { ref } from 'vue'

import { useSceneAnimation } from '../useSceneAnimation'

/** Illustrative per-domain scores (0..100), as `vieval report compare --group-by domain` would group them. */
const rows = [
  { baseline: 74.1, candidate: 80.2, label: 'browser' },
  { baseline: 58.6, candidate: 61.0, label: 'office' },
  { baseline: 66.3, candidate: 64.5, label: 'image editing' },
  { baseline: 49.8, candidate: 59.1, label: 'coding' },
  { baseline: 81.2, candidate: 81.9, label: 'chat' },
]

const BAR_X = 128
const BAR_WIDTH = 330
const ROW_Y = 86
const ROW_HEIGHT = 38

const overall = {
  baseline: rows.reduce((sum, row) => sum + row.baseline, 0) / rows.length,
  candidate: rows.reduce((sum, row) => sum + row.candidate, 0) / rows.length,
}

const delta = (row: { baseline: number, candidate: number }) => row.candidate - row.baseline
const signed = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`

// NOTICE: Counters are written to the DOM directly instead of through a Vue ref. A reactive update re-renders
// the template, and Vue re-applies every bound inline style on patch, which resets transforms anime.js is
// animating and makes the scene flicker.
const overallText = ref<SVGTextElement>()
const root = ref<SVGSVGElement>()

useSceneAnimation(root, () => {
  const reading = { value: overall.baseline }

  const timeline = createTimeline({
    defaults: { ease: 'outCubic' },
    loop: true,
    loopDelay: 1000,
    onUpdate: () => {
      if (overallText.value)
        overallText.value.textContent = reading.value.toFixed(1)
    },
  })
    .set('.compare-baseline', { width: 0 })
    .set('.compare-candidate', { width: 0 })
    .set('.compare-delta', { opacity: 0, translateX: -6 })
    .set(reading, { value: overall.baseline })
    .add('.compare-baseline', { delay: stagger(90), duration: 700, width: (_: unknown, index = 0) => rows[index].baseline / 100 * BAR_WIDTH }, 200)
    .add('.compare-candidate', { delay: stagger(140), duration: 1100, width: (_: unknown, index = 0) => rows[index].candidate / 100 * BAR_WIDTH }, 1000)
    .add(reading, { duration: 1500, value: overall.candidate }, 1000)
    .add('.compare-delta', { delay: stagger(140), duration: 360, opacity: 1, translateX: 0 }, 1700)
    .add(['.compare-delta'], { duration: 400, opacity: 0 }, '+=2600')

  return [timeline]
})
</script>

<template>
  <svg ref="root" viewBox="0 0 572 300" :class="['w-full h-auto', 'font-mono']" aria-hidden="true">
    <text x="16" y="28" font-size="9.5" class="fill-white/40">$ vieval report compare baseline candidate --group-by domain</text>

    <text x="16" y="62" font-size="9" class="fill-white/40">overall</text>
    <text ref="overallText" x="70" y="64" font-size="20" class="fill-white">{{ overall.candidate.toFixed(1) }}</text>
    <text x="134" y="63" font-size="10" class="fill-white/40">from {{ overall.baseline.toFixed(1) }}</text>
    <text x="210" y="63" font-size="10" class="fill-emerald-300">{{ signed(overall.candidate - overall.baseline) }}</text>

    <g v-for="legend in [{ label: 'baseline', fill: 'fill-white/25', x: 400 }, { label: 'candidate', fill: 'fill-emerald-300/80', x: 470 }]" :key="legend.label">
      <rect :x="legend.x" y="54" width="9" height="9" rx="2" :class="legend.fill" />
      <text :x="legend.x + 13" y="62" font-size="9" class="fill-white/50">{{ legend.label }}</text>
    </g>

    <g v-for="(row, index) in rows" :key="row.label">
      <text x="16" :y="ROW_Y + index * ROW_HEIGHT + 14" font-size="9.5" class="fill-white/65">{{ row.label }}</text>
      <rect :x="BAR_X" :y="ROW_Y + index * ROW_HEIGHT" :width="BAR_WIDTH" height="20" rx="3" class="fill-white/3" />
      <rect :x="BAR_X" :y="ROW_Y + index * ROW_HEIGHT" :width="row.baseline / 100 * BAR_WIDTH" height="8" rx="2" :class="['compare-baseline', 'fill-white/25']" />
      <rect :x="BAR_X" :y="ROW_Y + index * ROW_HEIGHT + 11" :width="row.candidate / 100 * BAR_WIDTH" height="9" rx="2" :class="['compare-candidate', delta(row) < 0 ? 'fill-orange-400/85' : 'fill-emerald-300/80']" />
      <g class="compare-delta">
        <rect :x="BAR_X + BAR_WIDTH + 14" :y="ROW_Y + index * ROW_HEIGHT + 2" width="48" height="16" rx="8" :class="delta(row) < 0 ? 'fill-orange-400/20' : 'fill-emerald-300/15'" />
        <text :x="BAR_X + BAR_WIDTH + 38" :y="ROW_Y + index * ROW_HEIGHT + 13.5" font-size="9.5" text-anchor="middle" :class="delta(row) < 0 ? 'fill-orange-300' : 'fill-emerald-300'">{{ signed(delta(row)) }}</text>
      </g>
    </g>

    <text x="16" y="290" font-size="9.5" class="fill-white/35">aligned by case id · added / removed cases reported separately</text>
  </svg>
</template>
