<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'

interface HomeAction {
  text?: string
  link?: string
}

interface HomeFeature {
  title?: string
  details?: string
}

interface HomeTerminal {
  title?: string
  code?: string
}

interface HomeWhy {
  eyebrow?: string
  title?: string
  body?: string[]
  action?: HomeAction
}

interface HomeContent {
  logoAlt?: string
  eyebrow?: string
  heroTitle?: string
  heroDescription?: string
  primaryAction?: HomeAction
  secondaryAction?: HomeAction
  terminal?: HomeTerminal
  why?: HomeWhy
  features?: HomeFeature[]
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
    [/^\bpassed\b/, 'success'],
    [/^\bfailed\b/, 'error'],
    [/^\btimeout\b/, 'muted'],
    [/^\b\d+\b/, 'number'],
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
  <div :class="['wrapper wrapper--ticks', 'grid md:grid-cols-2', 'w-full border-nickel divide-x']">
    <section :class="['flex flex-col', 'p-10', 'justify-center items-center md:items-start']">
      <div :class="['flex flex-col gap-5', 'max-w-[32rem]', 'text-center md:text-left', 'items-center md:items-start']">
        <div :class="['flex items-center gap-3']">
          <img src="/logo.svg" :alt="home?.logoAlt ?? ''" class="size-8">
          <span class="text-grey text-xs font-mono uppercase tracking-wide">{{ home?.eyebrow ?? '' }}</span>
        </div>
        <h1 class="text-white text-pretty">
          {{ home?.heroTitle ?? '' }}
        </h1>
        <p class="text-white/70 text-lg max-w-[28rem] text-pretty">
          {{ home?.heroDescription ?? '' }}
        </p>
        <div :class="['flex flex-wrap items-center', 'justify-center md:justify-start', 'gap-5 mt-8']">
          <a :href="home?.primaryAction?.link" class="button button--primary inline-block w-fit">
            <span>{{ home?.primaryAction?.text ?? '' }}</span>
          </a>
          <a
            :href="home?.secondaryAction?.link"
            :target="isExternalLink(home?.secondaryAction?.link) ? '_blank' : undefined"
            :rel="isExternalLink(home?.secondaryAction?.link) ? 'noopener noreferrer' : undefined"
            class="button inline-block w-fit"
          >
            {{ home?.secondaryAction?.text ?? '' }}
          </a>
        </div>
      </div>
    </section>

    <section class="flex flex-col min-h-[22rem] sm:min-h-[30rem]">
      <div class="hero-terminal relative h-full flex flex-col justify-center overflow-clip p-6 sm:p-10">
        <div class="terminal-window">
          <div class="terminal-title">
            <span />
            <span />
            <span />
            <strong>{{ home?.terminal?.title ?? '' }}</strong>
          </div>
          <pre><code><template v-for="(line, lineIndex) in terminalLines" :key="lineIndex"><template v-for="(segment, segmentIndex) in line" :key="segmentIndex"><span :class="segment.tone ? `terminal-${segment.tone}` : undefined">{{ segment.text }}</span></template>{{ lineIndex === terminalLines.length - 1 ? '' : '\n' }}</template></code></pre>
        </div>
      </div>
    </section>
  </div>

  <section class="wrapper wrapper--ticks border-t py-14 lg:py-30 px-5 sm:px-10 lg:px-20">
    <div class="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-5 lg:gap-8 text-left">
      <div class="flex flex-col gap-3 max-w-md">
        <div class="flex gap-3 items-center">
          <img src="/logo.svg" :alt="home?.logoAlt ?? ''" class="size-5">
          <span class="text-grey text-xs font-medium font-mono uppercase tracking-wide">{{ home?.why?.eyebrow ?? '' }}</span>
        </div>
        <h3 class="text-white max-w-xl text-balance">
          {{ home?.why?.title ?? '' }}
        </h3>
        <a :href="home?.why?.action?.link" class="button w-fit mt-8 hidden lg:block">{{ home?.why?.action?.text ?? '' }}</a>
      </div>
      <div class="lg:max-w-lg">
        <p v-for="paragraph in home?.why?.body ?? []" :key="paragraph" class="text-pretty mb-5 last:mb-0">
          {{ paragraph }}
        </p>
        <a :href="home?.why?.action?.link" class="button w-fit mt-8 block lg:hidden">{{ home?.why?.action?.text ?? '' }}</a>
      </div>
    </div>
  </section>

  <section class="feature-grid wrapper wrapper--ticks border-t border-b grid lg:grid-cols-2">
    <article v-for="feature in home?.features ?? []" :key="feature.title" class="feature-card flex flex-col gap-3 min-h-[16rem] p-5 sm:p-10 justify-between">
      <div class="flex flex-col gap-3">
        <h5 class="text-white">
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
    radial-gradient(circle at 72% 28%, rgba(56, 189, 248, 0.28), transparent 18rem),
    linear-gradient(135deg, rgba(17, 24, 39, 0.95), rgba(3, 7, 18, 0.98));
}

.terminal-window {
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 0.5rem;
  background: rgba(3, 7, 18, 0.86);
  box-shadow: 0 2rem 4rem rgba(0, 0, 0, 0.35);
}

.terminal-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.8rem 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.8rem;
}

.terminal-title span {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.32);
}

.terminal-title strong {
  margin-left: auto;
  font-weight: 600;
}

pre {
  margin: 0;
  padding: 1.25rem;
  color: #bae6fd;
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
  color: #facc15;
}

.terminal-badge {
  color: #fde68a;
}

.terminal-muted {
  color: rgba(186, 230, 253, 0.52);
}

.terminal-success {
  color: #86efac;
}

.terminal-error {
  color: #fca5a5;
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
