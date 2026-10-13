<script setup lang="ts">
import { animate, createTimeline, stagger, svg } from 'animejs'
import { ref } from 'vue'

import { useSceneAnimation } from '../useSceneAnimation'

/** Tasks shown in the mock viewer, with their final share of finished cases. */
const tasks = [
  { name: 'routing', progress: 1 },
  { name: 'memory', progress: 0.72 },
  { name: 'tool-use', progress: 0.9 },
  { name: 'vision', progress: 0.46 },
]

const BAR_X = 92
const BAR_WIDTH = 120
const GRID_COLUMNS = 10
const GRID_ROWS = 5
/** Case cells that end up failed in the still frame. */
const FAILED_CELLS = new Set([7, 23, 38])

/** Event names streamed by `events.jsonl`, repeated to fill the ticker. */
const events = ['run:start', 'task:start', 'case:start', 'attempt:end', 'case:end ✓', 'score 0.91', 'case:end ✗', 'task:end']

/** Score history for the sparkline, in 0..1. */
const scores = [0.42, 0.51, 0.48, 0.63, 0.6, 0.71, 0.69, 0.78, 0.83, 0.87]
const sparkline = scores
  .map((score, index) => `${index === 0 ? 'M' : 'L'}${(244 + index * 14).toFixed(1)} ${(206 - score * 44).toFixed(1)}`)
  .join('')

// NOTICE: Counters are written to the DOM directly instead of through a Vue ref. A reactive update re-renders
// the template, and Vue re-applies every bound inline style on patch, which resets transforms anime.js is
// animating and makes the scene flicker.
const scoreText = ref<SVGTextElement>()
const root = ref<SVGSVGElement>()

useSceneAnimation(root, () => {
  const live = animate('.monitor-live', { duration: 1400, ease: 'inOutSine', loop: true, opacity: [1, 0.25, 1] })
  const ticker = animate('.monitor-ticker', { duration: events.length * 900, ease: 'linear', loop: true, translateY: [0, -events.length * 14] })

  const reading = { value: 0 }
  const timeline = createTimeline({
    defaults: { ease: 'outQuad' },
    loop: true,
    loopDelay: 1600,
    onUpdate: () => {
      if (scoreText.value)
        scoreText.value.textContent = reading.value.toFixed(2)
    },
  })
    .set('.monitor-bar', { width: 0 })
    .set('.monitor-cell', { opacity: 0.08 })
    .set(reading, { value: 0 })
    .add('.monitor-bar', { delay: stagger(180), duration: 3200, ease: 'inOutSine', width: (_: unknown, index = 0) => tasks[index].progress * BAR_WIDTH }, 0)
    .add('.monitor-cell', { delay: stagger(60, { from: 'random' }), duration: 160, opacity: 1 }, 0)
    .add(svg.createDrawable('.monitor-spark'), { draw: ['0 0', '0 1'], duration: 3000, ease: 'inOutSine' }, 0)
    .add(reading, { duration: 3000, ease: 'inOutSine', value: scores.at(-1)! }, 0)
    .add('.monitor-fade', { duration: 800, opacity: [1, 0.2, 1] }, '+=1800')

  return [live, ticker, timeline]
})
</script>

<template>
  <svg ref="root" viewBox="0 0 400 240" :class="['w-full h-auto', 'font-mono']" aria-hidden="true">
    <defs>
      <clipPath id="monitor-ticker-clip">
        <rect x="244" y="52" width="140" height="70" />
      </clipPath>
      <linearGradient id="monitor-spark-fill" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#6ee7b7" stop-opacity="0.25" />
        <stop offset="1" stop-color="#6ee7b7" stop-opacity="0" />
      </linearGradient>
    </defs>

    <rect x="8" y="10" width="384" height="220" rx="10" class="fill-zinc-950/60 stroke-white/10" />
    <line x1="8" y1="34" x2="392" y2="34" class="stroke-white/10" />
    <circle v-for="index in 3" :key="index" :cx="10 + index * 10" cy="22" r="3" class="fill-white/15" />
    <text x="52" y="25" font-size="9" class="fill-white/50">localhost:51204</text>
    <circle cx="350" cy="22" r="3.5" :class="['monitor-live', 'fill-emerald-400']" />
    <text x="358" y="25" font-size="9" class="fill-emerald-300">live</text>

    <g class="monitor-fade">
      <g v-for="(task, index) in tasks" :key="task.name">
        <text x="24" :y="62 + index * 22" font-size="9" class="fill-white/60">{{ task.name }}</text>
        <rect :x="BAR_X" :y="54 + index * 22" :width="BAR_WIDTH" height="8" rx="4" class="fill-white/5" />
        <rect :x="BAR_X" :y="54 + index * 22" :width="task.progress * BAR_WIDTH" height="8" rx="4" :class="['monitor-bar', index === 3 ? 'fill-amber-300' : 'fill-emerald-300/80']" />
      </g>

      <text x="24" y="160" font-size="9" class="fill-white/40">cases</text>
      <rect
        v-for="cell in GRID_COLUMNS * GRID_ROWS"
        :key="cell"
        :x="64 + ((cell - 1) % GRID_COLUMNS) * 15"
        :y="150 + Math.floor((cell - 1) / GRID_COLUMNS) * 14"
        width="11"
        height="10"
        rx="2"
        :class="['monitor-cell', FAILED_CELLS.has(cell) ? 'fill-orange-400' : 'fill-emerald-300/70']"
      />

      <text x="244" y="146" font-size="9" class="fill-white/40">score</text>
      <text ref="scoreText" x="384" y="152" font-size="18" text-anchor="end" class="fill-white">{{ scores.at(-1)!.toFixed(2) }}</text>
      <path :d="`${sparkline}L370 214L244 214Z`" fill="url(#monitor-spark-fill)" />
      <path :d="sparkline" fill="none" stroke-width="1.75" stroke-linejoin="round" :class="['monitor-spark', 'stroke-emerald-300']" />
    </g>

    <text x="244" y="46" font-size="9" class="fill-white/40">events.jsonl</text>
    <g clip-path="url(#monitor-ticker-clip)">
      <g class="monitor-ticker">
        <text
          v-for="(event, index) in [...events, ...events]"
          :key="index"
          x="244"
          :y="64 + index * 14"
          font-size="9"
          :class="event.includes('✗') ? 'fill-orange-300' : event.includes('✓') ? 'fill-emerald-300' : 'fill-white/50'"
        >
          {{ event }}
        </text>
      </g>
    </g>
  </svg>
</template>
