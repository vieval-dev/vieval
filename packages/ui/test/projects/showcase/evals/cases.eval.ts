import process from 'node:process'

import { setTimeout as delay } from 'node:timers/promises'

import { caseOf, describeTask, expect } from 'vieval'

import { modelOf, seeded } from './shared'

// Runs with different `SHOWCASE_SEED` values get different scores, so experiment and attempt comparisons show changes.
const seed = process.env.SHOWCASE_SEED ?? ''

const categories = ['math', 'reading', 'coding', 'planning'] as const

// 64 cheap cases: a long case list with metrics and scores that differ by model.
const items = Array.from({ length: 64 }, (_, index) => ({
  category: categories[index % categories.length],
  id: `${categories[index % categories.length]}/item-${String(index + 1).padStart(3, '0')}`,
  question: `Question ${index + 1}`,
}))

describeTask('cases', () => {
  for (const item of items) {
    caseOf(item.id, async (context) => {
      const model = modelOf(context)
      // model-b is weaker: lower scores and more failures.
      const skill = model === 'mock:model-a' ? 0.85 : 0.6
      const noise = seeded(`${model}:${item.id}:${seed}`)
      const steps = 3 + Math.floor(noise * 4)

      for (let step = 1; step <= steps; step += 1) {
        await delay(20 + Math.floor(seeded(`${item.id}:${step}`) * 60))
        context.recordMetric('latency_ms', Math.round(100 + seeded(`${model}:${item.id}:${step}`) * 900))
        context.recordMetric('tokens', Math.round(50 + seeded(`${item.id}:${step}:tokens`) * 450))
      }

      const exact = Math.min(1, Math.max(0, Math.round((skill + (noise - 0.5) * 0.6) * 100) / 100))
      const judge = Math.min(1, Math.max(0, Math.round((skill + (noise - 0.5) * 0.3 + 0.05) * 100) / 100))
      context.recordMetric('finish_reason', noise > 0.9 ? 'length' : 'stop')
      context.recordMetric('cached', noise < 0.3)
      context.recordMetric('tools_used', noise > 0.5 ? ['search', 'calculator'] : ['search'])
      context.recordScore(exact, 'exact')
      context.recordScore(judge, 'judge')
      console.info(`${item.id}: ${steps} steps, exact=${exact}, judge=${judge}`)

      expect(exact, `${item.id} scored below the pass threshold`).toBeGreaterThanOrEqual(0.4)
      return { answer: `answer to ${item.question}`, exact, judge, steps }
    }, { input: { category: item.category, question: item.question } })
  }
})
