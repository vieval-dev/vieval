<script setup lang="ts">
import { createTimeline, createTimer, eases, stagger, utils } from 'animejs'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { tokenizeTerminalLine } from './terminal'
import { useSceneAnimation } from './useSceneAnimation'

const props = defineProps<{
  /** Terminal transcript; `$` lines are commands and `✗` lines name the failed cases pulled out of the cloud. */
  code: string
  title?: string
}>()

interface CloudPoint {
  /** Set once the scan plane has passed the point in the current loop. */
  evaluated: boolean
  /** Index into {@link failures} when this case fails, otherwise `-1`. */
  failure: number
  /** Position in object space, roughly inside a unit sphere. */
  x: number
  y: number
  z: number
}

interface Failure {
  detail: string
  id: string
  /** 0 = in the cloud, 1 = parked next to its label. Animated by anime.js. */
  pull: number
}

interface ProjectedPoint {
  /** -1 is the near side of the cloud, 1 the far side. */
  depth: number
  x: number
  y: number
}

/** Cases are sampled on a jittered grid clipped to a sphere, which reads as one dense "model" blob. */
const GRID = 9
/** Neighbours closer than this are linked, drawn faintly to suggest a network rather than loose dust. */
const EDGE_DISTANCE = 0.3
const CAMERA_DISTANCE = 3.2
const TILT = 0.42

const terminalLines = computed(() => props.code.split('\n').map(tokenizeTerminalLine))

// Labels mirror the transcript so the cloud and the terminal always name the same cases in every locale.
const failures: Failure[] = props.code.split('\n')
  .filter(line => line.trimStart().startsWith('✗'))
  .slice(0, 6)
  .map((line) => {
    const [id = '', ...rest] = line.trim().slice(1).trim().split(/\s{2,}/)
    return { detail: rest.join('  '), id, pull: 0 }
  })

const points = createCloud()
const edges = linkNeighbours(points)

const root = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const terminal = ref<HTMLElement>()

/**
 * Scene state tweened by anime.js and read by the render loop on every frame.
 * `shift` moves the cloud from the panel centre (0) to the left (1) to make room for failure labels.
 */
const state = { angle: 0.6, labels: 0, scan: -0.2, settle: 1, shift: 0 }

let context: CanvasRenderingContext2D | null = null
let width = 0
let height = 0
let resizeObserver: ResizeObserver | undefined

onMounted(() => {
  context = canvas.value?.getContext('2d') ?? null
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(root.value!)
  resize()
})

onBeforeUnmount(() => resizeObserver?.disconnect())

useSceneAnimation(root, () => {
  const lines = utils.$('.terminal-line')
  utils.set(lines, { opacity: 0 })

  // The transcript is part of the same loop as the cloud: the run prints while the scan sweeps, and each
  // `✗` line appears at the moment its case is pulled out of the cloud, so both halves stay in step every loop.
  const commandIndexes = lines.flatMap((line, index) => line.textContent?.startsWith('$') ? [index] : [])
  const listStart = commandIndexes[1] ?? lines.length
  const runLines = lines.slice(0, listStart)
  const listCommand = lines.slice(listStart, listStart + 1)
  const failureLines = lines.slice(listStart + 1)
  const PULL_AT = 3700
  const PULL_STAGGER = 260

  const loop = createTimeline({ loop: true, loopDelay: 600 })
    .call(() => {
      points.forEach((point) => {
        point.evaluated = false
      })
    }, 0)
    .set(state, { labels: 0, scan: -0.2, settle: 1, shift: 0 })
    .set(failures, { pull: 0 })
    .set(lines, { opacity: 0 })
    .add(runLines, { delay: stagger(600), duration: 260, ease: 'outQuad', opacity: 1 }, 300)
    .add(state, { duration: 3400, ease: 'inOutSine', scan: 1.2 }, 400)
    .add(listCommand, { duration: 260, ease: 'outQuad', opacity: 1 }, PULL_AT - 500)
    .add(state, { duration: 900, ease: 'inOutCubic', shift: 1 }, 3300)
    .add(failures, { delay: stagger(PULL_STAGGER), duration: 900, ease: 'outCubic', pull: 1 }, PULL_AT)
    .add(failureLines, { delay: stagger(PULL_STAGGER), duration: 260, ease: 'outQuad', opacity: 1 }, PULL_AT + 300)
    .add(state, { duration: 500, labels: 1 }, 4000)
    .add(failures, { delay: stagger(80), duration: 700, ease: 'inOutCubic', pull: 0 }, '+=3200')
    .add(state, { duration: 400, labels: 0 }, '<<')
    .add(state, { duration: 900, ease: 'inOutCubic', settle: 0, shift: 0 }, '+=200')
    .add(lines, { delay: stagger(30, { from: 'last' }), duration: 400, opacity: 0 }, '<<')

  const render = createTimer({
    onUpdate: (timer) => {
      state.angle = 0.6 + timer.currentTime * 0.00012
      draw()
    },
  })

  return [loop, render]
})

function createCloud(): CloudPoint[] {
  // NOTICE: A tiny deterministic PRNG (mulberry32) keeps the cloud identical on every visit, so the failing
  // cases do not jump around between loads. The seed is arbitrary.
  let seed = 20261013
  const random = () => {
    seed = (seed + 0x6D2B79F5) | 0
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }

  const cloud: CloudPoint[] = []
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      for (let k = 0; k < GRID; k++) {
        const x = (i / (GRID - 1)) * 2 - 1 + (random() - 0.5) * 0.18
        const y = (j / (GRID - 1)) * 2 - 1 + (random() - 0.5) * 0.18
        const z = (k / (GRID - 1)) * 2 - 1 + (random() - 0.5) * 0.18
        if (x * x + y * y + z * z > 1.05)
          continue
        cloud.push({ evaluated: false, failure: -1, x, y, z })
      }
    }
  }

  // Failures sit away from the centre so their pull-out path stays visible instead of crossing the whole blob.
  const candidates = cloud.filter(point => point.x * point.x + point.y * point.y + point.z * point.z > 0.35)
  failures.forEach((_, index) => {
    let point = candidates[Math.floor(random() * candidates.length)]
    while (point.failure >= 0)
      point = candidates[Math.floor(random() * candidates.length)]
    point.failure = index
  })

  return cloud
}

function draw() {
  if (!context || width === 0)
    return

  const ctx = context
  ctx.clearRect(0, 0, width, height)

  // The cloud lives in the area above the terminal. It starts centred and slides left (by `shift`) only when
  // the failure labels need their column, so the first frame is balanced.
  const terminalTop = terminal.value?.offsetTop ?? height
  const labelWidth = width < 520 ? 0 : Math.min(240, width * 0.38)
  const leftX = (width - labelWidth) / 2 + 12
  const centerX = width / 2 + (leftX - width / 2) * (labelWidth > 0 ? state.shift : 0)
  const centerY = Math.max(110, terminalTop * 0.5)
  const radius = Math.min((width - labelWidth) * 0.38, terminalTop * 0.42, 200)

  const cos = Math.cos(state.angle)
  const sin = Math.sin(state.angle)
  const projected: ProjectedPoint[] = points.map((point) => {
    // Rotate around y, tilt around x, then apply a simple perspective divide.
    const x1 = point.x * cos - point.z * sin
    const z1 = point.x * sin + point.z * cos
    const y1 = point.y * Math.cos(TILT) - z1 * Math.sin(TILT)
    const z2 = point.y * Math.sin(TILT) + z1 * Math.cos(TILT)
    const scale = CAMERA_DISTANCE / (CAMERA_DISTANCE + z2)
    return { depth: z2, x: centerX + x1 * radius * scale, y: centerY + y1 * radius * scale }
  })

  // The scan is measured relative to the cloud so it stays aligned while the cloud slides.
  const scanX = centerX - radius * 1.2 + state.scan * radius * 2.4
  const scanning = state.scan > -0.1 && state.scan < 1.1

  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
  ctx.beginPath()
  for (const [a, b] of edges) {
    ctx.moveTo(projected[a].x, projected[a].y)
    ctx.lineTo(projected[b].x, projected[b].y)
  }
  ctx.stroke()

  // Scan plane: a soft band sweeping across the cloud while cases are evaluated.
  if (scanning) {
    // Fade the scan in as it enters and out as it leaves the cloud, and fade both ends of the line vertically,
    // so it never appears or disappears as a hard edge.
    const presence = Math.max(0, Math.min(1, (state.scan + 0.1) / 0.25, (1.1 - state.scan) / 0.25))
    const top = centerY - radius * 1.2
    const length = radius * 2.4
    ctx.globalAlpha = presence

    const band = ctx.createLinearGradient(scanX - 70, 0, scanX, 0)
    band.addColorStop(0, 'rgba(251, 191, 36, 0)')
    band.addColorStop(1, 'rgba(251, 191, 36, 0.12)')
    ctx.fillStyle = band
    ctx.fillRect(scanX - 70, top + length * 0.1, 70, length * 0.8)

    const line = ctx.createLinearGradient(0, top, 0, top + length)
    line.addColorStop(0, 'rgba(252, 211, 77, 0)')
    line.addColorStop(0.25, 'rgba(252, 211, 77, 0.85)')
    line.addColorStop(0.75, 'rgba(252, 211, 77, 0.85)')
    line.addColorStop(1, 'rgba(252, 211, 77, 0)')
    ctx.fillStyle = line
    ctx.fillRect(scanX, top, 1.5, length)
    ctx.globalAlpha = 1
  }

  // Draw far points first so near points overlap them.
  const order = projected.map((_, index) => index).sort((a, b) => projected[b].depth - projected[a].depth)
  for (const index of order) {
    const point = points[index]
    const position = projected[index]
    // Latch on position alone (not on the band being visible) so dropped frames cannot skip a case.
    if (!point.evaluated && state.scan > -0.1 && position.x < scanX)
      point.evaluated = true

    // Failures that were found are drawn by `drawFailures` on top of everything.
    if (point.failure >= 0 && point.evaluated && state.settle > 0)
      continue

    const near = 1 - (position.depth + 1) / 2
    const neutral = 0.2 + near * 0.55
    const passed = point.evaluated && point.failure < 0 ? state.settle : 0
    ctx.fillStyle = passed > 0
      ? `rgba(${Math.round(255 - 145 * passed)}, ${Math.round(255 - 24 * passed)}, ${Math.round(255 - 72 * passed)}, ${neutral + 0.1 * passed})`
      : `rgba(255, 255, 255, ${neutral})`
    ctx.beginPath()
    ctx.arc(position.x, position.y, 0.8 + near * 1.8, 0, Math.PI * 2)
    ctx.fill()
  }

  drawFailures(ctx, projected, labelWidth, Math.max(28, centerY - radius))
}

function drawFailures(ctx: CanvasRenderingContext2D, projected: ProjectedPoint[], labelWidth: number, top: number) {
  const slotX = width - labelWidth - 4
  const pulse = 0.6 + Math.sin(performance.now() / 220) * 0.4

  points.forEach((point, index) => {
    if (point.failure < 0 || !point.evaluated || state.settle <= 0)
      return

    const failure = failures[point.failure]
    const origin = projected[index]
    const slotY = top + point.failure * 32
    // Narrow layouts have no label column, so failures only light up in place.
    const pull = labelWidth > 0 ? eases.outCubic(failure.pull) : 0
    const x = origin.x + (slotX - origin.x) * pull
    const y = origin.y + (slotY - origin.y) * pull

    ctx.globalAlpha = state.settle
    if (pull > 0.02) {
      ctx.strokeStyle = `rgba(251, 146, 60, ${0.35 * pull})`
      ctx.setLineDash([2, 3])
      ctx.beginPath()
      ctx.moveTo(origin.x, origin.y)
      ctx.lineTo(x, y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.strokeStyle = 'rgba(251, 146, 60, 0.6)'
      ctx.beginPath()
      ctx.arc(origin.x, origin.y, 3.5, 0, Math.PI * 2)
      ctx.stroke()
    }

    ctx.fillStyle = `rgba(251, 146, 60, ${0.18 * pulse})`
    ctx.beginPath()
    ctx.arc(x, y, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fb923c'
    ctx.beginPath()
    ctx.arc(x, y, 3.4, 0, Math.PI * 2)
    ctx.fill()

    if (state.labels > 0 && pull > 0.9) {
      ctx.globalAlpha = state.labels * state.settle
      ctx.font = '500 11px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.fillStyle = '#fed7aa'
      ctx.fillText(failure.id, x + 14, y - 1)
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.fillStyle = 'rgba(214, 211, 209, 0.6)'
      ctx.fillText(failure.detail, x + 14, y + 11, labelWidth - 18)
    }
    ctx.globalAlpha = 1
  })
}

function linkNeighbours(cloud: CloudPoint[]): [number, number][] {
  const result: [number, number][] = []
  for (let a = 0; a < cloud.length; a++) {
    for (let b = a + 1; b < cloud.length; b++) {
      const dx = cloud[a].x - cloud[b].x
      const dy = cloud[a].y - cloud[b].y
      const dz = cloud[a].z - cloud[b].z
      // Keep roughly one close pair in three so the network stays sparse.
      if (dx * dx + dy * dy + dz * dz < EDGE_DISTANCE * EDGE_DISTANCE && (a + b) % 3 === 0)
        result.push([a, b])
    }
  }
  return result
}

function resize() {
  if (!canvas.value || !root.value)
    return

  // NOTICE: The backing store is scaled by devicePixelRatio so points stay crisp on HiDPI screens,
  // while drawing code keeps working in CSS pixels through `setTransform`.
  const ratio = window.devicePixelRatio || 1
  width = root.value.clientWidth
  height = root.value.clientHeight
  canvas.value.width = Math.round(width * ratio)
  canvas.value.height = Math.round(height * ratio)
  context?.setTransform(ratio, 0, 0, ratio, 0, 0)
  draw()
}
</script>

<template>
  <div ref="root" :class="['hero-scene', 'relative h-full min-h-[38rem] overflow-clip', 'flex flex-col justify-end', 'px-5 pb-5 pt-[19rem] sm:p-8 sm:pt-[21rem]']">
    <canvas ref="canvas" :class="['absolute inset-0', 'w-full h-full']" aria-hidden="true" />

    <div ref="terminal" :class="['terminal-window', 'relative w-full']">
      <div class="terminal-title">
        <span />
        <span />
        <span />
        <strong>{{ title ?? 'Terminal' }}</strong>
      </div>
      <pre><code><span v-for="(line, lineIndex) in terminalLines" :key="lineIndex" class="terminal-line"><span v-for="(segment, segmentIndex) in line" :key="segmentIndex" :class="segment.tone ? `terminal-${segment.tone}` : undefined">{{ segment.text }}</span></span></code></pre>
    </div>
  </div>
</template>

<style scoped>
.hero-scene {
  background:
    radial-gradient(circle at 50% 28%, rgba(251, 146, 60, 0.08), transparent 22rem),
    linear-gradient(135deg, rgba(24, 24, 27, 0.96), rgba(9, 9, 11, 0.98));
}

.terminal-window {
  overflow: hidden;
  border: 1px solid rgba(120, 113, 108, 0.24);
  border-radius: 0.5rem;
  background: rgba(12, 10, 9, 0.8);
  backdrop-filter: blur(10px);
  box-shadow: 0 2rem 4rem rgba(12, 10, 9, 0.42);
}

.terminal-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.7rem 1rem;
  border-bottom: 1px solid rgba(120, 113, 108, 0.2);
  color: rgba(214, 211, 209, 0.64);
  font-size: 0.8rem;
}

.terminal-title span {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 999px;
  background: rgba(168, 162, 158, 0.36);
}

.terminal-title strong {
  margin-left: auto;
  font-weight: 600;
}

pre {
  margin: 0;
  padding: 1rem 1.25rem;
  overflow-x: auto;
  color: #d6d3d1;
  font-size: 0.78rem;
  line-height: 1.7;
}

pre code {
  padding: 0;
  border: 0;
  border-radius: 0;
  outline: 0;
  color: inherit;
  background: transparent;
  font-size: inherit;
}

.terminal-line {
  display: block;
  min-height: 1.7em;
  white-space: pre;
}

.terminal-accent,
.terminal-number {
  color: #fbbf24;
}

.terminal-badge {
  color: #ffedd5;
}

.terminal-muted {
  color: rgba(214, 211, 209, 0.54);
}

.terminal-success {
  color: #a7f3d0;
}

.terminal-error {
  color: #fdba74;
}
</style>
