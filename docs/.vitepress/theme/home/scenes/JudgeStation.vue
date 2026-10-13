<script setup lang="ts">
import { createTimeline, stagger, svg } from 'animejs'
import { ref } from 'vue'

import { useSceneAnimation } from '../useSceneAnimation'

/** Checks applied to one agent output, from deterministic to model-judged. */
const checks = [
  { kind: 'expect', label: 'route → search', passed: true },
  { kind: 'expect', label: 'tool calls ≤ 3', passed: true },
  { kind: 'rubric', label: 'grounded', passed: true },
  { kind: 'rubric', label: 'concise', passed: false },
]

const GAUGE_X = 338
const GAUGE_Y = 132
const GAUGE_RADIUS = 38
const SCORE = 0.83

/** Needle angle in degrees for a score in 0..1; -90° points left (0), 90° points right (1). */
const needleAngle = (score: number) => -90 + score * 180

function gaugeArc(to: number) {
  const angle = (needleAngle(to) - 90) * Math.PI / 180
  const x = GAUGE_X + GAUGE_RADIUS * Math.cos(angle)
  const y = GAUGE_Y + GAUGE_RADIUS * Math.sin(angle)
  return `M${GAUGE_X - GAUGE_RADIUS} ${GAUGE_Y}A${GAUGE_RADIUS} ${GAUGE_RADIUS} 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`
}

// NOTICE: Counters are written to the DOM directly instead of through a Vue ref. A reactive update re-renders
// the template, and Vue re-applies every bound inline style on patch, which resets transforms anime.js is
// animating and makes the scene flicker.
const scoreText = ref<SVGTextElement>()
const root = ref<SVGSVGElement>()

useSceneAnimation(root, () => {
  const reading = { value: 0 }
  const arc = svg.createDrawable('.judge-arc')

  const timeline = createTimeline({
    defaults: { ease: 'outQuad' },
    loop: true,
    loopDelay: 1200,
    onUpdate: () => {
      if (scoreText.value)
        scoreText.value.textContent = reading.value.toFixed(2)
    },
  })
    .set('.judge-check', { opacity: 0.15 })
    .set('.judge-mark', { opacity: 0, scale: 0.4 })
    .set('.judge-needle', { rotate: needleAngle(0) })
    .set(arc, { draw: '0 0' })
    .set('.judge-stamp', { opacity: 0, scale: 1.6 })
    .set(reading, { value: 0 })
    .add('.judge-beam', { duration: 2400, ease: 'inOutSine', opacity: [{ duration: 450, ease: 'outQuad', to: 1 }, { duration: 1500, to: 1 }, { duration: 450, ease: 'inQuad', to: 0 }], translateY: [0, 128] }, 0)
    .add('.judge-check', { delay: stagger(560), duration: 240, opacity: 1 }, 300)
    .add('.judge-mark', { delay: stagger(560), duration: 320, ease: 'outBack', opacity: 1, scale: 1 }, 420)
    .add('.judge-needle', { duration: 1800, ease: 'outElastic(1, .6)', rotate: [needleAngle(0), needleAngle(SCORE)] }, 1200)
    .add(arc, { draw: ['0 0', '0 1'], duration: 1400, ease: 'outCubic' }, 1200)
    .add(reading, { duration: 1400, ease: 'outCubic', value: SCORE }, 1200)
    .add('.judge-stamp', { duration: 260, ease: 'outBack', opacity: 1, scale: 1 }, 2700)
    .add('.judge-reset', { duration: 700, opacity: [1, 0.25, 1] }, '+=2200')

  return [timeline]
})
</script>

<template>
  <svg ref="root" viewBox="0 0 400 240" :class="['w-full h-auto', 'font-mono']" aria-hidden="true">
    <defs>
      <linearGradient id="judge-beam-fill" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#fbbf24" stop-opacity="0" />
        <stop offset="1" stop-color="#fbbf24" stop-opacity="0.35" />
      </linearGradient>
      <!-- The beam fades out toward the card edges so it never ends in a hard cut. -->
      <linearGradient id="judge-beam-line" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="#fcd34d" stop-opacity="0" />
        <stop offset="0.2" stop-color="#fcd34d" stop-opacity="0.95" />
        <stop offset="0.8" stop-color="#fcd34d" stop-opacity="0.95" />
        <stop offset="1" stop-color="#fcd34d" stop-opacity="0" />
      </linearGradient>
      <clipPath id="judge-card-clip">
        <rect x="16" y="40" width="112" height="150" rx="6" />
      </clipPath>
    </defs>

    <g class="judge-reset">
      <!-- Agent output under inspection -->
      <text x="16" y="30" font-size="9" class="fill-white/40">output</text>
      <rect x="16" y="40" width="112" height="150" rx="6" class="fill-zinc-900 stroke-white/15" />
      <rect
        v-for="line in 9"
        :key="line"
        x="26"
        :y="44 + line * 14"
        :width="[78, 64, 88, 52, 80, 70, 40, 84, 60][line - 1]"
        height="4"
        rx="2"
        class="fill-white/25"
      />
      <g clip-path="url(#judge-card-clip)">
        <g class="judge-beam" opacity="0">
          <rect x="16" y="28" width="112" height="22" fill="url(#judge-beam-fill)" />
          <rect x="16" y="49.25" width="112" height="1.5" fill="url(#judge-beam-line)" />
        </g>
      </g>

      <!-- Checks -->
      <g v-for="(check, index) in checks" :key="check.label" class="judge-check">
        <text x="146" :y="56 + index * 36" font-size="8" :class="check.kind === 'rubric' ? 'fill-amber-200/70' : 'fill-sky-300/70'">{{ check.kind }}</text>
        <text x="146" :y="70 + index * 36" font-size="9.5" class="fill-white/75">{{ check.label }}</text>
        <g class="judge-mark judge-origin">
          <circle cx="270" :cy="64 + index * 36" r="7" :class="check.passed ? 'fill-emerald-300' : 'fill-orange-400'" />
          <path
            v-if="check.passed"
            :d="`M266.5 ${64 + index * 36}l2.5 2.5l4.5 -5`"
            fill="none"
            stroke-width="1.6"
            stroke-linecap="round"
            class="stroke-zinc-900"
          />
          <path
            v-else
            :d="`M267 ${61 + index * 36}l6 6M273 ${61 + index * 36}l-6 6`"
            stroke-width="1.6"
            stroke-linecap="round"
            class="stroke-zinc-900"
          />
        </g>
      </g>

      <!-- Score gauge -->
      <path :d="gaugeArc(1)" fill="none" stroke-width="6" stroke-linecap="round" class="stroke-white/10" />
      <path :d="gaugeArc(SCORE)" fill="none" stroke-width="6" stroke-linecap="round" :class="['judge-arc', 'stroke-emerald-300/70']" />
      <line
        :x1="GAUGE_X"
        :y1="GAUGE_Y"
        :x2="GAUGE_X"
        :y2="GAUGE_Y - GAUGE_RADIUS + 8"
        stroke-width="2"
        stroke-linecap="round"
        :class="['judge-needle', 'stroke-amber-200']"
        :style="{ transformOrigin: `${GAUGE_X}px ${GAUGE_Y}px`, transformBox: 'view-box', transform: `rotate(${needleAngle(SCORE)}deg)` }"
      />
      <circle :cx="GAUGE_X" :cy="GAUGE_Y" r="3.5" class="fill-amber-200" />
      <text ref="scoreText" :x="GAUGE_X" :y="GAUGE_Y + 24" font-size="18" text-anchor="middle" class="fill-white">{{ SCORE.toFixed(2) }}</text>
      <text :x="GAUGE_X" :y="GAUGE_Y + 38" font-size="8.5" text-anchor="middle" class="fill-white/40">rubric score</text>

      <g class="judge-stamp judge-origin">
        <rect :x="GAUGE_X - 34" y="188" width="68" height="20" rx="4" fill="none" stroke-width="1.5" class="stroke-emerald-300" />
        <text :x="GAUGE_X" y="202" font-size="10" text-anchor="middle" class="fill-emerald-300">3 / 4 pass</text>
      </g>
    </g>

    <text x="16" y="222" font-size="9" class="fill-white/30">expect · score · metric · rubric · plugins</text>
  </svg>
</template>

<style scoped>
.judge-origin {
  transform-box: fill-box;
  transform-origin: center;
}
</style>
