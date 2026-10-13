<script setup lang="ts">
import { ref } from 'vue'

import MatrixLattice from '../scenes/MatrixLattice.vue'

type Tone = 'key' | 'plain' | 'string'

/**
 * Config lines shown next to the lattice. `step` marks the axis a line declares, matching the expansion
 * steps of {@link MatrixLattice}: 1 = model, 2 = scenario, 3 = rubric. A token's own step (3 = strict scan,
 * 4 = lenient scan) highlights the rubric value currently being evaluated.
 * The shape follows `examples/run-matrix-multi-models/vieval.config.ts`.
 */
const lines: { step?: number, tokens: [text: string, tone: Tone, step?: number][] }[] = [
  { tokens: [['defineConfig', 'key'], ['({', 'plain']] },
  { tokens: [['  projects: [{', 'plain']] },
  { tokens: [['    runMatrix: { extend: {', 'plain']] },
  { step: 1, tokens: [['      model', 'key'], [': [', 'plain'], ['\'gpt\'', 'string'], [', ', 'plain'], ['\'claude\'', 'string'], [', ', 'plain'], ['\'qwen\'', 'string'], [', ', 'plain'], ['\'llama\'', 'string'], ['],', 'plain']] },
  { step: 2, tokens: [['      scenario', 'key'], [': [', 'plain'], ['\'cold\'', 'string'], [', ', 'plain'], ['\'warm\'', 'string'], [', ', 'plain'], ['\'noisy\'', 'string'], ['],', 'plain']] },
  { tokens: [['    } },', 'plain']] },
  { tokens: [['    evalMatrix: { extend: {', 'plain']] },
  { step: 3, tokens: [['      rubric', 'key'], [': [', 'plain'], ['\'strict\'', 'string', 3], [', ', 'plain'], ['\'lenient\'', 'string', 4], ['],', 'plain']] },
  { tokens: [['    } },', 'plain']] },
  { tokens: [['  }],', 'plain']] },
  { tokens: [['})', 'plain']] },
]

/** Expansion step the lattice is showing; the matching config line is highlighted. -1 before it starts. */
const step = ref(-1)
</script>

<template>
  <div :class="['grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] items-center', 'font-mono text-[0.7rem] sm:text-[0.74rem]']">
    <div :class="['p-5 sm:pr-0', 'overflow-x-auto']">
      <div class="text-white/40 mb-3">
        vieval.config.ts
      </div>
      <pre class="leading-[1.8em] m-0"><code><span
        v-for="(line, index) in lines"
        :key="index"
        :class="[
          'block whitespace-pre rounded px-1 -mx-1',
          'transition-colors duration-300',
          line.step !== undefined && line.step <= step ? 'bg-amber-300/10' : '',
          line.step === step || (line.step === 3 && step === 4) ? 'outline outline-1 outline-amber-300/50' : '',
        ]"
      ><span v-for="([text, tone, tokenStep], tokenIndex) in line.tokens" :key="tokenIndex" :class="[`code-${tone}`, tokenStep === step ? 'rounded-sm bg-amber-300/25 text-amber-100' : '']">{{ text }}</span></span></code></pre>
    </div>
    <MatrixLattice @step="step = $event" />
  </div>
</template>

<style scoped>
.code-key {
  color: #fcd34d;
}

.code-string {
  color: #a7f3d0;
}

.code-plain {
  color: rgba(255, 255, 255, 0.72);
}

pre code {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: inherit;
}
</style>
