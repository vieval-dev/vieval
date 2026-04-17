import type { LoCoMoAnswerGeneratorAdapter } from '../contracts.ts'
import type { LoCoMoCategory } from '../types.ts'

import { env } from 'node:process'

import { generateText } from '@xsai/generate-text'
import { createOpenAIFromEnv, normalizeOpenAITextOutput } from 'vieval/core/inference-executors'

export interface XsaiLoCoMoAnswerGeneratorOptions {
  apiKey?: string
  baseUrl?: string
  model?: string
}

function getCategoryInstruction(category: LoCoMoCategory): string {
  if (category === 5) {
    // Python parity:
    // Category 5 uses a dedicated short-answer template in
    // `snap-research/locomo/task_eval/gpt_utils.py:31-35`.
    return 'Return only the selected option or option text with no extra explanation.'
  }

  // Python parity:
  // Default QA path uses short-phrase answers in
  // `snap-research/locomo/task_eval/gpt_utils.py:25-29`.
  return 'Answer in a short phrase under 10 words.'
}

/**
 * Creates a LoCoMo answer generator backed by `@xsai/generate-text`.
 *
 * Use when:
 * - LoCoMo cases should run with OpenAI-compatible providers in a shared adapter
 * - workspaces need consistent prompt scaffolding and retry behavior
 *
 * Expects:
 * - API key/base URL/model to be configured via options or process env
 *
 * Returns:
 * - benchmark-compatible answer generator adapter
 */
export function createXsaiLoCoMoAnswerGenerator(
  options: XsaiLoCoMoAnswerGeneratorOptions = {},
): LoCoMoAnswerGeneratorAdapter {
  const apiKey = options.apiKey ?? env.OPENAI_API_KEY ?? ''
  const baseUrl = (options.baseUrl ?? env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = options.model ?? env.OPENAI_MODEL ?? 'openai/gpt-4o-mini'

  const runtime = createOpenAIFromEnv({
    env: {
      ...env,
      OPENAI_API_KEY: apiKey,
      OPENAI_BASE_URL: baseUrl,
      OPENAI_MODEL: model,
    },
  })

  return {
    id: 'xsai-openai-compatible-answer-generator',
    async generateAnswer(input) {
      const response = await runtime.adapter.runWithRetry(async () => await generateText({
        ...runtime.adapter.provider.chat(runtime.model),
        max_tokens: 64,
        messages: [
          {
            content: 'You answer LoCoMo QA with concise, factual responses.',
            role: 'system',
          },
          {
            content: [
              `Context:\n${input.contextText}`,
              `Question: ${input.question}`,
              getCategoryInstruction(input.category),
            ].join('\n\n'),
            role: 'user',
          },
        ],
        temperature: 0,
      }))

      return normalizeOpenAITextOutput(response).trim()
    },
  }
}
