import type { Grader, LocalizedText, ScoreDefinedData } from '../events'
import type { Announcements } from './announcements'

/**
 * How a derived score combines other scores of the same case try. The runtime computes it when the try settles.
 */
export type ScoreCombination
  = | {
    /**
     * 1 when every input reaches its threshold, else 0. A bare input passes at 1; `{ score, atLeast }` sets a lower
     * threshold, for example `{ score: natural, atLeast: 0.5 }`.
     */
    all: ReadonlyArray<ScoreRef | { atLeast: number, score: ScoreRef }>
  }
  | {
    /** The mean of the inputs. */
    mean: readonly ScoreRef[]
  }
  | {
    /** The mean weighted by `weight`; weights are normalized. */
    weighted: ReadonlyArray<{ score: ScoreRef, weight: number }>
  }

/**
 * One score declared once with {@link defineScore}; pass it to `context.recordScore` instead of its name.
 */
export interface ScoreDefinition extends ScoreMetadata {
  /** Score name written to `score.recorded`. */
  readonly name: string
}

/**
 * Label, description, and scoring rules of one score, as shown by viewers.
 */
export interface ScoreMetadata {
  /**
   * Derives this score from other scores of the same case try. A case cannot record a derived score.
   */
  combine?: ScoreCombination
  /**
   * What the score measures and how to read it. One string, or one per BCP 47 locale.
   */
  description?: LocalizedText
  /**
   * How an errored or timed-out case counts. `exclude` leaves it out, and the completion rate shows how many were
   * left out. `zero` counts it as 0.
   *
   * @default 'exclude'
   */
  errors?: 'exclude' | 'zero'
  /**
   * What usually produces the value. A record can override it, for example when the judge model is a matrix axis.
   */
  grader?: Grader
  /**
   * Name shown instead of the score name. One string, or one per BCP 47 locale.
   */
  label?: LocalizedText
  /**
   * Whether this is the headline score of its task: pages, leaderboards, and comparisons show it first. At most one
   * score of a task is primary. A task with exactly one score uses it without this flag.
   *
   * @default false
   */
  primary?: boolean
}

/**
 * Why a recorded score has its value, and what produced it.
 */
export interface ScoreRecordOptions {
  /**
   * What produced this value. Overrides the definition's `grader`.
   */
  grader?: Grader
  /**
   * Other details of the value, shown as an object tree.
   */
  metadata?: Record<string, unknown>
  /**
   * Why the score has this value: a judge's reasoning, or the rule that matched. Shown next to the value.
   */
  rationale?: string
}

/**
 * One score: a definition from {@link defineScore}, or a bare score name without metadata.
 */
export type ScoreRef = ScoreDefinition | string

/**
 * Announces score definitions for one task and enforces one primary score per task.
 *
 * Use when:
 * - a task starts (its `scores` option) or a case records a definition for the first time
 *
 * Expects:
 * - `announcements` to be the task's tracker, shared by every case of the task
 *
 * Returns:
 * - the `score.defined` payloads to emit, in order: inputs of a derived score come before it
 *
 * Throws:
 * - when a second score of the task is primary
 */
export function announceScore(announcements: Announcements<ScoreDefinedData>, score: ScoreDefinition): ScoreDefinedData[] {
  const emitted: ScoreDefinedData[] = []
  const visit = (definition: ScoreDefinition) => {
    for (const input of combinationInputs(definition.combine)) {
      if (typeof input.score !== 'string') {
        visit(input.score)
      }
    }
    const defined = toScoreDefinedData(definition)
    const otherPrimary = defined.primary === true
      ? announcements.latest().find(existing => existing.primary === true && existing.name !== defined.name)
      : undefined
    if (otherPrimary != null) {
      throw new Error(`Score "${defined.name}" is primary, but score "${otherPrimary.name}" of the same task already is.`)
    }
    if (announcements.announce(defined)) {
      emitted.push(defined)
    }
  }
  visit(score)
  return emitted
}

/**
 * Declares one score with the text viewers show for it and the rules that compute it.
 *
 * Use when:
 * - a task measures a quality of each case as a value in `0..1`, where higher is better
 * - a headline score combines other scores, for example "correct and natural"
 *
 * Expects:
 * - `name` to be the stable score identifier
 * - `combine` thresholds in `0..1` and weights of zero or more
 *
 * Returns:
 * - a frozen definition; pass it to `context.recordScore(definition, value)`, or list it in the `scores` option of
 *   `describeTask` so a derived or never-recorded score is known before the first case
 *
 * @example
 * const correct = defineScore('formula.correct', { label: { 'en': 'Correct', 'zh-Hans': '正确' } })
 * const natural = defineScore('formula.natural', { grader: { kind: 'model', id: 'judge' } })
 * const pass = defineScore('formula.pass', { combine: { all: [correct, natural] }, primary: true })
 * context.recordScore(correct, 1)
 */
export function defineScore(name: string, metadata: ScoreMetadata = {}): ScoreDefinition {
  const combine = metadata.combine
  if (combine != null) {
    const inputs = 'all' in combine ? combine.all : 'mean' in combine ? combine.mean : combine.weighted
    if (inputs.length === 0) {
      throw new Error(`Score "${name}" combines no scores.`)
    }
    if ('all' in combine) {
      for (const input of combine.all) {
        if (typeof input === 'object' && 'atLeast' in input && (!Number.isFinite(input.atLeast) || input.atLeast < 0 || input.atLeast > 1)) {
          throw new Error(`Score "${name}" has an "all" threshold outside 0..1: ${String(input.atLeast)}.`)
        }
      }
    }
    if ('weighted' in combine && combine.weighted.some(input => !Number.isFinite(input.weight) || input.weight < 0)) {
      throw new Error(`Score "${name}" has a negative or non-finite weight.`)
    }
  }
  return Object.freeze({ ...metadata, name })
}

/**
 * Returns the name of a score reference.
 */
export function scoreNameOf(score: ScoreRef): string {
  return typeof score === 'string' ? score : score.name
}

function combinationInputs(combine: ScoreCombination | undefined): Array<{ atLeast?: number, score: ScoreRef, weight?: number }> {
  if (combine == null) {
    return []
  }
  if ('all' in combine) {
    return combine.all.map(input => typeof input === 'object' && 'atLeast' in input ? input : { score: input })
  }
  if ('mean' in combine) {
    return combine.mean.map(score => ({ score }))
  }
  return [...combine.weighted]
}

/**
 * Normalizes a score definition into its `score.defined` payload.
 *
 * Before:
 * - `{ name: 'pass', combine: { all: [correct, { score: natural, atLeast: 0.5 }] }, primary: true }`
 *
 * After:
 * - `{ name: 'pass', combine: { kind: 'all', inputs: [{ name: 'correct' }, { name: 'natural', atLeast: 0.5 }] }, primary: true }`
 */
function toScoreDefinedData(definition: ScoreDefinition): ScoreDefinedData {
  const { combine, ...rest } = definition
  if (combine == null) {
    return { ...rest }
  }
  const kind = 'all' in combine ? 'all' : 'mean' in combine ? 'mean' : 'weighted'
  return {
    ...rest,
    combine: {
      inputs: combinationInputs(combine).map(input => ({
        ...(input.atLeast == null ? {} : { atLeast: input.atLeast }),
        name: scoreNameOf(input.score),
        ...(input.weight == null ? {} : { weight: input.weight }),
      })),
      kind,
    },
  }
}
