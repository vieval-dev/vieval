<script setup lang="ts">
import { useData } from 'vitepress'
import { computed } from 'vue'

interface HomeAction {
  link?: string
  text?: string
}

interface HomeContent {
  eyebrow?: string
  features?: HomeFeature[]
  heroDescription?: string
  heroTitle?: string
  logoAlt?: string
  primaryAction?: HomeAction
  secondaryAction?: HomeAction
  terminal?: HomeTerminal
  why?: HomeWhy
}

interface HomeFeature {
  details?: string
  title?: string
}

interface HomeTerminal {
  code?: string
  title?: string
}

interface HomeWhy {
  action?: HomeAction
  body?: string[]
  eyebrow?: string
  title?: string
}

interface TerminalSegment {
  text: string
  tone?: 'accent' | 'badge' | 'error' | 'muted' | 'number' | 'success'
}

const { frontmatter } = useData()

const home = computed(() => frontmatter.value.home as HomeContent | undefined)

const terminalLines = computed(() => (home.value?.terminal?.code ?? '').split('\n').map(tokenizeTerminalLine))

function isExternalLink(link?: string) {
  if (!link) {
    return false
  }

  return link.startsWith('http://') || link.startsWith('https://')
}

function tokenizeTerminalLine(line: string): TerminalSegment[] {
  if (line.startsWith('$')) {
    return [
      { text: '$', tone: 'muted' },
      { text: line.slice(1) },
    ]
  }

  const patterns: [RegExp, TerminalSegment['tone']][] = [
    [/^RUN\b/, 'accent'],
    [/^✓/, 'success'],
    [/^\|[^|]+\|/, 'badge'],
    [/^\([^)]*\)/, 'muted'],
    [/^report .*$/, 'muted'],
    [/^matrix run\b/, 'muted'],
    [/^\s\|\s/, 'muted'],
    [/^passed\b/, 'success'],
    [/^failed\b/, 'error'],
    [/^timeout\b/, 'muted'],
    [/^\d+\b/, 'number'],
  ]

  const segments: TerminalSegment[] = []
  let rest = line

  while (rest.length > 0) {
    const match = patterns
      .map(([pattern, tone]) => ({ match: pattern.exec(rest), tone }))
      .find(({ match }) => match)

    if (match?.match) {
      const [text] = match.match
      segments.push({ text, tone: match.tone })
      rest = rest.slice(text.length)
      continue
    }

    let nextIndex = rest.length

    for (let index = 1; index < rest.length; index++) {
      if (patterns.some(([pattern]) => pattern.test(rest.slice(index)))) {
        nextIndex = index
        break
      }
    }

    segments.push({ text: rest.slice(0, nextIndex) })
    rest = rest.slice(nextIndex)
  }

  return segments
}
</script>

<template>
  <div :class="['wrapper wrapper--ticks', 'grid md:grid-cols-2', 'w-full border-nickel divide-x', 'font-sans']">
    <section :class="['flex flex-col', 'p-10', 'justify-center items-center md:items-start']">
      <div :class="['flex flex-col gap-5', 'max-w-[32rem]', 'text-center md:text-left', 'items-center md:items-start']">
        <div :class="['flex items-center gap-3']">
          <span class="text-xs text-grey tracking-wide font-mono uppercase">By Moeru AI</span>
        </div>
        <h1 class="text-white font-sans-title text-pretty">
          {{ home?.heroTitle ?? '' }}
        </h1>
        <p class="text-lg text-white/70 max-w-[28rem] text-pretty">
          {{ home?.heroDescription ?? '' }}
        </p>
        <div :class="['flex flex-wrap items-center', 'justify-center md:justify-start', 'gap-5 mt-8']">
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

    <section class="flex flex-col min-h-[22rem] sm:min-h-[30rem]">
      <div class="hero-terminal p-6 flex flex-col h-full justify-center relative overflow-clip sm:p-10">
        <div class="terminal-window">
          <div class="terminal-title">
            <span />
            <span />
            <span />
            <strong>Terminal</strong>
          </div>
          <pre><code><template v-for="(line, lineIndex) in terminalLines" :key="lineIndex"><template v-for="(segment, segmentIndex) in line" :key="segmentIndex"><span :class="segment.tone ? `terminal-${segment.tone}` : undefined">{{ segment.text }}</span></template>{{ lineIndex === terminalLines.length - 1 ? '' : '\n' }}</template></code></pre>
        </div>
      </div>
    </section>
  </div>

  <section class="wrapper wrapper--ticks px-5 py-14 border-t lg:px-20 lg:py-30 sm:px-10">
    <div class="text-left flex flex-col gap-5 lg:flex-row lg:gap-8 lg:items-center lg:justify-between">
      <div class="flex flex-col gap-3 max-w-md">
        <div class="flex gap-3 items-center">
          <img src="/vieval-logo.svg" :alt="home?.logoAlt ?? ''" class="size-5">
          <span class="text-xs text-grey tracking-wide font-medium font-mono uppercase">{{ home?.why?.eyebrow ?? '' }}</span>
        </div>
        <h3 class="text-white max-w-xl text-balance">
          {{ home?.why?.title ?? '' }}
        </h3>
        <a :href="home?.why?.action?.link" class="button mt-8 w-fit hidden lg:block">{{ home?.why?.action?.text ?? '' }}</a>
      </div>
      <div class="lg:max-w-lg">
        <p v-for="paragraph in home?.why?.body ?? []" :key="paragraph" class="mb-5 text-pretty last:mb-0">
          {{ paragraph }}
        </p>
        <a :href="home?.why?.action?.link" class="button mt-8 w-fit block lg:hidden">{{ home?.why?.action?.text ?? '' }}</a>
      </div>
    </div>
  </section>

  <section class="feature-grid wrapper wrapper--ticks border-b border-t grid lg:grid-cols-2">
    <article v-for="feature in home?.features ?? []" :key="feature.title" class="feature-card p-5 flex flex-col gap-3 min-h-[16rem] justify-between sm:p-10">
      <div class="flex flex-col gap-3">
        <h5 class="text-white font-sans-title">
          {{ feature.title ?? '' }}
        </h5>
        <p class="max-w-[30rem] text-pretty">
          {{ feature.details ?? '' }}
        </p>
      </div>
      <div class="feature-preview" aria-hidden="true">
        <span>{{ (feature.title ?? '').slice(0, 2).toUpperCase() }}</span>
      </div>
    </article>
  </section>
</template>

<style scoped>
.hero-terminal {
  background:
    radial-gradient(circle at 72% 28%, rgba(251, 146, 60, 0.34), transparent 18rem),
    radial-gradient(circle at 28% 72%, rgba(234, 88, 12, 0.18), transparent 16rem),
    linear-gradient(135deg, rgba(41, 37, 36, 0.96), rgba(12, 10, 9, 0.98));
}

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

.terminal-window {
  overflow: hidden;
  border: 1px solid rgba(120, 113, 108, 0.24);
  border-radius: 0.5rem;
  background: rgba(12, 10, 9, 0.9);
  box-shadow: 0 2rem 4rem rgba(12, 10, 9, 0.42);
}

.terminal-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.8rem 1rem;
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
  padding: 1.25rem;
  color: #d6d3d1;
  font-size: 0.94rem;
  line-height: 1.8;
  white-space: pre-wrap;
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

.feature-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 8rem;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0.5rem;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.08), transparent 45%),
    rgba(255, 255, 255, 0.03);
}

.feature-preview span {
  color: rgba(255, 255, 255, 0.22);
  font-size: 4rem;
  font-weight: 800;
  line-height: 1;
}

.feature-card {
  border-color: var(--color-nickel);
}

@media (min-width: 1024px) {
  .feature-card:nth-child(odd) {
    border-right-width: 1px;
  }

  .feature-card:nth-child(n + 3) {
    border-top-width: 1px;
  }
}

@media (max-width: 1023px) {
  .feature-card + .feature-card {
    border-top-width: 1px;
  }
}
</style>
