<script setup lang="ts">
import { createTimeline, stagger, svg, utils } from 'animejs'
import { ref } from 'vue'

import { useSceneAnimation } from '../useSceneAnimation'

/**
 * Runner stages in execution order, matching `collectEvalEntries -> createRunnerSchedule -> runScheduledTasks`
 * in `packages/vieval/src/core/runner`.
 */
const stages = [
  { caption: 'config', label: 'vieval.config.ts', x: 52 },
  { caption: 'collect', label: '*.eval.ts', x: 148 },
  { caption: 'expand', label: 'matrix', x: 244 },
  { caption: 'schedule', label: 'scheduler', x: 340 },
  { caption: 'execute', label: 'executors', x: 446 },
  { caption: 'record', label: 'reports', x: 536 },
]

const Y = 150
/** Rows the matrix expands into before the scheduler; kept small so each path stays readable. */
const FAN = [-60, -36, -12, 12, 36, 60]
const MODELS = [
  { name: 'openai', y: Y - 48 },
  { name: 'ollama', y: Y },
  { name: 'custom', y: Y + 48 },
]

const intake = `M${stages[0].x + 34} ${Y}L${stages[2].x - 26} ${Y}`
const fans = FAN.map(offset => `M${stages[2].x + 26} ${Y}C${stages[2].x + 60} ${Y} ${stages[3].x - 60} ${Y + offset} ${stages[3].x - 30} ${Y + offset}`)
const dispatch = FAN.map((offset, index) => {
  const model = MODELS[index % MODELS.length]
  return `M${stages[3].x + 30} ${Y + offset}C${stages[3].x + 60} ${Y + offset} ${stages[4].x - 70} ${model.y} ${stages[4].x - 34} ${model.y}`
})
const record = MODELS.map(model => `M${stages[4].x + 34} ${model.y}C${stages[4].x + 50} ${model.y} ${stages[5].x - 40} ${Y} ${stages[5].x - 24} ${Y}`)

const root = ref<SVGSVGElement>()

useSceneAnimation(root, () => {
  const packets = utils.$('.pipe-packet')
  const [lead] = packets

  // Paths stop at a node's edge and the next one starts at its far edge, so every segment fades in and out
  // instead of moving the packet straight across the node it is passing through.
  const travel = (duration: number) => ({
    duration,
    opacity: [{ duration: 100, from: 0, to: 1 }, { duration: duration - 200, to: 1 }, { duration: 100, to: 0 }],
  })

  const timeline = createTimeline({ defaults: { ease: 'inOutSine' }, loop: true, loopDelay: 600 })
    .set(packets, { opacity: 0 })
    .set('.pipe-stage', { opacity: 0.45 })
    .set('.pipe-file', { opacity: 0.25, translateY: 4 })
    .add('.pipe-stage-0', { duration: 240, opacity: 1 }, 0)
    .add(lead, { ...svg.createMotionPath('.pipe-intake'), ...travel(1400) }, 200)
    .add('.pipe-stage-1', { duration: 240, opacity: 1 }, 700)
    .add('.pipe-stage-2', { duration: 240, opacity: 1 }, 1500)

  // One unit of work becomes one packet per matrix row, then each row is dispatched to a model executor.
  packets.forEach((packet, index) => {
    const start = 1700 + index * 120
    timeline
      .add(packet, { ...svg.createMotionPath(`.pipe-fan-${index}`), ...travel(900) }, start)
      .add(packet, { ...svg.createMotionPath(`.pipe-dispatch-${index}`), ...travel(1000) }, start + 1100 + index * 140)
      .add(packet, { ...svg.createMotionPath(`.pipe-record-${index % MODELS.length}`), ...travel(700) }, start + 2300 + index * 180)
  })

  timeline
    .add('.pipe-stage-3', { duration: 240, opacity: 1 }, 2500)
    .add('.pipe-stage-4', { duration: 240, opacity: 1 }, 3600)
    .add('.pipe-stage-5', { duration: 240, opacity: 1 }, 4400)
    .add('.pipe-file', { delay: stagger(240), duration: 320, ease: 'outBack', opacity: 1, translateY: 0 }, 4600)
    .add(['.pipe-stage', '.pipe-file'], { duration: 500, opacity: 0.45 }, '+=1800')

  return [timeline]
})
</script>

<template>
  <svg ref="root" viewBox="0 0 572 300" :class="['w-full h-auto', 'font-mono']" aria-hidden="true">
    <path :d="intake" fill="none" :class="['pipe-intake', 'stroke-white/20']" />
    <path v-for="(d, index) in fans" :key="`fan-${index}`" :d="d" fill="none" :class="[`pipe-fan-${index}`, 'stroke-white/15']" />
    <path v-for="(d, index) in dispatch" :key="`dispatch-${index}`" :d="d" fill="none" :class="[`pipe-dispatch-${index}`, 'stroke-white/10']" />
    <path v-for="(d, index) in record" :key="`record-${index}`" :d="d" fill="none" :class="[`pipe-record-${index}`, 'stroke-white/15']" />

    <!-- Stages -->
    <g v-for="(stage, index) in stages" :key="stage.caption" :class="['pipe-stage', `pipe-stage-${index}`]">
      <text :x="stage.x" y="40" font-size="9" text-anchor="middle" class="fill-amber-200/80">{{ String(index + 1).padStart(2, '0') }} {{ stage.caption }}</text>
      <template v-if="index === 3">
        <rect :x="stage.x - 30" :y="Y - 74" width="60" height="148" rx="8" class="fill-zinc-900 stroke-white/20" />
        <rect v-for="lane in 6" :key="lane" :x="stage.x - 22" :y="Y - 74 + lane * 22 - 6" width="44" height="8" rx="2" class="fill-emerald-300/20" />
        <text :x="stage.x" :y="Y + 96" font-size="9" text-anchor="middle" class="fill-white/60">{{ stage.label }}</text>
      </template>
      <template v-else-if="index === 4">
        <g v-for="model in MODELS" :key="model.name">
          <rect :x="stage.x - 34" :y="model.y - 12" width="68" height="24" rx="6" class="fill-zinc-900 stroke-white/20" />
          <text :x="stage.x" :y="model.y + 3.5" font-size="9" text-anchor="middle" class="fill-white/70">{{ model.name }}</text>
        </g>
        <text :x="stage.x" :y="Y + 96" font-size="9" text-anchor="middle" class="fill-white/60">{{ stage.label }}</text>
      </template>
      <template v-else-if="index === 5">
        <g
          v-for="(file, fileIndex) in ['run-summary.json', 'cases.jsonl', 'events.jsonl']"
          :key="file"
          class="pipe-file"
        >
          <rect :x="stage.x - 24" :y="Y - 40 + fileIndex * 28" width="44" height="22" rx="3" class="fill-zinc-900 stroke-white/25" />
          <rect :x="stage.x - 18" :y="Y - 33 + fileIndex * 28" width="22" height="2" class="fill-white/40" />
          <rect :x="stage.x - 18" :y="Y - 28 + fileIndex * 28" width="30" height="2" class="fill-white/25" />
        </g>
        <text :x="stage.x" :y="Y + 96" font-size="9" text-anchor="middle" class="fill-white/60">{{ stage.label }}</text>
      </template>
      <template v-else>
        <rect :x="stage.x - (index === 0 ? 40 : 26)" :y="Y - 18" :width="index === 0 ? 80 : 52" height="36" rx="8" :class="index === 2 ? 'fill-amber-300/15 stroke-amber-300/60' : 'fill-zinc-900 stroke-white/20'" />
        <text :x="stage.x" :y="Y + 3.5" font-size="9" text-anchor="middle" :class="index === 2 ? 'fill-amber-200' : 'fill-white/70'">{{ index === 2 ? '×6' : index === 1 ? 'eval' : 'config' }}</text>
        <text :x="stage.x" :y="Y + 96" font-size="9" text-anchor="middle" class="fill-white/60">{{ stage.label }}</text>
      </template>
    </g>

    <rect v-for="index in FAN.length" :key="`packet-${index}`" x="-4" y="-4" width="8" height="8" rx="2" :class="['pipe-packet', index === 3 ? 'fill-orange-400' : 'fill-emerald-300']" opacity="0" />

    <text x="20" y="282" font-size="9.5" class="fill-white/35">discover → expand → schedule → execute → record</text>
  </svg>
</template>
