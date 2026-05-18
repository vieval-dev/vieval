import { describe, expect, it, vi } from 'vitest'

import { createXsaiLoCoMoAnswerGenerator } from './xsai-answer-generator'

const generateTextMock = vi.hoisted(() => vi.fn())

vi.mock('@xsai/generate-text', () => ({
  generateText: generateTextMock,
}))

vi.mock('vieval/core/inference-executors', () => ({
  createOpenAIFromEnv: () => ({
    adapter: {
      provider: {
        chat: () => ({}),
      },
      runWithRetry: async (operation: () => Promise<unknown>) => await operation(),
    },
    model: 'test-model',
  }),
  normalizeOpenAITextOutput: (response: unknown) => String(response),
}))

describe('createXsaiLoCoMoAnswerGenerator', () => {
  it('uses the LoCoMo short-answer prompt with exact-context wording', async () => {
    generateTextMock.mockResolvedValue('7 May 2023')

    const generator = createXsaiLoCoMoAnswerGenerator({
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      model: 'test-model',
    })

    await generator.generateAnswer({
      caseId: 'conv-26::1',
      category: 2,
      contextText: 'DATE: 7 May 2023\nCaroline went to the group.',
      question: 'When did Caroline go? Use DATE of CONVERSATION to answer with an approximate date.',
      sampleId: 'conv-26',
    })

    const payload = generateTextMock.mock.calls[0]?.[0]
    expect(payload?.messages[1]?.content).toContain('Answer with exact words from the context whenever possible.')
    expect(payload?.messages[1]?.content).toContain('Answer in a short phrase under 10 words.')
  })
})
