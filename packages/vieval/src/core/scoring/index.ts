/**
 * How many settled cases produced a result.
 */
export interface CaseCoverage {
  /**
   * Cases that ended `passed` or `failed`: they produced a result, right or wrong.
   */
  measured: number
  /**
   * Cases that settled: `passed`, `failed`, `errored`, or `timeout`. Skipped and running cases are not counted.
   */
  total: number
}

/**
 * Scores of a group of case outcomes, for example one task.
 */
export interface CaseOutcomeScores {
  /**
   * Measured and settled case counts. `strictExact` equals `exact * measured / total`.
   */
  coverage: CaseCoverage
  /**
   * Mean exact score of the measured cases, or `null` when no case produced a result.
   */
  exact: null | number
  /**
   * Mean of `exact` and `judge` when both exist, otherwise the one that exists.
   */
  hybrid: null | number
  /**
   * Mean judge score of the passed cases that recorded one, or `null`.
   */
  judge: null | number
  /**
   * Mean exact score of all settled cases, where a case without a result scores `0`, or `null` when nothing settled.
   * It mixes the quality of the results with the reliability of the run; read it next to `coverage`.
   */
  strictExact: null | number
}

/**
 * Terminal state of one case try, as `case.ended` reports it.
 *
 * - `passed`: the case ran to the end without a failed assertion
 * - `failed`: an assertion failed, so the case measured a wrong result
 * - `errored`: the case threw something other than an assertion (a provider error, a bug, an interrupt), so it
 *   measured nothing
 * - `timeout`: the case ran out of time, so it measured nothing
 * - `skipped`: the case did not run
 */
export type CaseOutcomeState = 'errored' | 'failed' | 'passed' | 'skipped' | 'timeout'

/**
 * One settled case outcome with the scores that it recorded.
 */
export interface ScoredCaseOutcome {
  /**
   * Scores recorded by `recordScore`, keyed by kind. Only a `passed` outcome reads them.
   */
  scores: { exact?: number, judge?: number }
  /**
   * Terminal state of the outcome.
   */
  state: CaseOutcomeState
}

/**
 * Combines an exact and a judge mean into one hybrid score.
 *
 * Returns:
 * - their mean when both exist, otherwise the one that exists, otherwise `null`
 */
export function hybridAverage(exact: null | number, judge: null | number): null | number {
  if (exact != null && judge != null) {
    return (exact + judge) / 2
  }

  return exact ?? judge
}

/**
 * Returns whether a case outcome produced a result.
 *
 * Use when:
 * - counting coverage or deciding whether an outcome enters the main score
 *
 * Returns:
 * - `true` for `passed` and `failed`; `false` for `errored`, `timeout`, and `skipped`
 */
export function isMeasuredState(state: CaseOutcomeState): boolean {
  return state === 'passed' || state === 'failed'
}

/**
 * Scores a group of case outcomes with the scoring rule of vieval.
 *
 * Use when:
 * - a task, the CLI, or the viewer turns case outcomes into task scores; all of them use this one rule
 *
 * Expects:
 * - only settled outcomes; running outcomes are left out by the caller
 * - every outcome of every attempt, so repeated attempts each add evidence
 *
 * Returns:
 * - `exact` over measured outcomes: a passed outcome scores its recorded exact score, or `1` without one; a failed
 *   outcome scores `0`; errored, timed-out, and skipped outcomes do not enter it
 * - `strictExact` over all settled outcomes, where errored and timed-out outcomes score `0`
 * - `coverage` with the measured and settled counts
 */
export function scoreCaseOutcomes(outcomes: readonly ScoredCaseOutcome[]): CaseOutcomeScores {
  const exactScores: number[] = []
  const judgeScores: number[] = []
  let total = 0

  for (const outcome of outcomes) {
    if (outcome.state === 'skipped') {
      continue
    }

    total += 1
    if (outcome.state === 'failed') {
      exactScores.push(0)
      continue
    }
    if (outcome.state !== 'passed') {
      continue
    }

    exactScores.push(outcome.scores.exact ?? 1)
    if (outcome.scores.judge != null) {
      judgeScores.push(outcome.scores.judge)
    }
  }

  const exact = average(exactScores)
  const judge = average(judgeScores)
  const coverage = { measured: exactScores.length, total }

  return {
    coverage,
    exact,
    hybrid: hybridAverage(exact, judge),
    judge,
    strictExact: strictExactOf(exact, coverage),
  }
}

/**
 * Scores a group with every settled case in the denominator.
 *
 * Use when:
 * - only the measured mean and the coverage of a group are known, for example when combining task results
 *
 * Returns:
 * - `exact * measured / total`; `0` when cases settled but none produced a result; `null` when nothing settled
 */
export function strictExactOf(exact: null | number, coverage: CaseCoverage): null | number {
  if (coverage.total === 0) {
    return null
  }

  return (exact ?? 0) * coverage.measured / coverage.total
}

function average(values: readonly number[]): null | number {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}
