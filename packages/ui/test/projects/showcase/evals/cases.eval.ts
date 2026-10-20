import process from 'node:process'

import { setTimeout as delay } from 'node:timers/promises'

import { caseOf, defineScore, describeTask, expect } from 'vieval'

import { modelOf, seeded } from './shared'

// Runs with different `SHOWCASE_SEED` values get different scores, so experiment and attempt comparisons show changes.
const seed = process.env.SHOWCASE_SEED ?? ''

const categories = ['math', 'reading', 'coding', 'planning'] as const

const correct = defineScore('showcase.correct', {
  description: { 'en': 'How close the answer is to the reference answer.', 'zh-Hans': '答案与参考答案的接近程度。' },
  grader: { id: 'matcher', kind: 'rule', version: '1' },
  label: { 'en': 'Correct answer', 'zh-Hans': '答案正确' },
})
const quality = defineScore('showcase.quality', {
  description: { 'en': 'The judge rates how clear and complete the answer is.', 'zh-Hans': '评委评价答案是否清楚、完整。' },
  grader: { id: 'judge', kind: 'model', model: 'mock:judge' },
  label: { 'en': 'Answer quality', 'zh-Hans': '回答质量' },
})
const pass = defineScore('showcase.pass', {
  // A bare input passes at 1, so a partly correct answer fails unless its threshold allows it.
  combine: { all: [{ atLeast: 0.7, score: correct }, { atLeast: 0.6, score: quality }] },
  description: { 'en': 'The answer is at least 70% correct and the judge rates it at least 0.6.', 'zh-Hans': '答案至少 70% 正确，且评委评分不低于 0.6。' },
  label: { 'en': 'Pass', 'zh-Hans': '通过' },
  primary: true,
})

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

      const correctness = Math.min(1, Math.max(0, Math.round((skill + (noise - 0.5) * 0.6) * 100) / 100))
      const rating = Math.min(1, Math.max(0, Math.round((skill + (noise - 0.5) * 0.3 + 0.05) * 100) / 100))
      context.recordMetric('finish_reason', noise > 0.9 ? 'length' : 'stop')
      context.recordMetric('cached', noise < 0.3)
      context.recordMetric('tools_used', noise > 0.5 ? ['search', 'calculator'] : ['search'])
      context.recordScore(correct, correctness, { rationale: `${Math.round(correctness * 100)}% of the reference terms appear in the answer.` })
      // A few answers cut off by the length limit leave the judge without a verdict: unscored, not a wrong answer.
      if (noise > 0.95) {
        context.recordUnscored(quality, 'invalid_response', { rationale: 'The judge reply had no rating.' })
      }
      else {
        context.recordScore(quality, rating, { metadata: { votes: [rating, rating] }, rationale: rating >= 0.6 ? 'Clear and complete.' : 'Misses part of the question.' })
      }
      console.info(`${item.id}: ${steps} steps, correct=${correctness}, quality=${rating}`)

      expect(correctness, `${item.id} scored below the pass threshold`).toBeGreaterThanOrEqual(0.4)
      return { answer: `answer to ${item.question}`, correct: correctness, quality: rating, steps }
    }, { input: { category: item.category, question: item.question } })
  }
}, { scores: [correct, quality, pass] })
