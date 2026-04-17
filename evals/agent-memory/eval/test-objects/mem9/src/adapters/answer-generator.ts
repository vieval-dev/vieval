import type { LoCoMoAnswerGeneratorAdapter } from '@vieval/eval-agent-memory'

import { env } from 'node:process'

export interface OpenAICompatibleAnswerGeneratorOptions {
  apiKey?: string
  baseUrl?: string
  model?: string
}

/**
 * Creates a short-answer generator using OpenAI-compatible chat completions API.
 */
export function createOpenAICompatibleAnswerGenerator(
  options: OpenAICompatibleAnswerGeneratorOptions = {},
): LoCoMoAnswerGeneratorAdapter {
  const apiKey = options.apiKey ?? env.OPENAI_API_KEY ?? ''
  const baseUrl = (options.baseUrl ?? env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = options.model ?? env.OPENAI_MODEL ?? 'gpt-4o-mini'

  return {
    id: 'openai-compatible-answer-generator',
    async generateAnswer(input) {
      const categoryInstruction = input.category === 5
        ? 'If the answer cannot be found in context, reply with exactly: No information available.'
        : 'Answer in a short phrase under 10 words.'

      const response = await fetch(`${baseUrl}/chat/completions`, {
        body: JSON.stringify({
          messages: [
            {
              content: 'You answer LoCoMo QA with concise, factual responses.',
              role: 'system',
            },
            {
              content: [
                `Context:\n${input.contextText}`,
                `Question: ${input.question}`,
                categoryInstruction,
              ].join('\n\n'),
              role: 'user',
            },
          ],
          model,
          temperature: 0,
        }),
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error(`answer generation failed: ${response.status} ${response.statusText}`)
      }

      const payload = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>
      }

      return payload.choices?.[0]?.message?.content?.trim() ?? ''
    },
  }
}
