<script setup lang="ts">
import { animate, utils } from 'animejs'
import { ref } from 'vue'

import { box } from '../iso'
import { useSceneAnimation } from '../useSceneAnimation'

/** Input sources feeding the belt: anything that loads into an array can become cases. */
const sources = [
  { icon: 'i-simple-icons:huggingface', label: 'Hugging Face', tone: 'text-amber-300' },
  { icon: 'i-simple-icons:amazons3', label: 'Amazon S3', tone: 'text-emerald-400' },
  { icon: 'i-mingcute:braces-line', label: 'JSONL', tone: 'text-sky-300' },
  { icon: 'i-mingcute:code-line', label: 'generator', tone: 'text-fuchsia-300' },
]
const SOURCE_X = 10
const SOURCE_WIDTH = 90
const SOURCE_HEIGHT = 24
const sourceY = (index: number) => 46 + index * 32

const BELT_START = 146
const BELT_END = 396
const BELT_Y = 172
const PRESS_X = 236
/** Time an item needs to cross the belt, and the gap between items. */
const TRAVEL = 6000
const SPACING = 1500
/** Moment an item reaches the press, as a fraction of {@link TRAVEL}. */
const PRESS_AT = (PRESS_X - BELT_START) / (BELT_END - BELT_START) * TRAVEL
/** Share of the trip spent fading in at the belt start and out at its end. */
const EDGE_FADE = 0.06

const cube = box([-0.5, -0.5, 0], [1, 1, 1], { origin: [0, -9], unit: 18 })

// NOTICE: Counters are written to the DOM directly instead of through a Vue ref. A reactive update re-renders
// the template, and Vue re-applies every bound inline style on patch, which resets transforms anime.js is
// animating and makes the scene flicker.
const casesText = ref<SVGTSpanElement>()
let cases = 128
const root = ref<SVGSVGElement>()

useSceneAnimation(root, () => {
  const belt = animate('.factory-belt', { duration: 600, ease: 'linear', loop: true, strokeDashoffset: [0, -24] })
  const feeds = animate('.factory-feed', { duration: 800, ease: 'linear', loop: true, strokeDashoffset: [0, -16] })

  // Each item is a flat input card before the press and a case cube after it. The swap is derived from the
  // item's own progress so it cannot drift from the belt the way separately looping animations do.
  const items = utils.$('.factory-item').map((item, index) => {
    const card = item.querySelector<SVGGElement>('.factory-card')!
    const cube = item.querySelector<SVGGElement>('.factory-cube')!
    let pressed: boolean | undefined

    return animate(item, {
      duration: TRAVEL,
      ease: 'linear',
      loop: true,
      onUpdate: (self) => {
        const progress = self.iterationProgress
        utils.set(item, { opacity: Math.min(1, progress / EDGE_FADE, (1 - progress) / EDGE_FADE) })

        const next = progress >= PRESS_AT / TRAVEL
        if (next === pressed)
          return

        pressed = next
        utils.set(card, { opacity: pressed ? 0 : 1 })
        utils.set(cube, { opacity: pressed ? 1 : 0 })
        if (pressed)
          animate(cube, { duration: 260, ease: 'outBack', scale: [0.6, 1] })
      },
      translateX: [BELT_START, BELT_END],
    // Start every item one spacing further along instead of delaying it, so items are spread over the belt
    // from the first frame rather than waiting stacked at its start.
    }).seek(index * SPACING)
  })

  const SLAM = 140
  // Items reach the press every SPACING, first at PRESS_AT modulo SPACING; the slam must land on those frames.
  const firstHit = PRESS_AT % SPACING
  const slamDelay = firstHit >= SLAM ? firstHit - SLAM : firstHit - SLAM + SPACING
  const press = animate('.factory-piston', {
    delay: slamDelay,
    loop: true,
    onLoop: () => {
      cases += 1
      if (casesText.value)
        casesText.value.textContent = String(cases)
    },
    translateY: [
      { duration: SLAM, ease: 'inQuad', to: 26 },
      { duration: 100, to: 26 },
      { duration: 480, ease: 'outQuad', to: 0 },
      { duration: SPACING - SLAM - 580, to: 0 },
    ],
  })

  const sparks = animate('.factory-spark', {
    delay: slamDelay,
    loop: true,
    opacity: [{ duration: SLAM, from: 0, to: 0 }, { duration: 40, to: 1 }, { duration: 360, to: 0 }, { duration: SPACING - SLAM - 400, to: 0 }],
    // Function values resolve per keyframe, not to a keyframe list, so only the spread target varies per spark.
    translateX: [{ duration: SLAM, from: 0, to: 0 }, { duration: 400, ease: 'outQuad', to: (_: unknown, index = 0) => (index - 1.5) * 14 }, { duration: SPACING - SLAM - 400, to: 0 }],
    translateY: [{ duration: SLAM, from: 0, to: 0 }, { duration: 400, ease: 'outQuad', to: -10 }, { duration: SPACING - SLAM - 400, to: 0 }],
  })

  return [belt, feeds, press, sparks, ...items]
})
</script>

<template>
  <svg ref="root" viewBox="0 0 400 240" :class="['w-full h-auto', 'font-mono']" aria-hidden="true">
    <defs>
      <clipPath id="factory-belt-clip">
        <rect :x="BELT_START - 6" y="0" :width="BELT_END - BELT_START" height="240" />
      </clipPath>
    </defs>

    <text x="16" y="34" font-size="10" class="fill-white/40">inputs[]</text>
    <g v-for="(source, index) in sources" :key="source.label">
      <!-- Every feed leaves its chip horizontally and meets the others at the belt entry. -->
      <path
        :d="`M${SOURCE_X + SOURCE_WIDTH} ${sourceY(index) + SOURCE_HEIGHT / 2}C${BELT_START - 8} ${sourceY(index) + SOURCE_HEIGHT / 2} ${SOURCE_X + SOURCE_WIDTH + 4} ${BELT_Y - 6} ${BELT_START - 10} ${BELT_Y - 6}`"
        fill="none"
        stroke-dasharray="3 4"
        :class="['factory-feed', 'stroke-amber-300/35']"
      />
      <foreignObject :x="SOURCE_X" :y="sourceY(index)" :width="SOURCE_WIDTH" :height="SOURCE_HEIGHT">
        <div :class="['flex items-center gap-1.5', 'h-full px-2', 'rounded-[5px] border border-white/15 bg-zinc-900', 'font-sans text-[8px] text-white/70 whitespace-nowrap']">
          <span :class="[source.icon, source.tone, 'shrink-0 text-[11px]']" />
          {{ source.label }}
        </div>
      </foreignObject>
    </g>

    <!-- Press frame and piston -->
    <text :x="PRESS_X" y="34" font-size="9" text-anchor="middle" class="fill-amber-200/80">casesFromInputs()</text>
    <rect :x="PRESS_X - 34" y="42" width="6" :height="BELT_Y - 42" class="fill-white/10" />
    <rect :x="PRESS_X + 28" y="42" width="6" :height="BELT_Y - 42" class="fill-white/10" />
    <rect :x="PRESS_X - 38" y="42" width="76" height="10" rx="2" class="fill-zinc-700" />
    <g class="factory-piston">
      <rect :x="PRESS_X - 3" y="52" width="6" height="56" class="fill-zinc-600" />
      <rect :x="PRESS_X - 22" y="108" width="44" height="14" rx="2" class="fill-zinc-300" />
      <rect :x="PRESS_X - 22" y="118" width="44" height="4" class="fill-amber-400" />
    </g>
    <rect
      v-for="index in 4"
      :key="`spark-${index}`"
      :x="PRESS_X - 1.5"
      :y="BELT_Y - 22"
      width="3"
      height="3"
      :class="['factory-spark', 'fill-amber-200']"
      opacity="0"
    />

    <!-- Belt -->
    <rect :x="BELT_START - 8" :y="BELT_Y" :width="BELT_END - BELT_START + 8" height="14" rx="7" class="fill-zinc-900 stroke-white/15" />
    <line
      :x1="BELT_START"
      :y1="BELT_Y + 7"
      :x2="BELT_END"
      :y2="BELT_Y + 7"
      stroke-dasharray="10 14"
      stroke-width="2"
      :class="['factory-belt', 'stroke-white/20']"
    />

    <!-- Items: the still frame shows one card waiting and one stamped case leaving the press. -->
    <g clip-path="url(#factory-belt-clip)">
      <g
        v-for="index in 4"
        :key="`item-${index}`"
        :transform="`translate(0, ${BELT_Y})`"
      >
        <!-- NOTICE: anime.js writes `translateX` to the CSS transform, which replaces an SVG transform attribute,
        so the belt height lives on the parent group and the animated group only moves along x. -->
        <g
          :class="['factory-item']"
          :style="{ transform: `translateX(${index === 1 ? 170 : 310}px)` }"
          :opacity="index > 2 ? 0 : 1"
        >
          <g :class="['factory-card']" :opacity="index === 1 ? 1 : 0">
            <rect x="-14" y="-12" width="28" height="12" rx="2" class="fill-zinc-200" />
            <rect x="-10" y="-9" width="14" height="2" class="fill-zinc-500" />
            <rect x="-10" y="-5" width="20" height="2" class="fill-zinc-500" />
          </g>
          <g :class="['factory-cube']" :opacity="index === 1 ? 0 : 1">
            <polygon :points="cube.left" class="fill-emerald-700" />
            <polygon :points="cube.right" class="fill-emerald-500" />
            <polygon :points="cube.top" class="fill-emerald-300" />
          </g>
        </g>
      </g>
    </g>

    <text x="384" y="222" font-size="10" text-anchor="end" class="fill-white/50">
      cases <tspan ref="casesText" class="fill-emerald-300">128</tspan>
    </text>
    <text x="16" y="222" font-size="10" class="fill-white/30">caseOf · casesFromInputs</text>
  </svg>
</template>

<style scoped>
.factory-cube {
  transform-box: fill-box;
  transform-origin: 50% 100%;
}
</style>
