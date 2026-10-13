<script setup lang="ts">
import type { GridPoint, IsoProjection } from '../iso'

import { createTimeline, stagger, utils } from 'animejs'
import { ref } from 'vue'

import { box, polygon, project } from '../iso'
import { useSceneAnimation } from '../useSceneAnimation'

interface LatticeCube {
  /** Sum of grid coordinates; larger values are nearer the viewer. */
  depth: number
  faces: ReturnType<typeof box>
  /** Model index along x; the scan beam reaches cubes in this order. */
  i: number
  /** Screen offset from the final position to the position at each run-matrix step. */
  offsets: [number, number][]
  /** Outcome under each eval-matrix rubric. */
  passed: { lenient: boolean, strict: boolean }
  /** Run-matrix step that reveals this cube: 0 = the single run, 1 = model, 2 = scenario. */
  step: number
}

const emit = defineEmits<{
  /** Fired when a step starts: 0 = single run, 1 = model, 2 = scenario, then one per rubric scan (3, 4). */
  step: [step: number]
}>()

const projection: IsoProjection = { origin: [196, 78], unit: 24 }

/**
 * Run-matrix axes become separate runs (cubes on the floor). The eval-matrix axis does not add runs:
 * every run is evaluated once per rubric, shown as one scan pass per rubric value.
 * Mirrors "Separate run and eval matrices" in `docs/content/en/guide/learn/matrices-and-datasets.md`.
 */
const MODELS = 4
const SCENARIOS = 3
const RUBRICS = ['strict', 'lenient'] as const
/** Distance between cube origins in grid units; 1 would pack cubes without gaps. */
const GAP = 1.55

/** Runs failing each rubric, as `model:scenario`; the lenient rubric forgives two of them. */
const FAILED = {
  lenient: new Set(['2:2']),
  strict: new Set(['1:0', '2:2', '3:1']),
}

/** Run counter value after each run-matrix step. */
const counts = [1, MODELS, MODELS * SCENARIOS]

const cubes: LatticeCube[] = []
for (let i = 0; i < MODELS; i++) {
  for (let j = 0; j < SCENARIOS; j++) {
    const final = project([i * GAP, j * GAP, 0], projection)
    // Cubes split off the cube they are copied from: first along models, then along scenarios.
    const positions: GridPoint[] = [[0, 0, 0], [i * GAP, 0, 0], [i * GAP, j * GAP, 0]]
    cubes.push({
      depth: i + j,
      faces: box([i * GAP, j * GAP, 0], [1, 1, 1], projection),
      i,
      offsets: positions.map((position) => {
        const [x, y] = project(position, projection)
        return [x - final[0], y - final[1]]
      }),
      passed: { lenient: !FAILED.lenient.has(`${i}:${j}`), strict: !FAILED.strict.has(`${i}:${j}`) },
      step: j > 0 ? 2 : i > 0 ? 1 : 0,
    })
  }
}
// Painter's order: cubes nearer the viewer (larger x + y) are drawn last.
cubes.sort((a, b) => a.depth - b.depth)

/** Scan beam: a vertical plane across all scenarios, swept along the model axis. */
const BEAM_FROM = -0.7
const BEAM_TO = MODELS * GAP + 0.3
const SCAN_MS = 1700
const beam = polygon([[0, -0.4, 0], [0, SCENARIOS * GAP + 0.4, 0], [0, SCENARIOS * GAP + 0.4, 1.6], [0, -0.4, 1.6]], projection)
/** Screen movement of one grid unit along +x. */
const unitX = project([1, 0, 0], projection).map((value, axis) => value - projection.origin[axis])
/** When the sweeping beam reaches the middle of a cube in model column `i`. */
const reachedAt = (i: number) => ((i * GAP + 0.5 - BEAM_FROM) / (BEAM_TO - BEAM_FROM)) * SCAN_MS

const labels = [
  { anchor: 'start', position: project([MODELS * GAP + 0.2, -0.3, 0], projection), text: `model ×${MODELS}` },
  { anchor: 'end', position: project([-0.3, SCENARIOS * GAP + 0.4, 0], projection), text: `scenario ×${SCENARIOS}` },
] as const

const passTotals = RUBRICS.map(rubric => cubes.filter(cube => cube.passed[rubric]).length)

// NOTICE: Counters are written to the DOM directly instead of through a Vue ref. A reactive update re-renders
// the template, and Vue re-applies every bound inline style on patch, which resets transforms anime.js is
// animating and makes the scene flicker.
const countText = ref<SVGTextElement>()
const root = ref<SVGSVGElement>()

useSceneAnimation(root, () => {
  const cubeNodes = utils.$('.lattice-cube')
  const offsetAt = (step: number, axis: 0 | 1) => (_: unknown, index = 0) => cubes[index].offsets[step][axis]
  const counter = { value: 1 }

  const timeline = createTimeline({
    defaults: { duration: 700, ease: 'inOutQuart' },
    loop: true,
    loopDelay: 400,
    // NOTICE: A `.call()` at position 0 does not fire again when the timeline loops, so the reset step is
    // announced from the begin and loop callbacks instead.
    onBegin: () => emit('step', 0),
    onLoop: () => emit('step', 0),
    onUpdate: () => {
      if (countText.value)
        countText.value.textContent = String(Math.round(counter.value))
    },
  })
    .set(cubeNodes, { opacity: (_: unknown, index = 0) => cubes[index].step === 0 ? 1 : 0, translateX: offsetAt(0, 0), translateY: offsetAt(0, 1) })
    .set(['.lattice-strict', '.lattice-lenient', '.lattice-pass', '.lattice-evals', '.lattice-beam'], { opacity: 0 })
    .set('.lattice-label', { opacity: 0.25 })
    .set(counter, { value: 1 })

  for (const step of [1, 2]) {
    timeline
      .label(`step-${step}`, '+=500')
      .add(cubeNodes, {
        delay: stagger(12),
        opacity: (_: unknown, index = 0) => cubes[index].step <= step ? 1 : 0,
        translateX: offsetAt(step, 0),
        translateY: offsetAt(step, 1),
      }, `step-${step}`)
      .add(`.lattice-label-${step}`, { duration: 300, opacity: 1 }, `step-${step}`)
      .add(counter, { duration: 700, ease: 'outQuad', value: counts[step] }, `step-${step}`)
      .call(() => emit('step', step), `step-${step}`)
  }

  // One scan pass per rubric: the same runs are evaluated again, and each pass recolors them.
  RUBRICS.forEach((rubric, index) => {
    const step = 3 + index
    const label = `scan-${rubric}`
    timeline
      .label(label, index === 0 ? '+=700' : '+=900')
      .call(() => emit('step', step), label)
      .add('.lattice-beam', { duration: 160, opacity: 1 }, label)
      .add('.lattice-beam', {
        duration: SCAN_MS,
        ease: 'linear',
        translateX: [BEAM_FROM * unitX[0], BEAM_TO * unitX[0]],
        translateY: [BEAM_FROM * unitX[1], BEAM_TO * unitX[1]],
      }, label)
      .add('.lattice-beam', { duration: 200, opacity: 0 }, `${label}+=${SCAN_MS - 100}`)
      .add(`.lattice-${rubric}`, { delay: (_: unknown, cube = 0) => reachedAt(cubes[cube].i), duration: 180, opacity: 1 }, label)
      .add(`.lattice-pass-${index}`, { duration: 300, opacity: 1 }, `${label}+=${SCAN_MS}`)

    if (index === 0)
      timeline.add('.lattice-evals', { duration: 400, opacity: 1 }, label)
    else
      timeline.add('.lattice-pass-0', { duration: 300, opacity: 0.35 }, label)
  })

  timeline.add(cubeNodes, { delay: stagger(16, { from: 'last' }), duration: 500, opacity: 0 }, '+=1800')

  return [timeline]
})
</script>

<template>
  <svg ref="root" viewBox="0 0 400 240" :class="['w-full h-auto', 'font-mono']" aria-hidden="true">
    <text x="16" y="30" font-size="10" class="fill-white/40">runs</text>
    <text ref="countText" x="16" y="56" font-size="26" class="fill-white">{{ counts.at(-1) }}</text>
    <text x="16" y="74" font-size="9.5" :class="['lattice-evals', 'fill-white/45']">× {{ RUBRICS.length }} rubrics = {{ counts.at(-1)! * RUBRICS.length }} evals</text>

    <g v-for="(cube, index) in cubes" :key="index" class="lattice-cube">
      <polygon :points="cube.faces.left" class="fill-zinc-800 stroke-white/10" />
      <polygon :points="cube.faces.right" class="fill-zinc-700 stroke-white/10" />
      <polygon :points="cube.faces.top" class="fill-zinc-600 stroke-white/10" />
      <g v-for="rubric in RUBRICS" :key="rubric" :class="`lattice-${rubric}`">
        <polygon :points="cube.faces.top" :class="cube.passed[rubric] ? 'fill-emerald-300' : 'fill-orange-400'" />
        <polygon :points="cube.faces.right" :class="cube.passed[rubric] ? 'fill-emerald-500/60' : 'fill-orange-500/70'" />
      </g>
    </g>

    <polygon :points="beam" :class="['lattice-beam', 'fill-amber-300/15 stroke-amber-300/80']" opacity="0" />

    <text
      v-for="(label, index) in labels"
      :key="label.text"
      :x="label.position[0]"
      :y="label.position[1]"
      :text-anchor="label.anchor"
      font-size="10"
      :class="['lattice-label', `lattice-label-${index + 1}`, 'fill-amber-200']"
    >
      {{ label.text }}
    </text>

    <text
      v-for="(rubric, index) in RUBRICS"
      :key="rubric"
      x="384"
      :y="30 + index * 16"
      font-size="9.5"
      text-anchor="end"
      :class="['lattice-pass', `lattice-pass-${index}`, 'fill-white/70']"
    >
      rubric {{ rubric }} <tspan :class="passTotals[index] === cubes.length ? 'fill-emerald-300' : 'fill-amber-200'">{{ passTotals[index] }}/{{ cubes.length }}</tspan>
    </text>
  </svg>
</template>
