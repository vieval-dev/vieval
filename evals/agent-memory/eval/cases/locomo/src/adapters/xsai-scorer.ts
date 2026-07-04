import type { GenerateTextOptions, GenerateTextResult } from '@xsai/generate-text'

import type { LoCoMoScorerAdapter, LoCoMoScorerResult } from '../contracts'
import type { LoCoMoCategory } from '../types'

import { env } from 'node:process'

import { generateText as defaultGenerateText } from '@xsai/generate-text'
import { createOpenAIFromEnv, normalizeOpenAITextOutput } from 'vieval/core/inference-executors'

export interface XsaiLoCoMoScorerOptions {
  apiKey?: string
  baseUrl?: string
  generateText?: (options: GenerateTextOptions) => Promise<GenerateTextResult>
  model?: string
}

/**
 * Creates an OpenAI-compatible LoCoMo diagnostic scorer.
 *
 * Use when:
 * - canonical LoCoMo token scoring should remain unchanged
 * - runs need an additional semantic/time/coverage scorer for error analysis
 *
 * Expects:
 * - the model to return JSON with `score` and optional `reasoning`
 *
 * Returns:
 * - a scorer adapter that emits a diagnostic score in the range `[0, 1]`
 */
export function createXsaiLoCoMoScorer(options: XsaiLoCoMoScorerOptions = {}): LoCoMoScorerAdapter {
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
  const runGenerateText = options.generateText ?? defaultGenerateText

  return {
    id: `xsai-openai-compatible-scorer:${model}`,
    async scoreAnswer(input) {
      const response = await runtime.adapter.runWithRetry(async () => await runGenerateText({
        ...runtime.adapter.provider.chat(runtime.model),
        ...getTokenLimitOptions(model),
        messages: [
          {
            content: [
              'You are a benchmark scorer. Return only JSON: {"score": number, "reasoning": string}.',
              'The score must be 0, 0.5, or 1 unless partial coverage clearly needs another value.',
              'Do not answer the question. Judge whether the prediction should receive credit.',
              getCategoryRubric(input.category),
            ].join('\n'),
            role: 'system',
          },
          {
            content: [
              `Question: ${input.question}`,
              `Gold answer: ${input.goldAnswer}`,
              `Prediction: ${input.prediction}`,
              input.contextText == null ? undefined : `Retrieved context:\n${input.contextText}`,
            ].filter((part): part is string => part != null).join('\n\n'),
            role: 'user',
          },
        ],
        temperature: 0,
      }))

      return parseScorerResult(normalizeOpenAITextOutput(response).trim())
    },
  }
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0
  }

  return Math.min(1, Math.max(0, score))
}

/**
 * Extracts the first JSON object from a model response.
 *
 * Before:
 * - "```json\n{\"score\":1}\n```"
 *
 * After:
 * - "{\"score\":1}"
 */
function extractJsonObjectText(value: string): string {
  const fenced = value.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i)
  if (fenced?.[1] != null) {
    return fenced[1]
  }

  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return value.slice(start, end + 1)
  }

  return value
}

function getCategoryRubric(category: LoCoMoCategory): string {
  switch (category) {
    case 1:
      return [
        'Category 1: score coverage of multiple required facts.',
        'Give partial credit for each required fact from the gold answer that is present in the prediction.',
        'Do not require exact wording, but do require the same concrete people, objects, events, or attributes.',
      ].join('\n')
    case 2:
      return [
        'Category 2: score time equivalence.',
        'Treat equivalent dates, approximate dates, and clearly equivalent relative time expressions as correct.',
        'Penalize wrong days, wrong months, or unsupported time anchors.',
      ].join('\n')
    case 3:
      return [
        'Category 3: score semantic equivalence for multi-hop answers.',
        'Accept concise labels and descriptive phrases when they mean the same answer.',
        'Penalize answers that miss the yes/no polarity, subject, relation, or required conclusion.',
      ].join('\n')
    case 4:
      return [
        'Category 4: score short factual equivalence.',
        'Accept synonyms and paraphrases only when the concrete factual answer is the same.',
        'Penalize broad, vague, or subject-confused answers.',
      ].join('\n')
    case 5:
      return [
        'Category 5: score whether the answer correctly identifies that the question is unsupported.',
        'Give full credit only when the prediction chooses not-mentioned/no-information behavior.',
      ].join('\n')
  }
}

function getTokenLimitOptions(model: string): { max_completion_tokens: number } | { max_tokens: number } {
  if (model.startsWith('gpt-5.5')) {
    return { max_completion_tokens: 128 }
  }

  return { max_tokens: 128 }
}

function parseScorerResult(value: string): LoCoMoScorerResult {
  const parsed: unknown = JSON.parse(extractJsonObjectText(value))
  if (parsed == null || typeof parsed !== 'object') {
    throw new Error('LoCoMo agent scorer returned a non-object JSON value.')
  }

  const record = parsed as Record<string, unknown>
  return {
    reasoning: typeof record.reasoning === 'string' ? record.reasoning : undefined,
    score: clampScore(typeof record.score === 'number' ? record.score : 0),
  }
}
