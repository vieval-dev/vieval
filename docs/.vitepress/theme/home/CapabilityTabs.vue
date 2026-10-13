<script setup lang="ts">
import type { Component } from 'vue'

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import RunPipeline from './blocks/RunPipeline.vue'
import CaseFactory from './scenes/CaseFactory.vue'
import JudgeStation from './scenes/JudgeStation.vue'
import LiveMonitor from './scenes/LiveMonitor.vue'
import SchedulerLanes from './scenes/SchedulerLanes.vue'
import TraceTree from './scenes/TraceTree.vue'

/**
 * One capability in the menu, read from the home page frontmatter.
 */
export interface Capability {
  /** Longer explanation shown in the detail panel. */
  details?: string
  /** Short label above the title, such as "Generate". */
  eyebrow?: string
  /** Guide page the "Learn more" link opens. */
  link?: string
  /** Key of the animated scene for this capability. */
  scene?: SceneKey
  /** One-line summary shown in the menu. */
  summary?: string
  title?: string
}

const props = defineProps<{
  items: Capability[]
  learnMore?: string
}>()

/** Animated scenes that frontmatter capabilities can reference by key. */
const scenes = {
  executors: RunPipeline,
  factory: CaseFactory,
  judge: JudgeStation,
  monitor: LiveMonitor,
  scheduler: SchedulerLanes,
  trace: TraceTree,
} satisfies Record<string, Component>

type SceneKey = keyof typeof scenes

/** How long each capability stays selected while the menu cycles on its own. */
const AUTOPLAY_MS = 8000

const active = ref(0)
const autoplay = ref(true)
const current = computed(() => props.items[active.value])

let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    autoplay.value = false
    return
  }

  timer = setInterval(() => {
    if (autoplay.value && document.visibilityState === 'visible')
      active.value = (active.value + 1) % props.items.length
  }, AUTOPLAY_MS)
})

onBeforeUnmount(() => clearInterval(timer))

function select(index: number) {
  // Choosing an item means the reader wants to stay on it, so cycling stops for good.
  autoplay.value = false
  active.value = index
}
</script>

<template>
  <div :class="['grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]', 'lg:divide-x divide-nickel']">
    <div role="tablist" aria-orientation="vertical" :class="['flex lg:flex-col', 'overflow-x-auto lg:overflow-visible', 'border-b lg:border-b-0 border-nickel']">
      <button
        v-for="(item, index) in items"
        :key="item.title"
        role="tab"
        type="button"
        :aria-selected="index === active"
        :class="[
          'capability-tab',
          'relative shrink-0 text-left',
          'flex flex-col gap-1',
          'px-5 py-4 lg:px-8 lg:py-5',
          'border-r lg:border-r-0 lg:border-b border-nickel last:border-r-0 lg:last:border-b-0',
          'transition-colors duration-200',
          index === active ? 'bg-white/4' : 'hover:bg-white/2',
        ]"
        @click="select(index)"
      >
        <span class="text-xs text-grey tracking-wide font-mono uppercase">
          {{ String(index + 1).padStart(2, '0') }} · {{ item.eyebrow ?? '' }}
        </span>
        <span :class="['font-sans-title', 'text-base lg:text-lg', index === active ? 'text-white' : 'text-white/60']">{{ item.title ?? '' }}</span>
        <span :class="['hidden lg:block', 'text-sm text-white/45 text-pretty']">{{ item.summary ?? '' }}</span>
        <span
          v-if="index === active"
          :key="`${active}-${autoplay}`"
          :class="['capability-progress', 'absolute left-0 bottom-0 lg:bottom-auto lg:top-0', 'h-px lg:h-full w-full lg:w-px', 'bg-amber-300', autoplay ? 'is-playing' : '']"
          :style="{ '--duration': `${AUTOPLAY_MS}ms` }"
        />
      </button>
    </div>

    <div role="tabpanel" :class="['flex flex-col gap-6', 'p-5 sm:p-8 lg:p-10']">
      <div :class="['scene-frame', 'glass-frame', 'aspect-[5/3]']">
        <Transition name="scene-fade" mode="out-in">
          <component :is="scenes[current.scene]" v-if="current?.scene && scenes[current.scene]" :key="active" />
        </Transition>
      </div>
      <Transition name="scene-fade" mode="out-in">
        <div :key="active" class="flex flex-col gap-3 max-w-[40rem]">
          <h4 class="text-white font-sans-title">
            {{ current?.title ?? '' }}
          </h4>
          <p class="text-pretty">
            {{ current?.details ?? '' }}
          </p>
          <a v-if="current?.link" :href="current.link" class="text-sm text-amber-200 w-fit hover:text-amber-100">{{ learnMore ?? 'Learn more' }} →</a>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.scene-frame :deep(svg) {
  width: 100%;
  height: 100%;
}

/* The active tab's edge fills over the autoplay interval, showing when the next capability comes up. */
.capability-progress {
  transform-origin: left top;
}

.capability-progress.is-playing {
  animation: capability-progress var(--duration) linear forwards;
}

@media (min-width: 1024px) {
  .capability-progress.is-playing {
    animation-name: capability-progress-vertical;
  }
}

@keyframes capability-progress {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

@keyframes capability-progress-vertical {
  from {
    transform: scaleY(0);
  }
  to {
    transform: scaleY(1);
  }
}

.scene-fade-enter-active,
.scene-fade-leave-active {
  transition:
    opacity 220ms ease,
    transform 220ms ease;
}

.scene-fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.scene-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .scene-fade-enter-active,
  .scene-fade-leave-active {
    transition: none;
  }
}
</style>
