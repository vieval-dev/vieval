import type { LoCoMoCase, LoCoMoSample } from '../types.ts'

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Repository-local fallback dataset for smoke-sized LoCoMo runs.
 *
 * Use when:
 * - `LOCOMO_DATA_FILE` is not set
 * - tests and examples need a portable default that does not depend on a local clone path
 *
 * Expects:
 * - full benchmark runs to pass `LOCOMO_DATA_FILE` with a complete `locomo10.json`
 *
 * Returns:
 * - absolute path to the checked-in first-sample fixture
 */
export const DEFAULT_LOCOMO_DATA_FILE = fileURLToPath(new URL('./fixtures/locomo10-first-sample.json', import.meta.url))

interface LoCoMoRawQuestionAnswer {
  adversarial_answer?: string
  answer?: number | string
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
  return parseLoCoMoSamplesFromSnapJson(rawContent, args.maxSamples)
}

/**
 * Loads Snap LoCoMo dataset JSON synchronously and returns normalized sample objects.
 *
 * Use when:
 * - eval DSL cases must be registered during module evaluation
 * - async top-level case discovery is not available
 *
 * Expects:
 * - `dataFile` to be readable before the task module is imported
 *
 * Returns:
 * - normalized sample objects ready for deterministic case derivation
 */
export function loadLoCoMoSamplesFromSnapDatasetSync(args: {
  dataFile: string
  maxSamples?: number
}): LoCoMoSample[] {
  // The Vieval DSL registers cases while importing task modules, so this
  // synchronous read keeps dynamic case registration inside the current DSL.
  const rawContent = readFileSync(args.dataFile, 'utf8')
  return parseLoCoMoSamplesFromSnapJson(rawContent, args.maxSamples)
}

function parseLoCoMoSamplesFromSnapJson(rawContent: string, maxSamples?: number): LoCoMoSample[] {
  const rawSamples = JSON.parse(rawContent) as LoCoMoRawSample[]
  const limitedRawSamples = maxSamples == null ? rawSamples : rawSamples.slice(0, maxSamples)

  const normalizedSamples: LoCoMoSample[] = limitedRawSamples.map(sample => ({
    qa: sample.qa.map(qa => ({
      // Python parity:
      // Category 5 entries use `answer`, then `adversarial_answer`, then
      // `Unknown` as the distractor option in `task_eval/gpt_utils.py:281-289`;
      // scoring still only checks whether the final prediction says the answer
      // is not mentioned.
      adversarialAnswer: qa.adversarial_answer ?? null,
      answer: qa.answer ?? qa.adversarial_answer ?? (qa.category === 5 ? 'Unknown' : ''),
      category: qa.category,
      evidence: qa.evidence ?? [],
      question: qa.question,
    })),
    sampleId: sample.sample_id,
  }))

  return normalizedSamples
}
