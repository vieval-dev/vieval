import type { CaseCoverage } from '../scoring'
import type { ScheduledTaskMatrix } from './schedule'

import { hybridAverage, strictExactOf } from '../scoring'

/**
 * Stores inferenceExecutor-level score aggregates across multiple runs.
 */
export interface AggregatedProviderSummary {
  /**
   * Measured and settled cases summed over the runs, or `null` when no run reported its cases.
   */
  coverage: CaseCoverage | null
  /**
   * Mean of all exact-match scores over measured cases, or `null` when absent.
   */
  exactAverage: null | number
  /**
   * Hybrid average derived from the inferenceExecutor exact and judge means.
   */
  hybridAverage: null | number
  /**
   * Stable inferenceExecutor id.
   */
  inferenceExecutorId: string
  /**
   * Mean of all judge-based scores or `null` when absent.
   */
  judgeAverage: null | number
  /**
   * Number of runs included in this inferenceExecutor bucket.
   */
  runCount: number
  /**
   * Mean of the per-run strict exact scores, where a case without a result scores `0`, or `null` when absent.
   */
  strictExactAverage: null | number
}

/**
 * Stores the final aggregation output for a batch of runner results.
 */
export interface AggregatedRunResults {
  /**
   * Provider-level summaries sorted by inferenceExecutor id.
   */
  inferenceExecutors: AggregatedProviderSummary[]
  /**
   * Overall summary across every run.
   */
  overall: Omit<AggregatedProviderSummary, 'inferenceExecutorId'>
  /**
   * Per-run normalized score summaries.
   */
  runs: AggregatedRunSummary[]
}

/**
 * Stores the per-run score averages after normalization.
 */
export interface AggregatedRunSummary {
  /**
   * Measured and settled cases of this run, or `null` when the task did not report its cases.
   */
  coverage: CaseCoverage | null
  /**
   * Collected eval entry id.
   */
  entryId: string
  /**
   * Mean of exact-match scores over measured cases, or `null` when absent.
   */
  exactAverage: null | number
  /**
   * Hybrid average. Uses both families when present, otherwise falls back to the
   * single available family.
   */
  hybridAverage: null | number
  /**
   * Stable run id.
   */
  id: string
  /**
   * Stable inferenceExecutor id.
   */
  inferenceExecutorId: string
  /**
   * Mean of judge-based scores or `null` when absent.
   */
  judgeAverage: null | number
  /**
   * Concrete matrix selection used by the run.
   */
  matrix: ScheduledTaskMatrix
  /**
   * Mean of the per-run strict exact scores, where a case without a result scores `0`, or `null` when absent.
   */
  strictExactAverage: null | number
}

/**
 * Captures the output of one scheduled runner task.
 */
export interface RunResult {
  /**
   * Measured and settled cases of the run, when the task reports them (the task DSL always does).
   */
  coverage?: CaseCoverage
  /**
   * Collected eval entry id.
   */
  entryId: string
  /**
   * Stable run id, usually copied from the scheduled task id.
   */
  id: string
  /**
   * Stable inferenceExecutor id.
   */
  inferenceExecutorId: string
  /**
   * Concrete matrix selection used by the run.
   */
  matrix: ScheduledTaskMatrix
  /**
   * Raw scores emitted by the eval.
   */
  scores: readonly RunScore[]
}

/**
 * Represents one normalized score emitted by a completed eval run.
 */
export interface RunScore {
  /**
   * Score family used for aggregation.
   */
  kind: RunScoreKind
  /**
   * Normalized score in the `0..1` range.
   */
  score: number
}

/**
 * Identifies the scoring family for a single eval score.
 */
export type RunScoreKind = 'exact' | 'judge'

interface ScoreBuckets {
  exact: number[]
  judge: number[]
}

/**
 * Aggregates exact-match and judge-based scores into hybrid runner summaries.
 *
 * Call stack:
 *
 * {@link runScheduledTasks}
 *   -> {@link aggregateRunResults}
 *     -> {@link createRunSummary}
 *     -> {@link createProviderSummary}
 *       -> `report output`
 *
 * Use when:
 * - a runner batch mixes deterministic exact checks with judge-based grading
 * - inferenceExecutor comparison should preserve both score families and one hybrid view
 *
 * Expects:
 * - each score to be normalized to the `0..1` range before aggregation
 * - `scores.kind` to use only `'exact'` or `'judge'`
 */
export function aggregateRunResults(results: readonly RunResult[]): AggregatedRunResults {
  const runs = results.map(createRunSummary)

  const inferenceExecutorIds = Array.from(new Set(results.map(result => result.inferenceExecutorId)))
  const inferenceExecutors = inferenceExecutorIds
    .map((inferenceExecutorId) => {
      const providerResults = results.filter(result => result.inferenceExecutorId === inferenceExecutorId)
      return createProviderSummary(inferenceExecutorId, providerResults)
    })
    .sort((left, right) => left.inferenceExecutorId.localeCompare(right.inferenceExecutorId))

  const overall = createProviderSummary(
    'overall',
    results,
  )

  const { inferenceExecutorId: _overallId, ...overallSummary } = overall

  return {
    inferenceExecutors,
    overall: overallSummary,
    runs,
  }
}

function assertKnownScoreKind(kind: string): RunScoreKind {
  if (kind === 'exact' || kind === 'judge') {
    return kind
  }

  throw new TypeError(`Unknown eval score kind "${kind}".`)
}

function average(scores: readonly number[]): null | number {
  if (scores.length === 0) {
    return null
  }

  const total = scores.reduce((sum, score) => sum + score, 0)
  return total / scores.length
}

function cloneScheduledTaskMatrix(matrix: ScheduledTaskMatrix): ScheduledTaskMatrix {
  return {
    eval: {
      ...matrix.eval,
    },
    meta: {
      ...matrix.meta,
    },
    run: {
      ...matrix.run,
    },
  }
}

function collectScoreBuckets(scores: readonly RunScore[]): ScoreBuckets {
  const buckets: ScoreBuckets = {
    exact: [],
    judge: [],
  }

  for (const score of scores) {
    const kind = assertKnownScoreKind(score.kind)

    if (kind === 'exact') {
      buckets.exact.push(score.score)
      continue
    }

    buckets.judge.push(score.score)
  }

  return buckets
}

function createProviderSummary(inferenceExecutorId: string, results: readonly RunResult[]): AggregatedProviderSummary {
  const exactScores: number[] = []
  const judgeScores: number[] = []
  const strictExactScores: number[] = []
  const coverages = results.flatMap(result => result.coverage == null ? [] : [result.coverage])

  for (const result of results) {
    const buckets = collectScoreBuckets(result.scores)
    exactScores.push(...buckets.exact)
    judgeScores.push(...buckets.judge)

    strictExactScores.push(...strictExactScoresOf(buckets.exact, result.coverage))
  }

  const exactAverage = average(exactScores)
  const judgeAverage = average(judgeScores)

  return {
    coverage: coverages.length === 0
      ? null
      : {
          measured: coverages.reduce((sum, coverage) => sum + coverage.measured, 0),
          total: coverages.reduce((sum, coverage) => sum + coverage.total, 0),
        },
    exactAverage,
    hybridAverage: hybridAverage(exactAverage, judgeAverage),
    inferenceExecutorId,
    judgeAverage,
    runCount: results.length,
    strictExactAverage: average(strictExactScores),
  }
}

function createRunSummary(result: RunResult): AggregatedRunSummary {
  const buckets = collectScoreBuckets(result.scores)
  const exactAverage = average(buckets.exact)
  const judgeAverage = average(buckets.judge)

  return {
    coverage: result.coverage == null ? null : { ...result.coverage },
    entryId: result.entryId,
    exactAverage,
    hybridAverage: hybridAverage(exactAverage, judgeAverage),
    id: result.id,
    inferenceExecutorId: result.inferenceExecutorId,
    judgeAverage,
    matrix: cloneScheduledTaskMatrix(result.matrix),
    strictExactAverage: runStrictExact(exactAverage, result.coverage),
  }
}

/**
 * Strict exact score of one run. A run without coverage (a custom executor) has no unmeasured cases to count,
 * so its strict score equals its exact score.
 */
function runStrictExact(exactAverage: null | number, coverage: CaseCoverage | undefined): null | number {
  return coverage == null ? exactAverage : strictExactOf(exactAverage, coverage)
}

/**
 * Exact scores of one run scaled to strict scores, so pooling them across runs mirrors how `exactAverage` pools the
 * exact scores: each score shrinks by the run's measured share, and a run that settled cases without measuring any
 * adds one `0`.
 */
function strictExactScoresOf(exactScores: readonly number[], coverage: CaseCoverage | undefined): number[] {
  if (coverage == null) {
    return [...exactScores]
  }
  if (coverage.total === 0) {
    return []
  }
  if (exactScores.length === 0) {
    return [0]
  }

  return exactScores.map(score => score * coverage.measured / coverage.total)
}
