import type { HeadlineResult, ScoreSummary } from '../scoring'
import type { ScheduledTaskMatrix } from './schedule'

import { emptyScoreSummary, poolScoreSummaries, resolveHeadline } from '../scoring'

/**
 * Score summaries of the runs of one inference executor.
 */
export interface AggregatedProviderSummary extends AggregatedScoreSummary {
  /**
   * Stable inferenceExecutor id.
   */
  inferenceExecutorId: string
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
  overall: AggregatedScoreSummary
  /**
   * Per-run summaries.
   */
  runs: AggregatedRunSummary[]
}

/**
 * Score summaries of one run.
 */
export interface AggregatedRunSummary {
  /**
   * Completion rate of the run, or `null` when the task did not report its cases.
   */
  completion: null | ScoreSummary
  /**
   * Collected eval entry id.
   */
  entryId: string
  /**
   * Stable run id.
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
   * Share of passed cases, or `null` when the task did not report its cases.
   */
  passed: null | ScoreSummary
  /**
   * Name of the run's headline score, when it has one.
   */
  primary?: string
  /**
   * One summary per score of the run.
   */
  scores: ScoreSummary[]
}

/**
 * Score summaries pooled over a group of runs: one inference executor, or every run.
 */
export interface AggregatedScoreSummary {
  /**
   * Completion rate pooled over the runs that reported their cases, or `null` when none did.
   */
  completion: null | ScoreSummary
  /**
   * Headline of the group, resolved with {@link resolveHeadline}.
   */
  headline: HeadlineResult
  /**
   * Number of runs in the group.
   */
  runCount: number
  /**
   * Each score pooled by name over the runs, in first-seen order.
   */
  scores: ScoreSummary[]
}

/**
 * Captures the output of one scheduled runner task.
 */
export interface RunResult {
  /**
   * Completion rate of the run, when the task reports its cases (the task DSL always does).
   */
  completion?: ScoreSummary
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
   * Share of passed cases, when the task reports its cases.
   */
  passed?: ScoreSummary
  /**
   * Name of the run's headline score, when it has one.
   */
  primary?: string
  /**
   * One summary per score emitted by the eval.
   */
  scores: readonly ScoreSummary[]
}

/**
 * Pools the score summaries of runner results per run, per inference executor, and overall.
 *
 * Call stack:
 *
 * {@link runScheduledTasks}
 *   -> {@link aggregateRunResults}
 *     -> {@link poolScoreSummaries}
 *     -> {@link resolveHeadline}
 *       -> `run-summary.json`
 *
 * Use when:
 * - a runner batch ends and its runs are summarized for reports, the CLI, and comparisons
 *
 * Expects:
 * - score values in `0..1`; summaries of one name pool their cases, so a large run weighs more than a small one
 *
 * Returns:
 * - per-run summaries, per-executor summaries sorted by id, and the overall summary, each group with its headline
 */
export function aggregateRunResults(results: readonly RunResult[]): AggregatedRunResults {
  const inferenceExecutorIds = Array.from(new Set(results.map(result => result.inferenceExecutorId))).sort()

  return {
    inferenceExecutors: inferenceExecutorIds.map(inferenceExecutorId => ({
      inferenceExecutorId,
      ...summarizeGroup(results.filter(result => result.inferenceExecutorId === inferenceExecutorId)),
    })),
    overall: summarizeGroup(results),
    runs: results.map(result => ({
      completion: result.completion ?? null,
      entryId: result.entryId,
      id: result.id,
      inferenceExecutorId: result.inferenceExecutorId,
      matrix: cloneScheduledTaskMatrix(result.matrix),
      passed: result.passed ?? null,
      ...(result.primary == null ? {} : { primary: result.primary }),
      scores: [...result.scores],
    })),
  }
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

function summarizeGroup(results: readonly RunResult[]): AggregatedScoreSummary {
  const completions = results.flatMap(result => result.completion == null ? [] : [result.completion])
  return {
    completion: completions.length === 0 ? null : poolScoreSummaries(completions)[0]!,
    // A run is one task under one matrix row, so its eval entry identifies the task for per-task headlines.
    headline: resolveHeadline(results.map(result => ({
      completion: result.completion ?? emptyScoreSummary('completion'),
      passed: result.passed ?? emptyScoreSummary('passed'),
      ...(result.primary == null ? {} : { primary: result.primary }),
      scores: [...result.scores],
      taskId: result.entryId,
    }))),
    runCount: results.length,
    scores: poolScoreSummaries(results.flatMap(result => result.scores)),
  }
}
