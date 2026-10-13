<script setup lang="ts">
import { createTimeline } from 'animejs'
import { ref } from 'vue'

import { useSceneAnimation } from '../useSceneAnimation'

interface Span {
  depth: number
  /** Start and end on a 0..100 time axis. */
  end: number
  label: string
  start: number
  state: 'failed' | 'passed' | 'running'
}

/** One case of a run as recorded spans: run → task → case → attempts → model, tool, and judge calls. */
const spans: Span[] = [
  { depth: 0, end: 100, label: 'run', start: 0, state: 'running' },
  { depth: 1, end: 97, label: 'task desktop-agent', start: 2, state: 'running' },
  { depth: 2, end: 92, label: 'case gimp/resize', start: 5, state: 'passed' },
  { depth: 3, end: 38, label: 'attempt 1', start: 7, state: 'failed' },
  { depth: 3, end: 90, label: 'attempt 2', start: 42, state: 'passed' },
  { depth: 4, end: 66, label: 'generateText', start: 44, state: 'running' },
  { depth: 4, end: 62, label: 'tool screenshot', start: 52, state: 'running' },
  { depth: 4, end: 86, label: 'judge rubric', start: 68, state: 'passed' },
]

/** Point events emitted along the way, shown as diamonds on the time axis. */
const events = [
  { label: 'retry', row: 3, time: 38 },
  { label: 'score 0.91', row: 7, time: 86 },
  { label: 'artifact', row: 2, time: 90 },
]

const AXIS_X = 164
const AXIS_WIDTH = 392
const ROW_Y = 54
const ROW_HEIGHT = 25
/** Duration of one pass of the time cursor across the axis. */
const PASS = 4200

const toX = (time: number) => AXIS_X + time / 100 * AXIS_WIDTH
const rowY = (row: number) => ROW_Y + row * ROW_HEIGHT

const fills: Record<Span['state'], string> = {
  failed: 'fill-orange-400/80',
  passed: 'fill-emerald-300/70',
  running: 'fill-sky-300/45',
}

const root = ref<HTMLElement>()

useSceneAnimation(root, () => {
  const timeline = createTimeline({ loop: true, loopDelay: 800 })
    .set('.trace-bar', { width: 0 })
    .set('.trace-event', { opacity: 0, scale: 0 })
    .set('.trace-detail', { opacity: 0, translateY: 8 })
    .set('.trace-cursor', { translateX: 0 })
    .add('.trace-cursor', { duration: PASS, ease: 'linear', translateX: AXIS_WIDTH }, 0)

  // Bars grow in real time behind the cursor, so the waterfall reads like a live run.
  spans.forEach((span, index) => {
    timeline.add(`.trace-bar-${index}`, {
      duration: (span.end - span.start) / 100 * PASS,
      ease: 'linear',
      width: (span.end - span.start) / 100 * AXIS_WIDTH,
    }, span.start / 100 * PASS)
  })

  events.forEach((event, index) => {
    timeline.add(`.trace-event-${index}`, { duration: 300, ease: 'outBack', opacity: 1, scale: 1 }, event.time / 100 * PASS)
  })

  timeline
    .add('.trace-detail', { duration: 500, ease: 'outCubic', opacity: 1, translateY: 0 }, PASS + 100)
    .add(['.trace-detail', '.trace-event'], { duration: 400, opacity: 0 }, `+=${2400}`)

  return [timeline]
})
</script>

<template>
  <div ref="root" class="relative">
    <svg viewBox="0 0 572 300" :class="['w-full h-auto', 'font-mono']" aria-hidden="true">
      <circle cx="22" cy="26" r="3.5" class="fill-emerald-400" />
      <text x="32" y="29.5" font-size="9.5" class="fill-emerald-300">live</text>
      <text x="64" y="29.5" font-size="9.5" class="fill-white/40">events.jsonl → viewer · OTLP</text>

      <line v-for="tick in 5" :key="tick" :x1="toX((tick - 1) * 25)" :x2="toX((tick - 1) * 25)" y1="42" :y2="rowY(spans.length)" class="stroke-white/5" />

      <g v-for="(span, index) in spans" :key="span.label">
        <text :x="16 + span.depth * 10" :y="rowY(index) + 13" font-size="9" :class="span.state === 'failed' ? 'fill-orange-300' : 'fill-white/60'">{{ span.label }}</text>
        <rect :x="toX(span.start)" :y="rowY(index) + 4" :width="(span.end - span.start) / 100 * AXIS_WIDTH" height="13" rx="3" :class="['trace-bar', `trace-bar-${index}`, fills[span.state]]" />
      </g>

      <g
        v-for="(event, index) in events"
        :key="event.label"
        :class="['trace-event', `trace-event-${index}`]"
        :style="{ transformBox: 'fill-box', transformOrigin: 'center' }"
      >
        <rect :x="toX(event.time) - 4" :y="rowY(event.row) + 6.5" width="8" height="8" :transform="`rotate(45 ${toX(event.time)} ${rowY(event.row) + 10.5})`" class="fill-amber-200 stroke-zinc-900" />
        <text :x="toX(event.time) + 8" :y="rowY(event.row) + 2" font-size="8.5" class="fill-amber-200/90">{{ event.label }}</text>
      </g>

      <g class="trace-cursor">
        <line :x1="AXIS_X" :x2="AXIS_X" y1="42" :y2="rowY(spans.length)" stroke-dasharray="3 3" class="stroke-amber-300/70" />
      </g>

    </svg>

    <!-- Detail card: what the viewer shows for the selected case. HTML, not SVG, so it can blur the chart behind it. -->
    <div :class="['trace-detail', 'glass-card', 'absolute right-[3%] bottom-[6%] w-[min(17rem,62%)]', 'flex flex-col gap-1.5', 'px-3.5 py-2.5', 'font-mono text-[0.62rem] sm:text-[0.68rem]']">
      <div class="flex gap-3 items-center justify-between">
        <span class="text-white/85">gimp/resize</span>
        <span class="text-emerald-300">score 0.91</span>
      </div>
      <div class="text-white/45">
        2 attempts · 1 retry
      </div>
      <div class="text-amber-200/90 flex gap-3 items-center">
        <span class="flex gap-1 items-center"><span class="i-mingcute:file-line" />transcript</span>
        <span class="flex gap-1 items-center"><span class="i-mingcute:pic-line" />screenshot</span>
      </div>
    </div>
  </div>
</template>
