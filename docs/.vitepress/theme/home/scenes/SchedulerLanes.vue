<script setup lang="ts">
import { animate } from 'animejs'
import { ref } from 'vue'

import { useSceneAnimation } from '../useSceneAnimation'

/** `[start, end, kind]` in pixels within one {@link PERIOD} of a worker lane. */
type Job = readonly [start: number, end: number, kind: JobKind]

type JobKind = 'cache' | 'failed' | 'passed' | 'retry' | 'timeout'

const LANE_X = 48
const NOW_X = 300
const LANE_TOP = 58
const LANE_HEIGHT = 22
const LANE_GAP = 12
/** Width of one repeating schedule; the chart scrolls by exactly this much per loop. */
const PERIOD = 360

/**
 * Hand-written schedules for four workers. Each lane ends 6px before {@link PERIOD} so the
 * repeated copy continues the same rhythm without a visible seam.
 */
const lanes: Job[][] = [
  [[0, 64, 'passed'], [70, 80, 'cache'], [86, 170, 'passed'], [176, 250, 'passed'], [256, 290, 'failed'], [294, 354, 'retry']],
  [[0, 110, 'passed'], [116, 200, 'timeout'], [206, 280, 'passed'], [286, 296, 'cache'], [302, 354, 'passed']],
  [[0, 10, 'cache'], [16, 80, 'passed'], [86, 130, 'passed'], [136, 170, 'failed'], [174, 240, 'retry'], [246, 354, 'passed']],
  [[0, 48, 'passed'], [54, 150, 'passed'], [156, 166, 'cache'], [172, 230, 'passed'], [236, 354, 'passed']],
]

/** SVG `fill` per job outcome; timeouts use the hatch pattern defined in the template. */
const fills: Record<JobKind, string> = {
  cache: '#7dd3fc',
  failed: '#fb923c',
  passed: 'rgba(110, 231, 183, 0.8)',
  retry: 'rgba(110, 231, 183, 0.8)',
  timeout: 'url(#lanes-hatch)',
}

const legend: { kind: JobKind, label: string, x: number }[] = [
  { kind: 'passed', label: 'passed', x: 16 },
  { kind: 'failed', label: 'attempt failed → retry', x: 80 },
  { kind: 'timeout', label: 'timeout', x: 222 },
  { kind: 'cache', label: 'cache hit', x: 286 },
]

const laneY = (lane: number) => LANE_TOP + lane * (LANE_HEIGHT + LANE_GAP)

const root = ref<SVGSVGElement>()

useSceneAnimation(root, () => {
  // One linear scroll drives the whole chart: jobs cross the "now" line and get revealed by the clip,
  // which reads as workers picking up and finishing work.
  const scroll = animate('.lanes-track', { duration: 9000, ease: 'linear', loop: true, translateX: [0, -PERIOD] })
  const pulse = animate('.lanes-now-dot', { duration: 1200, ease: 'inOutSine', loop: true, opacity: [1, 0.4, 1], scale: [1, 1.8, 1] })
  return [scroll, pulse]
})
</script>

<template>
  <svg ref="root" viewBox="0 0 400 240" :class="['w-full h-auto', 'font-mono']" aria-hidden="true">
    <defs>
      <pattern id="lanes-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" class="fill-orange-400/15" />
        <line x1="0" y1="0" x2="0" y2="6" stroke-width="3" class="stroke-orange-400/70" />
      </pattern>
      <clipPath id="lanes-past">
        <rect :x="LANE_X" y="0" :width="NOW_X - LANE_X" height="240" />
      </clipPath>
      <clipPath id="lanes-future">
        <rect :x="NOW_X" y="0" :width="384 - NOW_X" height="240" />
      </clipPath>
      <linearGradient id="lanes-fade" x1="0" x2="1">
        <stop :offset="0" stop-color="#000" />
        <stop :offset="0.18" stop-color="#fff" />
      </linearGradient>
      <mask id="lanes-fade-mask">
        <rect :x="LANE_X" y="0" :width="400 - LANE_X" height="240" fill="url(#lanes-fade)" />
      </mask>
    </defs>

    <text x="16" y="30" font-size="10" class="fill-white/40">
      concurrency <tspan class="fill-amber-200">4</tspan> · retry <tspan class="fill-amber-200">2</tspan> · timeout <tspan class="fill-amber-200">30s</tspan>
    </text>

    <g v-for="(_, lane) in lanes" :key="`label-${lane}`">
      <text x="16" :y="laneY(lane) + 15" font-size="9" class="fill-white/40">w{{ lane + 1 }}</text>
      <rect :x="LANE_X" :y="laneY(lane)" :width="384 - LANE_X" :height="LANE_HEIGHT" rx="4" class="fill-white/3" />
    </g>

    <g mask="url(#lanes-fade-mask)">
      <!-- Planned work ahead of "now": outlines only. -->
      <g clip-path="url(#lanes-future)">
        <g class="lanes-track">
          <template v-for="copy in 2" :key="`future-${copy}`">
            <template v-for="(jobs, lane) in lanes" :key="`future-${copy}-${lane}`">
              <rect
                v-for="([start, end], index) in jobs"
                :key="index"
                :x="LANE_X + (copy - 1) * PERIOD + start"
                :y="laneY(lane) + 3"
                :width="end - start"
                :height="LANE_HEIGHT - 6"
                rx="3"
                fill="none"
                stroke-dasharray="2 3"
                class="stroke-white/20"
              />
            </template>
          </template>
        </g>
      </g>

      <!-- Finished work behind "now": filled by outcome. -->
      <g clip-path="url(#lanes-past)">
        <g class="lanes-track">
          <template v-for="copy in 2" :key="`past-${copy}`">
            <template v-for="(jobs, lane) in lanes" :key="`past-${copy}-${lane}`">
              <g v-for="([start, end, kind], index) in jobs" :key="index">
                <rect
                  :x="LANE_X + (copy - 1) * PERIOD + start"
                  :y="laneY(lane) + 3"
                  :width="end - start"
                  :height="LANE_HEIGHT - 6"
                  rx="3"
                  :fill="fills[kind]"
                />
                <text
                  v-if="kind === 'retry'"
                  :x="LANE_X + (copy - 1) * PERIOD + start + 5"
                  :y="laneY(lane) + 15"
                  font-size="9"
                  class="fill-zinc-900"
                >↻</text>
                <text
                  v-if="kind === 'timeout'"
                  :x="LANE_X + (copy - 1) * PERIOD + end - 5"
                  :y="laneY(lane) + 15"
                  font-size="9"
                  text-anchor="end"
                  class="fill-orange-300"
                >×</text>
              </g>
            </template>
          </template>
        </g>
      </g>
    </g>

    <line :x1="NOW_X" :y1="LANE_TOP - 10" :x2="NOW_X" :y2="laneY(3) + LANE_HEIGHT + 6" stroke-dasharray="3 3" class="stroke-amber-300/80" />
    <circle :cx="NOW_X" :cy="LANE_TOP - 10" r="3" :class="['lanes-now-dot', 'fill-amber-300']" style="transform-box: fill-box; transform-origin: center" />
    <text :x="NOW_X + 6" :y="LANE_TOP - 7" font-size="9" class="fill-amber-200/80">now</text>

    <g v-for="item in legend" :key="item.kind">
      <rect :x="item.x" y="206" width="9" height="9" rx="2" :fill="fills[item.kind]" />
      <text :x="item.x + 13" y="214" font-size="9" class="fill-white/50">{{ item.label }}</text>
    </g>
  </svg>
</template>
