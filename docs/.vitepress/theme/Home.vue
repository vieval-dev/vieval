<script setup lang="ts">
import type { Component } from 'vue'

import type { Capability } from './home/CapabilityTabs.vue'
import type { ThanksEntry } from './home/OpenSource.vue'
import type { Adopter } from './home/UsedBy.vue'

import { useData } from 'vitepress'
import { computed } from 'vue'

import EvalCode from './home/blocks/EvalCode.vue'
import MatrixExpand from './home/blocks/MatrixExpand.vue'
import ReportCompare from './home/blocks/ReportCompare.vue'
import TraceWaterfall from './home/blocks/TraceWaterfall.vue'
import CapabilityTabs from './home/CapabilityTabs.vue'
import HeroScene from './home/HeroScene.vue'
import HomeFooter from './home/HomeFooter.vue'
import OpenSource from './home/OpenSource.vue'
import UsedBy from './home/UsedBy.vue'

interface HomeAction {
  link?: string
  text?: string
}

interface HomeBlock {
  details?: string
  eyebrow?: string
  title?: string
  /** Key of the large visual; see `visuals`. */
  visual?: VisualKey
}

interface HomeBlocks {
  body?: string
  eyebrow?: string
  items?: HomeBlock[]
  title?: string
}

interface HomeCapabilities {
  eyebrow?: string
  items?: Capability[]
  learnMore?: string
  title?: string
}

interface HomeContent {
  blocks?: HomeBlocks
  capabilities?: HomeCapabilities
  footer?: HomeFooterContent
  heroDescription?: string
  heroTitle?: string
  openSource?: HomeOpenSource
  primaryAction?: HomeAction
  secondaryAction?: HomeAction
  terminal?: HomeTerminal
  usedBy?: HomeUsedBy
}

interface HomeFooterContent {
  action?: HomeAction
  heading?: string
  subheading?: string
}

interface HomeOpenSource {
  action?: HomeAction
  body?: string
  contributorsTitle?: string
  eyebrow?: string
  thanks?: ThanksEntry[]
  title?: string
}

interface HomeTerminal {
  code?: string
  title?: string
}

interface HomeUsedBy {
  adopters?: Adopter[]
  domains?: string[]
  title?: string
}

/** Large visuals that frontmatter blocks can reference by key. */
const visuals = {
  code: EvalCode,
  compare: ReportCompare,
  matrix: MatrixExpand,
  trace: TraceWaterfall,
} satisfies Record<string, Component>

type VisualKey = keyof typeof visuals

const { frontmatter } = useData()

const home = computed(() => frontmatter.value.home as HomeContent | undefined)

function isExternalLink(link?: string) {
  if (!link) {
    return false
  }

  return link.startsWith('http://') || link.startsWith('https://')
}
</script>

<template>
  <div :class="['wrapper wrapper--ticks', 'grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]', 'w-full border-nickel lg:divide-x', 'font-sans']">
    <section :class="['flex flex-col', 'p-10', 'justify-center items-center lg:items-start']">
      <div :class="['flex flex-col gap-5', 'max-w-[32rem]', 'text-center lg:text-left', 'items-center lg:items-start']">
        <span class="text-xs text-grey tracking-wide font-mono uppercase">By Moeru AI</span>
        <h1 class="text-white font-sans-title text-pretty">
          {{ home?.heroTitle ?? '' }}
        </h1>
        <p class="text-lg text-white/70 max-w-[28rem] text-pretty">
          {{ home?.heroDescription ?? '' }}
        </p>
        <div :class="['flex flex-wrap items-center', 'justify-center lg:justify-start', 'gap-5 mt-8']">
          <a :href="home?.primaryAction?.link" class="button button--primary w-fit inline-block">
            <span>{{ home?.primaryAction?.text ?? '' }}</span>
          </a>
          <a
            :href="home?.secondaryAction?.link"
            :target="isExternalLink(home?.secondaryAction?.link) ? '_blank' : undefined"
            :rel="isExternalLink(home?.secondaryAction?.link) ? 'noopener noreferrer' : undefined"
            class="button w-fit inline-block"
          >
            {{ home?.secondaryAction?.text ?? '' }}
          </a>
        </div>
      </div>
    </section>

    <section class="flex flex-col">
      <HeroScene :code="home?.terminal?.code ?? ''" :title="home?.terminal?.title" />
    </section>
  </div>

  <!-- How it works: four large blocks, one per stage of an evaluation -->
  <section :class="['wrapper wrapper--ticks border-t', 'px-5 py-14 sm:px-10 lg:px-20 lg:py-24']">
    <div :class="['flex flex-col gap-4', 'max-w-2xl']">
      <span class="text-xs text-grey tracking-wide font-mono uppercase">{{ home?.blocks?.eyebrow ?? '' }}</span>
      <h2 class="section-title">
        {{ home?.blocks?.title ?? '' }}
      </h2>
      <p class="text-lg text-pretty">
        {{ home?.blocks?.body ?? '' }}
      </p>
    </div>
  </section>
  <section :class="['tile-grid wrapper wrapper--ticks', 'grid gap-px grid-cols-[minmax(0,1fr)] lg:grid-cols-2', 'border-t']">
    <article
      v-for="(block, index) in home?.blocks?.items ?? []"
      :key="block.title"
      :class="['tile', 'flex flex-col gap-8', 'p-5 sm:p-10']"
    >
      <div class="flex flex-col gap-3 max-w-[34rem]">
        <span class="text-xs text-grey tracking-wide font-mono uppercase">
          {{ String(index + 1).padStart(2, '0') }} · {{ block.eyebrow ?? '' }}
        </span>
        <h3 class="text-white font-sans-title text-balance">
          {{ block.title ?? '' }}
        </h3>
        <p class="text-pretty">
          {{ block.details ?? '' }}
        </p>
      </div>
      <div :class="['glass-frame', 'mt-auto', 'flex flex-col justify-center', 'sm:aspect-[16/10]']">
        <component :is="visuals[block.visual]" v-if="block.visual && visuals[block.visual]" />
      </div>
    </article>
  </section>

  <section class="wrapper wrapper--ticks border-t">
    <UsedBy :adopters="home?.usedBy?.adopters ?? []" :domains="home?.usedBy?.domains ?? []" :title="home?.usedBy?.title" />
  </section>

  <section :class="['wrapper wrapper--ticks border-t', 'px-5 py-14 sm:px-10 lg:px-20 lg:py-20']">
    <div class="flex flex-col gap-4 max-w-2xl">
      <span class="text-xs text-grey tracking-wide font-mono uppercase">{{ home?.capabilities?.eyebrow ?? '' }}</span>
      <h2 class="section-title">
        {{ home?.capabilities?.title ?? '' }}
      </h2>
    </div>
  </section>
  <section class="wrapper wrapper--ticks border-t">
    <CapabilityTabs :items="home?.capabilities?.items ?? []" :learn-more="home?.capabilities?.learnMore" />
  </section>

  <section class="wrapper wrapper--ticks border-t">
    <OpenSource
      :action="home?.openSource?.action"
      :body="home?.openSource?.body"
      :contributors-title="home?.openSource?.contributorsTitle"
      :eyebrow="home?.openSource?.eyebrow"
      :thanks="home?.openSource?.thanks ?? []"
      :title="home?.openSource?.title"
    />
  </section>

  <HomeFooter :action="home?.footer?.action" :heading="home?.footer?.heading" :subheading="home?.footer?.subheading" />
</template>

<style scoped>
.button--primary {
  color: #fff7ed;
  text-shadow: 0 1px 0 rgba(12, 10, 9, 0.35);
  transition:
    transform 160ms ease,
    color 160ms ease;
}

.button--primary::before {
  background:
    radial-gradient(circle at 28% 22%, rgba(253, 186, 116, 0.95), transparent 42%),
    linear-gradient(135deg, #fb923c, #ea580c 52%, #292524);
  box-shadow:
    0 0 0 1px rgba(251, 146, 60, 0.24),
    0 0.8rem 2rem rgba(234, 88, 12, 0.24);
}

.button--primary::after {
  background: linear-gradient(135deg, rgba(124, 45, 18, 0.92), rgba(28, 25, 23, 0.96));
}

.button--primary:active {
  transform: translateY(1px) scale(0.985);
}

.button--primary:active::before {
  filter: brightness(108%) saturate(105%);
  transform: scaleX(0.99) scaleY(0.98);
  box-shadow:
    0 0 0 1px rgba(251, 146, 60, 0.2),
    0 0.35rem 1rem rgba(234, 88, 12, 0.18);
}

.button--primary:active::after {
  transform: scaleX(0.985) scaleY(0.97);
}

/* The 1px grid gap shows this background, drawing hairlines between tiles in any column count. */
.tile-grid {
  background: var(--color-nickel);
}

.tile {
  background: var(--vp-c-bg);
}
</style>
