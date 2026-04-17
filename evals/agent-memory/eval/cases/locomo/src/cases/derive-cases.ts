import type { LoCoMoCase, LoCoMoSample } from '../types.ts'

import { readFile } from 'node:fs/promises'

interface LoCoMoRawQuestionAnswer {
  answer: number | string
  category: LoCoMoCase['category']
  evidence?: string[]
  question: string
}

interface LoCoMoRawSample {
  qa: LoCoMoRawQuestionAnswer[]
  sample_id: string
}

/**
 * Derives normalized LoCoMo QA cases from dataset samples.
 *
 * Use when:
 * - adapters need one normalized case shape independent of source dataset format
 *
 * Expects:
 * - sample ids to be stable and unique per sample
 *
 * Returns:
 * - flat list of normalized QA cases with deterministic case ids
 */
export function deriveLoCoMoCases(samples: readonly LoCoMoSample[]): LoCoMoCase[] {
  // Python parity:
  // Snap stores QA per sample (`sample_id` + `qa`) and then iterates each QA
  // for generation/scoring in `task_eval/evaluate_qa.py:78-105`.
  // We flatten to deterministic per-QA cases while preserving the same fields.
  return samples.flatMap(sample => sample.qa.map((qa, index) => ({
    caseId: `${sample.sampleId}::${index + 1}`,
    category: qa.category,
    evidence: [...qa.evidence],
    goldAnswer: String(qa.answer),
    question: qa.question,
    sampleId: sample.sampleId,
  })))
}

/**
 * Reads Snap LoCoMo dataset JSON and derives canonical QA cases.
 *
 * Use when:
 * - eval tasks need to reproduce case generation from `snap-research/locomo`
 *
 * Expects:
 * - `dataFile` to point at `locomo10.json`-compatible schema (`sample_id`, `qa`)
 *
 * Returns:
 * - flat list of normalized LoCoMo cases, optionally limited to first N samples
 */
export async function deriveLoCoMoCasesFromSnapDataset(args: {
  dataFile: string
  maxSamples?: number
}): Promise<LoCoMoCase[]> {
  const normalizedSamples = await loadLoCoMoSamplesFromSnapDataset(args)
  return deriveLoCoMoCases(normalizedSamples)
}

/**
 * Loads Snap LoCoMo dataset JSON and returns normalized sample objects.
 */
export async function loadLoCoMoSamplesFromSnapDataset(args: {
  dataFile: string
  maxSamples?: number
}): Promise<LoCoMoSample[]> {
  const rawContent = await readFile(args.dataFile, 'utf8')
  const rawSamples = JSON.parse(rawContent) as LoCoMoRawSample[]
  const limitedRawSamples = args.maxSamples == null ? rawSamples : rawSamples.slice(0, args.maxSamples)

  const normalizedSamples: LoCoMoSample[] = limitedRawSamples.map(sample => ({
    qa: sample.qa.map(qa => ({
      // Python parity:
      // `locomo10.json` QA entries do not provide an explicit `adversarial_answer` field;
      // category 5 handling is prompt/scorer-driven (`task_eval/gpt_utils.py:243-257`,
      // `task_eval/evaluation.py:217-221`).
      adversarialAnswer: null,
      answer: qa.answer,
      category: qa.category,
      evidence: qa.evidence ?? [],
      question: qa.question,
    })),
    sampleId: sample.sample_id,
  }))

  return normalizedSamples
}
