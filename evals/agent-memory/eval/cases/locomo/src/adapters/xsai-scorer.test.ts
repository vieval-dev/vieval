import { describe, expect, it, vi } from 'vitest'

import { createXsaiLoCoMoScorer } from './xsai-scorer'

describe('createXsaiLoCoMoScorer', () => {
  it('scores category 3 semantic equivalence without replacing canonical scoring', async () => {
    const generateText = vi.fn().mockResolvedValue({
      text: '```json\n{"score":1,"reasoning":"The prediction is a descriptive equivalent of the label."}\n```',
    })
    const scorer = createXsaiLoCoMoScorer({
      generateText,
      model: 'test-model',
    })

    const result = await scorer.scoreAnswer({
      category: 3,
      goldAnswer: 'Liberal',
      prediction: 'standing up for equality',
      question: 'What would Caroline political leaning likely be?',
      sampleId: 'conv-1',
    })

    expect(result.score).toBe(1)
    expect(result.reasoning).toBe('The prediction is a descriptive equivalent of the label.')
    expect(generateText).toHaveBeenCalledOnce()
    const call = generateText.mock.calls[0]?.[0]
    expect(call?.messages[0]?.content).toContain('Category 3')
    expect(call?.messages[1]?.content).toContain('Gold answer: Liberal')
  })

  it('clamps malformed score values and keeps a parseable reasoning string', async () => {
    const generateText = vi.fn().mockResolvedValue({
      text: '{"score":2,"reasoning":"Over-confident but parseable."}',
    })
    const scorer = createXsaiLoCoMoScorer({
      generateText,
      model: 'test-model',
    })

    const result = await scorer.scoreAnswer({
      category: 1,
      goldAnswer: 'plate, bowl, vase',
      prediction: 'plate and bowl',
      question: 'What types of pottery did Melanie make?',
      sampleId: 'conv-1',
    })

    expect(result.score).toBe(1)
    expect(result.reasoning).toBe('Over-confident but parseable.')
  })
})
