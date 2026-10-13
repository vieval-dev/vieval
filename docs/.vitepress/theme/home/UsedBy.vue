<script setup lang="ts">
/**
 * An organization or project that runs evaluations with Vieval.
 */
export interface Adopter {
  /** GitHub account whose avatar is shown, such as `lobehub`. */
  github: string
  name: string
}

defineProps<{
  adopters: Adopter[]
  /** What people evaluate with Vieval, scrolling in the opposite direction. */
  domains: string[]
  title?: string
}>()

// NOTICE: Each track renders its items several times and scrolls by exactly one copy (see `--copies`),
// so the loop is seamless even with only a handful of adopters on very wide screens.
const COPIES = 4
</script>

<template>
  <div :class="['flex flex-col gap-6', 'py-10 md:py-14']">
    <p v-if="title" :class="['px-5 sm:px-10', 'text-center text-xs text-grey tracking-wide font-mono uppercase']">
      {{ title }}
    </p>

    <div class="marquee" :style="{ '--copies': COPIES }">
      <div class="marquee-track">
        <template v-for="copy in COPIES" :key="copy">
          <a
            v-for="adopter in adopters"
            :key="`${copy}-${adopter.github}`"
            :href="`https://github.com/${adopter.github}`"
            target="_blank"
            rel="noopener noreferrer"
            :aria-hidden="copy > 1 ? 'true' : undefined"
            :tabindex="copy > 1 ? -1 : undefined"
            :class="['flex items-center gap-3', 'px-8', 'text-white/80 hover:text-white', 'transition-colors']"
          >
            <img :src="`https://github.com/${adopter.github}.png?size=80`" :alt="copy > 1 ? '' : adopter.name" width="32" height="32" loading="lazy" class="rounded-lg size-8">
            <span class="text-xl font-sans-title whitespace-nowrap">{{ adopter.name }}</span>
          </a>
        </template>
      </div>
    </div>

    <div class="marquee marquee--reverse" :style="{ '--copies': COPIES }" aria-hidden="true">
      <div class="marquee-track">
        <template v-for="copy in COPIES" :key="copy">
          <span
            v-for="domain in domains"
            :key="`${copy}-${domain}`"
            :class="['flex items-center gap-8', 'pl-8', 'text-sm text-white/40 font-mono whitespace-nowrap']"
          >
            {{ domain }}<span class="text-amber-300/50">◆</span>
          </span>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.marquee {
  overflow: hidden;
  mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
}

.marquee-track {
  display: flex;
  width: max-content;
  animation: marquee 40s linear infinite;
}

.marquee--reverse .marquee-track {
  animation-direction: reverse;
  animation-duration: 55s;
}

.marquee:hover .marquee-track {
  animation-play-state: paused;
}

@keyframes marquee {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(calc(-100% / var(--copies)));
  }
}

@media (prefers-reduced-motion: reduce) {
  .marquee-track {
    animation: none;
  }
}
</style>
