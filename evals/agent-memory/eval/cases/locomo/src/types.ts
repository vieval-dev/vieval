import { createHash } from 'node:crypto'

export type LoCoMoCategory = 1 | 2 | 3 | 4 | 5

/**
 * Canonical LoCoMo QA item schema.
 *
 * Python parity:
 * - Base fields (`question`, `answer`, `category`, `evidence`) are read in
 *   `snap-research/locomo/task_eval/evaluate_qa.py:98-103`
 *   and scored in `snap-research/locomo/task_eval/evaluation.py:199-239`.
 * - `adversarialAnswer` is a local normalized extension for adapters; Snap scoring
 *   does not read this field directly.
 */
export interface LoCoMoQuestionAnswer {
  adversarialAnswer: string | null
  answer: number | string
  category: LoCoMoCategory
  evidence: string[]
  question: string
}

/**
 * Canonical LoCoMo sample schema.
 *
 * Python parity:
 * - Mirrors dataset sample shape loaded in
 *   `snap-research/locomo/task_eval/evaluate_qa.py:67-85`
 *   where `sample_id` and `qa` are the source keys.
 */
export interface LoCoMoSample {
  qa: LoCoMoQuestionAnswer[]
  sampleId: string
}

/**
 * Flattened, per-question LoCoMo case shape used by Vieval runners.
 *
 * Python parity:
 * - `sampleId`, `question`, `category`, `goldAnswer` map to QA entries processed in
 *   `snap-research/locomo/task_eval/evaluate_qa.py:98-103`
 *   and scored by category in `snap-research/locomo/task_eval/evaluation.py:203-221`.
 * - `caseId` is a deterministic local identifier for scheduling/caching.
 */
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
