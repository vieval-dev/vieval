import { setTimeout as delay } from 'node:timers/promises'

import { caseOf, describeTask, expect } from 'vieval'

// Printed while the eval module loads, outside every case: it is not grouped.
console.info('[module] episodes.eval.ts loaded')

const episodes = [
  { name: 'chrome/open-settings', stepMs: 700, steps: 4 },
  { name: 'gimp/resize-image', stepMs: 1100, steps: 3 },
  // More than 10 lines: its finished block shows `[N lines collapsed]` above the last 10.
  { name: 'libreoffice/sum-column', stepMs: 250, steps: 14 },
  // Fails on purpose: a failed case keeps its full output, like a failed pnpm script.
  { fails: true, name: 'vscode/rename-symbol', stepMs: 450, steps: 6 },
]

describeTask('episodes', () => {
  for (const episode of episodes) {
    caseOf(episode.name, async (context) => {
      const repeat = context.task.matrix.run.repeat
      console.info(`[${episode.name}#${repeat}] pod created`)

      for (let step = 1; step <= episode.steps; step += 1) {
        await delay(episode.stepMs)
        console.info(`[${episode.name}#${repeat}] step ${step}/${episode.steps}: click (${step * 100}, ${step * 50})`)
      }

      if (episode.fails) {
        console.warn(`[${episode.name}#${repeat}] evaluator: symbol still has the old name`)
      }

      console.info(`[${episode.name}#${repeat}] pod deleted`)
      expect(episode.fails === true ? 0 : 1).toBe(1)
    })
  }
})
