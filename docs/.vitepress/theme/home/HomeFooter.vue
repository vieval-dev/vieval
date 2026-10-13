<script setup lang="ts">
import { FooterNav } from '@voidzero-dev/vitepress-theme'
import { animate, stagger } from 'animejs'
import { ref } from 'vue'

import { useSceneAnimation } from './useSceneAnimation'

defineProps<{
  action?: { link?: string, text?: string }
  heading?: string
  subheading?: string
}>()

/**
 * Columns × rows of the dot field behind the call to action.
 *
 * NOTICE: The theme's own CTA footer (`components/oss/Footer.vue`) is not exported and expects a raster
 * `footerBg` image, so this mirrors its layout (CTA section + exported `FooterNav`) with a generated background.
 */
const COLUMNS = 36
const ROWS = 10

const root = ref<HTMLElement>()

useSceneAnimation(root, () => [
  animate('.footer-dot', {
    delay: stagger(60, { from: 'center', grid: [COLUMNS, ROWS] }),
    duration: 1800,
    ease: 'inOutSine',
    loop: true,
    loopDelay: 1200,
    opacity: [0.15, 0.7, 0.15],
    scale: [1, 1.6, 1],
  }),
])
</script>

<template>
  <footer data-theme="dark">
    <section ref="root" class="wrapper wrapper--ticks border-t">
      <div :class="['relative overflow-hidden', 'w-full']">
        <svg
          :viewBox="`0 0 ${COLUMNS * 20} ${ROWS * 20}`"
          preserveAspectRatio="xMidYMid slice"
          :class="['absolute inset-0', 'w-full h-full']"
          aria-hidden="true"
        >
          <defs>
            <radialGradient id="footer-glow" cx="0.5" cy="0.55" r="0.6">
              <stop offset="0" stop-color="#fb923c" stop-opacity="0.18" />
              <stop offset="1" stop-color="#fb923c" stop-opacity="0" />
            </radialGradient>
          </defs>
          <rect :width="COLUMNS * 20" :height="ROWS * 20" fill="url(#footer-glow)" />
          <template v-for="row in ROWS" :key="row">
            <circle
              v-for="column in COLUMNS"
              :key="column"
              :cx="column * 20 - 10"
              :cy="row * 20 - 10"
              r="1.2"
              :class="['footer-dot', (row * 7 + column * 3) % 23 === 0 ? 'fill-orange-400' : 'fill-white']"
              opacity="0.15"
              style="transform-box: fill-box; transform-origin: center"
            />
          </template>
        </svg>
        <div :class="['relative z-10', 'w-full sm:w-2xl', 'flex flex-col items-center gap-5', 'mx-auto px-5 sm:px-0 py-16 md:py-30']">
          <h2 class="section-title text-center">
            {{ heading ?? '' }}
          </h2>
          <p class="text-white/70 text-center max-w-md text-balance">
            {{ subheading ?? '' }}
          </p>
          <a v-if="action?.link" :href="action.link" class="button button--white mt-5">{{ action.text ?? '' }}</a>
        </div>
      </div>
    </section>
    <FooterNav />
  </footer>
</template>
