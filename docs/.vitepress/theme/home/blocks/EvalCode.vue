<script setup lang="ts">
import { createTimeline, utils } from 'animejs'
import { ref } from 'vue'

import { useSceneAnimation } from '../useSceneAnimation'

type Tone = 'comment' | 'function' | 'keyword' | 'plain' | 'string'

/** Tokens per line of the sample eval file; the shape follows `docs/content/en/guide/learn/tasks-cases-and-inputs.md`. */
const lines: [string, Tone][][] = [
  [['import', 'keyword'], [' { describeTask, expect } ', 'plain'], ['from', 'keyword'], [' \'vieval\'', 'string']],
  [],
  [['const', 'keyword'], [' inputs = ', 'plain'], ['await', 'keyword'], [' loadEpisodes', 'function'], ['(', 'plain'], ['\'s3://evals\'', 'string'], [')', 'plain']],
  [],
  [['describeTask', 'function'], ['(', 'plain'], ['\'desktop\'', 'string'], [', ({ casesFromInputs }) => {', 'plain']],
  [['  casesFromInputs', 'function'], ['(', 'plain'], ['\'episode\'', 'string'], [', inputs, ', 'plain'], ['async', 'keyword'], [' (ctx) => {', 'plain']],
  [['    const', 'keyword'], [' { task, goal } = ctx.matrix.inputs', 'plain']],
  [['    const', 'keyword'], [' run = ', 'plain'], ['await', 'keyword'], [' agent.', 'plain'], ['play', 'function'], ['(task)', 'plain']],
  [['    expect', 'function'], ['(run.state).', 'plain'], ['toEqual', 'function'], ['(goal)', 'plain']],
  [['    ctx.', 'plain'], ['recordScore', 'function'], ['(', 'plain'], ['await', 'keyword'], [' judge', 'function'], ['(run))', 'plain']],
  [['  })', 'plain']],
  [['})', 'plain']],
]

/** Lines each case passes through, in order: read inputs, run the agent, assert, score. */
const CASE_LINES = [6, 7, 8, 9]
const LINE_HEIGHT_EM = 1.8
const BEAT = 420

/** One input item each; `casesFromInputs` turns every item into one case that runs the same callback. */
const cases = [
  { id: 'chrome/open-tab', passed: true, task: 'Open a new tab' },
  { id: 'gimp/resize', passed: true, task: 'Resize to 800px' },
  { id: 'vscode/rename', passed: false, task: 'Rename a symbol' },
  { id: 'calc/sum-cells', passed: true, task: 'Sum column B' },
]

const root = ref<HTMLElement>()

useSceneAnimation(root, () => {
  const chips = utils.$('.code-case')
  const marks = utils.$('.code-case-mark')

  const timeline = createTimeline({ defaults: { ease: 'outQuad' }, loop: true, loopDelay: 1400 })
    .set('.code-highlight', { opacity: 0, translateY: `${CASE_LINES[0] * LINE_HEIGHT_EM}em` })
    .set(chips, { opacity: 0.35 })
    .set('.code-case-glow', { opacity: 0 })
    .set(marks, { opacity: 0, scale: 0.4 })

  // Every case takes the same path through the callback; the highlighted chip is the case currently running.
  cases.forEach((_, index) => {
    const start = `case-${index}`
    timeline
      .label(start, index === 0 ? 300 : '+=260')
      .add(chips[index], { duration: 240, opacity: 1 }, start)
      .add(`.code-case-glow-${index}`, { duration: 240, opacity: 1 }, start)
      .add('.code-highlight', { duration: 200, opacity: 1 }, start)

    CASE_LINES.forEach((line, step) => {
      timeline.add('.code-highlight', { duration: 260, ease: 'inOutCubic', translateY: `${line * LINE_HEIGHT_EM}em` }, `${start}+=${step * BEAT}`)
    })

    timeline
      .add(marks[index], { duration: 280, ease: 'outBack', opacity: 1, scale: 1 }, `${start}+=${CASE_LINES.length * BEAT - 120}`)
      .add(`.code-case-glow-${index}`, { duration: 300, opacity: 0 }, `${start}+=${CASE_LINES.length * BEAT}`)
  })

  timeline.add('.code-highlight', { duration: 300, opacity: 0 }, '+=200')

  return [timeline]
})
</script>

<template>
  <div ref="root" :class="['relative', 'grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_10.5rem]', 'font-mono text-[0.7rem] sm:text-[0.74rem]']">
    <div :class="['relative min-w-0', 'p-5', 'overflow-x-auto']">
      <div :class="['flex items-center gap-2', 'mb-4', 'text-white/40']">
        <span>evals/</span><span class="text-white/70">desktop.eval.ts</span>
      </div>
      <div class="relative">
        <div :class="['code-highlight', 'absolute inset-x-[-0.5rem] top-0', 'h-[1.8em]', 'rounded bg-amber-300/10 border-l-2 border-amber-300']" style="opacity: 0" />
        <pre :class="['relative m-0', 'leading-[1.8em]', 'text-white/80']"><code><span v-for="(line, index) in lines" :key="index" class="min-h-[1.8em] block whitespace-pre"><span v-for="([text, tone], tokenIndex) in line" :key="tokenIndex" :class="`code-${tone}`">{{ text }}</span></span></code></pre>
      </div>
    </div>

    <div :class="['hidden sm:flex flex-col gap-2', 'p-5 pl-0']">
      <span class="text-white/40 mb-2">inputs → cases</span>
      <div
        v-for="(item, index) in cases"
        :key="item.id"
        :class="['code-case', 'relative', 'flex flex-col gap-0.5', 'px-2.5 py-1.5', 'rounded-md border border-white/10 bg-white/4']"
      >
        <span :class="['code-case-glow', `code-case-glow-${index}`, 'absolute inset-0 rounded-md', 'border border-amber-300/60 bg-amber-300/8 shadow-[0_0_18px_rgba(251,191,36,0.18)]']" style="opacity: 0" />
        <span class="flex gap-2 items-center justify-between relative">
          <span class="text-white/80 truncate">{{ item.id }}</span>
          <span :class="['code-case-mark', 'inline-block', item.passed ? 'text-emerald-300' : 'text-orange-400']">{{ item.passed ? '✓' : '✗' }}</span>
        </span>
        <span class="text-[0.62rem] text-white/40 font-sans truncate relative">{{ item.task }}</span>
      </div>
      <span class="text-white/30 mt-1">+ 408 more</span>
    </div>
  </div>
</template>

<style scoped>
.code-keyword {
  color: #fca5a5;
}

.code-function {
  color: #fcd34d;
}

.code-string {
  color: #a7f3d0;
}

.code-comment {
  color: rgba(255, 255, 255, 0.35);
}

.code-plain {
  color: rgba(255, 255, 255, 0.78);
}

pre code {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: inherit;
}

.code-case-mark {
  transform-origin: center;
}
</style>
