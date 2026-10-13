<script setup lang="ts">
import { createTimeline, stagger, svg } from 'animejs'
import { ref } from 'vue'

import { useSceneAnimation } from '../useSceneAnimation'

type EvidenceKind = 'metrics' | 'screenshot' | 'transcript'

interface TreeNode {
  evidence?: EvidenceKind
  id: string
  label: string
  parent?: string
  x: number
  y: number
}

/** Span hierarchy recorded for a run: run → task → case → evidence. */
const nodes: TreeNode[] = [
  { id: 'run', label: 'run', x: 34, y: 124 },
  { id: 'task-a', label: 'task', parent: 'run', x: 120, y: 80 },
  { id: 'task-b', label: 'task', parent: 'run', x: 120, y: 168 },
  { id: 'case-a', label: 'case', parent: 'task-a', x: 210, y: 56 },
  { id: 'case-b', label: 'case', parent: 'task-a', x: 210, y: 104 },
  { id: 'case-c', label: 'case', parent: 'task-b', x: 210, y: 150 },
  { id: 'case-d', label: 'case', parent: 'task-b', x: 210, y: 196 },
  { evidence: 'transcript', id: 'ev-a', label: 'transcript', parent: 'case-b', x: 300, y: 84 },
  { evidence: 'screenshot', id: 'ev-b', label: 'screenshot', parent: 'case-b', x: 300, y: 124 },
  { evidence: 'metrics', id: 'ev-c', label: 'metrics', parent: 'case-c', x: 300, y: 164 },
]

const byId = new Map(nodes.map(node => [node.id, node]))

const links = nodes.filter(node => node.parent).map((node) => {
  const parent = byId.get(node.parent!)!
  const fromX = parent.x + (parent.evidence ? 0 : 22)
  const toX = node.x - (node.evidence ? 0 : 22)
  const middle = (fromX + toX) / 2
  return {
    // Same curve walked from child to parent, for the dot that traces evidence back to its run.
    back: `M${toX} ${node.y}C${middle} ${node.y} ${middle} ${parent.y} ${fromX} ${parent.y}`,
    d: `M${fromX} ${parent.y}C${middle} ${parent.y} ${middle} ${node.y} ${toX} ${node.y}`,
    id: node.id,
  }
})

/** Link ids (named after their child node) walked from a piece of evidence back to the run. */
const traces = [
  ['ev-b', 'case-b', 'task-a'],
  ['ev-c', 'case-c', 'task-b'],
]

const root = ref<SVGSVGElement>()

useSceneAnimation(root, () => {
  const links = svg.createDrawable('.trace-link')
  const timeline = createTimeline({ defaults: { ease: 'outQuad' }, loop: true, loopDelay: 800 })
    .set(links, { draw: '0 0' })
    .set('.trace-root-ring', { opacity: 0 })
    .set('.trace-node', { opacity: 0, scale: 0.6 })
    .set('.trace-hot', { opacity: 0 })
    .set('.trace-score', { opacity: 0 })
    .add(links, { delay: stagger(90), draw: ['0 0', '0 1'], duration: 500 }, 200)
    .add('.trace-node', { delay: stagger(80), duration: 360, ease: 'outBack', opacity: 1, scale: 1 }, 0)

  traces.forEach((trace, index) => {
    const label = `trace-${index}`
    timeline.label(label, '+=600')
    timeline.add(`.trace-score-${index}`, { duration: 300, opacity: [0, 1], translateX: [8, 0] }, label)

    // Walk the dot from the evidence back up to the run, highlighting each link it crosses.
    trace.forEach((id, step) => {
      const at = `${label}+=${400 + step * 520}`
      timeline
        .add(`.trace-hot-${id}`, { duration: 200, opacity: [0, 1] }, at)
        .add(svg.createDrawable(`.trace-hot-${id}`), { draw: ['1 1', '0 1'], duration: 520, ease: 'inOutSine' }, at)
        .add('.trace-dot', { ...svg.createMotionPath(`.trace-back-${id}`), duration: 520, ease: 'inOutSine', opacity: 1 }, at)
    })

    timeline
      .add('.trace-root-ring', { duration: 700, opacity: [0.9, 0], scale: [1, 1.9] }, `${label}+=${400 + trace.length * 520}`)
      .add(['.trace-hot', `.trace-score-${index}`, '.trace-dot'], { duration: 400, opacity: 0 }, '+=900')
  })

  return [timeline]
})
</script>

<template>
  <svg ref="root" viewBox="0 0 400 240" :class="['w-full h-auto', 'font-mono']" aria-hidden="true">
    <text x="16" y="24" font-size="9" class="fill-white/40">spans · events.jsonl · OTLP</text>

    <path v-for="link in links" :key="link.id" :d="link.d" fill="none" :class="['trace-link', `trace-link-${link.id}`, 'stroke-white/20']" />
    <path
      v-for="link in links"
      :key="`hot-${link.id}`"
      :d="link.d"
      fill="none"
      stroke-width="2"
      :class="['trace-hot', `trace-hot-${link.id}`, 'stroke-amber-300']"
      opacity="0"
    />

    <path v-for="link in links" :key="`back-${link.id}`" :d="link.back" fill="none" stroke="none" :class="`trace-back-${link.id}`" />

    <circle :cx="nodes[0].x" :cy="nodes[0].y" r="14" :class="['trace-root-ring', 'stroke-amber-300', 'trace-origin']" fill="none" opacity="0" />

    <g v-for="node in nodes" :key="node.id" class="trace-node trace-origin">
      <template v-if="!node.evidence">
        <rect :x="node.x - 22" :y="node.y - 9" width="44" height="18" rx="5" :class="node.id === 'run' ? 'fill-zinc-200' : 'fill-zinc-800 stroke-white/15'" />
        <text :x="node.x" :y="node.y + 3" font-size="9" text-anchor="middle" :class="node.id === 'run' ? 'fill-zinc-900' : 'fill-white/70'">{{ node.label }}</text>
      </template>
      <template v-else>
        <rect :x="node.x" :y="node.y - 11" width="22" height="22" rx="3" class="fill-zinc-900 stroke-white/25" />
        <template v-if="node.evidence === 'transcript'">
          <rect v-for="line in 3" :key="line" :x="node.x + 4" :y="node.y - 7 + line * 4" :width="line === 3 ? 8 : 14" height="1.6" class="fill-white/50" />
        </template>
        <template v-else-if="node.evidence === 'screenshot'">
          <circle :cx="node.x + 7" :cy="node.y - 4" r="2" class="fill-amber-200" />
          <path :d="`M${node.x + 3} ${node.y + 8}L${node.x + 9} ${node.y + 1}L${node.x + 13} ${node.y + 5}L${node.x + 16} ${node.y + 2}L${node.x + 20} ${node.y + 8}Z`" class="fill-white/50" />
        </template>
        <template v-else>
          <rect v-for="bar in 3" :key="bar" :x="node.x + bar * 5" :y="node.y + 7 - bar * 4" width="3" :height="bar * 4" class="fill-emerald-300/80" />
        </template>
        <text :x="node.x + 28" :y="node.y + 3" font-size="9" class="fill-white/50">{{ node.label }}</text>
      </template>
    </g>

    <g :class="['trace-score', 'trace-score-0']" opacity="0">
      <rect x="190" y="115" width="40" height="13" rx="6.5" class="fill-orange-400" />
      <text x="210" y="124.5" font-size="8.5" text-anchor="middle" class="fill-zinc-900">0.42</text>
    </g>
    <g :class="['trace-score', 'trace-score-1']" opacity="0">
      <rect x="190" y="161" width="40" height="13" rx="6.5" class="fill-emerald-300" />
      <text x="210" y="170.5" font-size="8.5" text-anchor="middle" class="fill-zinc-900">0.93</text>
    </g>

    <circle r="4" :class="['trace-dot', 'fill-amber-200']" opacity="0" />
  </svg>
</template>

<style scoped>
.trace-origin {
  transform-box: fill-box;
  transform-origin: center;
}
</style>
