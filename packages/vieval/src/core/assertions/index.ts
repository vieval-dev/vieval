import type { RunScore, RunScoreKind } from '../runner/aggregate'

/**
 * Stores mutable evaluation state for stateful assertion flows.
 *
 * Use when:
 * - assertions need to share counters, rolling metrics, or memoized values
 * - a scenario evaluates multiple steps and expects state-aware checks
 */
export type AssertionState = Map<string, unknown>

/**
 * Represents one tool call emitted by a model response.
 */
export interface ToolCall {
  /**
   * Tool name used by the call.
   */
  name: string
  /**
   * Tool arguments payload.
   */
  args: unknown
}

/**
 * Normalized assertion context for one model output.
 */
export interface AssertionContext {
  /**
   * Plain text model output used by text assertions.
   */
  text: string
  /**
   * Optional structured output parsed from the model response.
   */
  structuredOutput?: unknown
  /**
   * Optional tool calls extracted from the model response.
   */
  toolCalls?: readonly ToolCall[]
  /**
   * Shared mutable state for stateful assertion measurement.
   */
  state: AssertionState
}

/**
 * Result for one assertion evaluation.
 */
export interface AssertionOutcome {
  /**
   * Stable assertion id.
   */
  id: string
  /**
   * Assertion family emitted as run score kind.
   */
  scoreKind: RunScoreKind
  /**
   * Whether the assertion passed.
   */
  pass: boolean
  /**
   * Normalized score in the `0..1` range.
   */
  score: number
  /**
   * Human-readable reason for logs and reports.
   */
  reason: string
}

/**
 * Async assertion function used by eval scenarios.
 */
export type Assertion = (context: AssertionContext) => Promise<AssertionOutcome>

/**
 * Normalizes text for matching.
 *
 * Before: `"  Hello\nWorld  "`
 * After: `"hello world"`
 */
export function normalizeMatchText(value: string, caseSensitive: boolean): string {
  const compactedWhitespace = value.trim().replaceAll(/\s+/g, ' ')

  if (caseSensitive) {
    return compactedWhitespace
  }

  return compactedWhitespace.toLowerCase()
}

function clampScore(score: number): number {
  if (Number.isNaN(score)) {
    return 0
  }

  if (score < 0) {
    return 0
  }

  if (score > 1) {
    return 1
  }

  return score
}

function createOutcome(
  id: string,
  scoreKind: RunScoreKind,
  pass: boolean,
  score: number,
  reason: string,
): AssertionOutcome {
  return {
    id,
    pass,
    reason,
    score: clampScore(score),
    scoreKind,
  }
}

/**
 * Options for include-keyword assertions.
 */
export interface MustIncludeAssertionOptions {
  /**
   * Stable assertion id.
   */
  id: string
  /**
   * Keywords that must be present.
   */
  keywords: readonly string[]
  /**
   * Match mode for keywords.
   *
   * @default 'all'
   */
  mode?: 'all' | 'any'
  /**
   * Case-sensitive matching toggle.
   *
   * @default false
   */
  caseSensitive?: boolean
}

/**
 * Creates an assertion that requires specific keywords in model text.
 *
 * Example:
 * `expectMustInclude({ id: 'tone', keywords: ['calm', 'move'] })`
 */
export function expectMustInclude(options: MustIncludeAssertionOptions): Assertion {
  return async (context) => {
    if (options.keywords.length === 0) {
      return createOutcome(options.id, 'exact', true, 1, 'No required keywords configured.')
    }

    const caseSensitive = options.caseSensitive ?? false
    const normalizedText = normalizeMatchText(context.text, caseSensitive)
    const matches = options.keywords.filter((keyword) => {
      const normalizedKeyword = normalizeMatchText(keyword, caseSensitive)
      return normalizedText.includes(normalizedKeyword)
    })

    const mode = options.mode ?? 'all'
    const pass = mode === 'all'
      ? matches.length === options.keywords.length
      : matches.length > 0

    const score = options.keywords.length === 0 ? 1 : matches.length / options.keywords.length

    return createOutcome(
      options.id,
      'exact',
      pass,
      score,
      pass
        ? `Matched ${matches.length}/${options.keywords.length} required keywords.`
        : `Matched ${matches.length}/${options.keywords.length} required keywords.`,
    )
  }
}

/**
 * Options for exclude-keyword assertions.
 */
export interface MustExcludeAssertionOptions {
  /**
   * Stable assertion id.
   */
  id: string
  /**
   * Keywords that must not appear.
   */
  keywords: readonly string[]
  /**
   * Case-sensitive matching toggle.
   *
   * @default false
   */
  caseSensitive?: boolean
}

/**
 * Creates an assertion that forbids specific keywords.
 *
 * Example:
 * `expectMustExclude({ id: 'no-engine-dump', keywords: ['bestmove', 'ponder'] })`
 */
export function expectMustExclude(options: MustExcludeAssertionOptions): Assertion {
  return async (context) => {
    if (options.keywords.length === 0) {
      return createOutcome(options.id, 'exact', true, 1, 'No excluded keywords configured.')
    }

    const caseSensitive = options.caseSensitive ?? false
    const normalizedText = normalizeMatchText(context.text, caseSensitive)
    const forbiddenMatches = options.keywords.filter((keyword) => {
      const normalizedKeyword = normalizeMatchText(keyword, caseSensitive)
      return normalizedText.includes(normalizedKeyword)
    })

    const pass = forbiddenMatches.length === 0
    const score = pass ? 1 : 0

    return createOutcome(
      options.id,
      'exact',
      pass,
      score,
      pass
        ? 'No forbidden keywords found.'
        : `Forbidden keywords found: ${forbiddenMatches.join(', ')}`,
    )
  }
}

/**
 * Options for regular-expression assertions.
 */
export interface RegexAssertionOptions {
  /**
   * Stable assertion id.
   */
  id: string
  /**
   * Pattern to apply to model text.
   */
  pattern: RegExp
}

/**
 * Creates an assertion based on a regular expression.
 *
 * Example:
 * `expectRegex({ id: 'starts-with-act', pattern: /^<\|ACT:/ })`
 */
export function expectRegex(options: RegexAssertionOptions): Assertion {
  return async (context) => {
    const pass = options.pattern.test(context.text)

    return createOutcome(
      options.id,
      'exact',
      pass,
      pass ? 1 : 0,
      pass ? 'Regex matched response text.' : `Regex did not match: ${options.pattern}`,
    )
  }
}

/**
 * Options for structured-output assertions.
 */
export interface StructuredOutputAssertionOptions<TValue> {
  /**
   * Stable assertion id.
   */
  id: string
  /**
   * Runtime validator for structured output.
   */
  validate: (value: unknown) => value is TValue
  /**
   * Optional failure reason.
   */
  failureReason?: string
}

/**
 * Creates an assertion for structured model output.
 *
 * Example:
 * `expectStructuredOutput({ id: 'json-shape', validate: isMySchema })`
 */
export function expectStructuredOutput<TValue>(options: StructuredOutputAssertionOptions<TValue>): Assertion {
  return async (context) => {
    const pass = options.validate(context.structuredOutput)

    return createOutcome(
      options.id,
      'exact',
      pass,
      pass ? 1 : 0,
      pass ? 'Structured output matched validator.' : (options.failureReason ?? 'Structured output validation failed.'),
    )
  }
}

/**
 * Options for tool-call argument assertions.
 */
export interface ToolCallArgsAssertionOptions {
  /**
   * Stable assertion id.
   */
  id: string
  /**
   * Tool name to inspect.
   */
  toolName: string
  /**
   * Runtime validator for tool arguments.
   */
  validate: (args: unknown) => boolean
}

/**
 * Creates an assertion for validating tool-call arguments.
 *
 * Example:
 * `expectToolCallArgs({ id: 'spark-command-shape', toolName: 'builtIn_sparkCommand', validate: isSparkArgs })`
 */
export function expectToolCallArgs(options: ToolCallArgsAssertionOptions): Assertion {
  return async (context) => {
    const targetCall = (context.toolCalls ?? []).find(call => call.name === options.toolName)

    if (targetCall == null) {
      return createOutcome(options.id, 'exact', false, 0, `Missing tool call: ${options.toolName}`)
    }

    const pass = options.validate(targetCall.args)

    return createOutcome(
      options.id,
      'exact',
      pass,
      pass ? 1 : 0,
      pass ? `Tool call args validated for ${options.toolName}.` : `Tool call args validation failed for ${options.toolName}.`,
    )
  }
}

/**
 * Rubric judge result returned by teacher-model or rubric logic.
 */
export interface RubricJudgeResult {
  /**
   * Normalized score in the `0..1` range.
   */
  score: number
  /**
   * Judge explanation text.
   */
  reason: string
  /**
   * Optional judge model id.
   */
  judgeModel?: string
}

/**
 * Options for rubric assertions.
 */
export interface RubricAssertionOptions {
  /**
   * Stable assertion id.
   */
  id: string
  /**
   * Async rubric judge callback.
   */
  judge: (context: AssertionContext) => Promise<RubricJudgeResult>
  /**
   * Minimum passing score.
   *
   * @default 0.7
   */
  minScore?: number
}

/**
 * Creates a rubric assertion driven by teacher-model style scoring.
 *
 * Example:
 * `expectRubric({ id: 'human-like-tone', judge: judgeFn, minScore: 0.8 })`
 */
export function expectRubric(options: RubricAssertionOptions): Assertion {
  return async (context) => {
    const result = await options.judge(context)
    const minScore = options.minScore ?? 0.7
    const normalizedScore = clampScore(result.score)
    const pass = normalizedScore >= minScore

    return createOutcome(
      options.id,
      'judge',
      pass,
      normalizedScore,
      `${result.reason}${result.judgeModel ? ` (judge: ${result.judgeModel})` : ''}`,
    )
  }
}

/**
 * Options for custom assertions.
 */
export interface CustomAssertionOptions {
  /**
   * Stable assertion id.
   */
  id: string
  /**
   * Score family emitted by this custom assertion.
   */
  scoreKind: RunScoreKind
  /**
   * Custom evaluator callback.
   */
  evaluate: (context: AssertionContext) => Promise<{ pass: boolean, reason: string, score: number }> | { pass: boolean, reason: string, score: number }
}

/**
 * Creates a custom assertion with fully user-defined logic.
 *
 * Example:
 * `expectCustom({ id: 'stateful-window', scoreKind: 'exact', evaluate: (ctx) => ... })`
 */
export function expectCustom(options: CustomAssertionOptions): Assertion {
  return async (context) => {
    const result = await options.evaluate(context)

    return createOutcome(options.id, options.scoreKind, result.pass, result.score, result.reason)
  }
}

/**
 * Creates an inverse assertion.
 *
 * Example:
 * `expectNot(expectMustInclude({ id: 'contains-engine-word', keywords: ['bestmove'] }), { id: 'no-engine-word' })`
 */
export function expectNot(assertion: Assertion, options: { id: string }): Assertion {
  return async (context) => {
    const baseOutcome = await assertion(context)

    return createOutcome(
      options.id,
      baseOutcome.scoreKind,
      !baseOutcome.pass,
      1 - baseOutcome.score,
      `NOT(${baseOutcome.id}): ${baseOutcome.reason}`,
    )
  }
}

/**
 * Executes assertion list and returns all outcomes.
 *
 * Call stack:
 *
 * {@link evaluateAssertions}
 *   -> `assertion(context)`
 *     -> {@link AssertionOutcome}[]
 */
export async function evaluateAssertions(
  assertions: readonly Assertion[],
  context: Omit<AssertionContext, 'state'> & { state?: AssertionState },
): Promise<AssertionOutcome[]> {
  const state = context.state ?? new Map<string, unknown>()
  const normalizedContext: AssertionContext = {
    state,
    structuredOutput: context.structuredOutput,
    text: context.text,
    toolCalls: context.toolCalls,
  }

  const outcomes: AssertionOutcome[] = []

  for (const assertion of assertions) {
    outcomes.push(await assertion(normalizedContext))
  }

  return outcomes
}

/**
 * Converts assertion outcomes to run-score tuples consumed by aggregation.
 */
export function toRunScores(outcomes: readonly AssertionOutcome[]): RunScore[] {
  return outcomes.map(outcome => ({
    kind: outcome.scoreKind,
    score: outcome.score,
  }))
}

/**
 * Returns failing assertion outcomes in original order.
 */
export function collectFailedAssertions(outcomes: readonly AssertionOutcome[]): AssertionOutcome[] {
  return outcomes.filter(outcome => !outcome.pass)
}
