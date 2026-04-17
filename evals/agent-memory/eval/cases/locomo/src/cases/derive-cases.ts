import type { LoCoMoCase, LoCoMoSample } from '../types'

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
  return samples.flatMap(sample => sample.qa.map((qa, index) => ({
    caseId: `${sample.sampleId}::${index + 1}`,
    category: qa.category,
    evidence: [...qa.evidence],
    goldAnswer: String(qa.answer),
    question: qa.question,
    sampleId: sample.sampleId,
  })))
}
