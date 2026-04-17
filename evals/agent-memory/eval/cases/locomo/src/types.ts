import { createHash } from 'node:crypto'

export type LoCoMoCategory = 1 | 2 | 3 | 4 | 5

export interface LoCoMoQuestionAnswer {
  adversarialAnswer: string | null
  answer: number | string
  category: LoCoMoCategory
  evidence: string[]
  question: string
}

export interface LoCoMoSample {
  qa: LoCoMoQuestionAnswer[]
  sampleId: string
}

export interface LoCoMoCase {
  caseId: string
  category: LoCoMoCategory
  evidence: string[]
  goldAnswer: string
  question: string
  sampleId: string
}

/**
 * Creates a stable dataset hash for deterministic cache keys.
 *
 * Use when:
 * - case derivation should be reused across runs
 * - benchmark adapters must share frozen case artifacts
 *
 * Expects:
 * - samples to be deterministic input values
 *
 * Returns:
 * - sha256 hash over canonical JSON string
 */
export function createLoCoMoDatasetHash(samples: readonly LoCoMoSample[]): string {
  return createHash('sha256').update(JSON.stringify(samples)).digest('hex')
}
