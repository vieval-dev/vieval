import type { RubricJudgeResult, ToolCall } from '../core/assertions'

import { expect } from 'vitest'

import { normalizeMatchText } from '../core/assertions'

/**
 * Options for keyword-based matcher behavior.
 */
export interface KeywordMatcherOptions {
  /**
   * Case-sensitive matching toggle.
   *
   * @default false
   */
  caseSensitive?: boolean
  /**
   * Match mode.
   *
   * @default 'all'
   */
  mode?: 'all' | 'any'
}

/**
 * Shape used by tool-call matchers.
 */
export interface ToolCallContainer {
  /**
   * Tool calls to inspect.
   */
  toolCalls?: readonly ToolCall[]
}

function toKeywordArray(keywords: string | readonly string[]): readonly string[] {
  if (typeof keywords === 'string') {
    return [keywords]
  }

  return keywords
}

/**
 * Registers vieval custom matchers on Vitest `expect`.
 *
 * Call stack:
 *
 * {@link installVievalExpectMatchers}
 *   -> `expect.extend(...)`
 *     -> `expect(received).toMustInclude(...)`
 *     -> `expect(received).toScoreRubricGreaterThan(...)`
 *
 * Use when:
 * - eval suites need domain assertions while preserving native Vitest ergonomics
 * - callers want native `.not` chaining with the same matchers
 */
export function installVievalExpectMatchers(): void {
  expect.extend({
    toMustExclude(received: unknown, keywords: string | readonly string[], options: KeywordMatcherOptions = {}) {
      const keywordList = toKeywordArray(keywords)

      if (typeof received !== 'string') {
        return {
          message: () => 'Expected received value to be a string.',
          pass: false,
        }
      }

      const normalizedText = normalizeMatchText(received, options.caseSensitive ?? false)
      const forbiddenMatches = keywordList.filter((keyword) => {
        return normalizedText.includes(normalizeMatchText(keyword, options.caseSensitive ?? false))
      })

      const pass = forbiddenMatches.length === 0

      return {
        message: () => {
          if (pass) {
            return `Expected text to include forbidden keywords: ${keywordList.join(', ')}`
          }

          return `Expected text not to include forbidden keywords, but matched: ${forbiddenMatches.join(', ')}`
        },
        pass,
      }
    },

    toMustInclude(received: unknown, keywords: string | readonly string[], options: KeywordMatcherOptions = {}) {
      const keywordList = toKeywordArray(keywords)

      if (typeof received !== 'string') {
        return {
          message: () => 'Expected received value to be a string.',
          pass: false,
        }
      }

      const normalizedText = normalizeMatchText(received, options.caseSensitive ?? false)
      const matches = keywordList.filter((keyword) => {
        return normalizedText.includes(normalizeMatchText(keyword, options.caseSensitive ?? false))
      })

      const mode = options.mode ?? 'all'
      const pass = mode === 'all' ? matches.length === keywordList.length : matches.length > 0

      return {
        message: () => {
          if (pass) {
            return `Expected text not to match required keywords, but matched: ${matches.join(', ')}`
          }

          return `Expected text to match required keywords (${mode}), but matched ${matches.length}/${keywordList.length}.`
        },
        pass,
      }
    },

    toScoreRubricGreaterThan(received: unknown, threshold: number) {
      const score = typeof received === 'number'
        ? received
        : (received as RubricJudgeResult | null)?.score

      if (typeof score !== 'number') {
        return {
          message: () => 'Expected received value to be a number or RubricJudgeResult.',
          pass: false,
        }
      }

      const pass = score > threshold

      return {
        message: () => {
          if (pass) {
            return `Expected rubric score ${score} to be less than or equal to ${threshold}.`
          }

          return `Expected rubric score ${score} to be greater than ${threshold}.`
        },
        pass,
      }
    },

    toSatisfyStructuredOutput<T>(received: unknown, validator: (value: unknown) => value is T) {
      const pass = validator(received)

      return {
        message: () => pass
          ? 'Expected structured output validator to fail.'
          : 'Expected structured output validator to pass.',
        pass,
      }
    },

    toSatisfyToolCallArgs(
      received: unknown,
      toolName: string,
      validator: (args: unknown) => boolean,
    ) {
      const toolCalls = (received as ToolCallContainer | null)?.toolCalls

      if (toolCalls == null) {
        return {
          message: () => 'Expected received value to provide toolCalls array.',
          pass: false,
        }
      }

      const targetCall = toolCalls.find(call => call.name === toolName)
      if (targetCall == null) {
        return {
          message: () => `Expected tool call ${toolName} to exist.`,
          pass: false,
        }
      }

      const pass = validator(targetCall.args)

      return {
        message: () => pass
          ? `Expected tool call args for ${toolName} to fail validation.`
          : `Expected tool call args for ${toolName} to pass validation.`,
        pass,
      }
    },
  })
}

declare module 'vitest' {
  interface Assertion {
    /**
     * Asserts that text includes required keywords.
     *
     * Example:
     * `expect('calm answer').toMustInclude(['calm'])`
     */
    toMustInclude: (keywords: string | readonly string[], options?: KeywordMatcherOptions) => void
    /**
     * Asserts that text excludes forbidden keywords.
     *
     * Example:
     * `expect('calm answer').toMustExclude(['bestmove'])`
     */
    toMustExclude: (keywords: string | readonly string[], options?: KeywordMatcherOptions) => void
    /**
     * Asserts rubric score is greater than a threshold.
     *
     * Example:
     * `expect({ score: 0.91 }).toScoreRubricGreaterThan(0.8)`
     */
    toScoreRubricGreaterThan: (threshold: number) => void
    /**
     * Asserts structured output satisfies a validator.
     *
     * Example:
     * `expect(value).toSatisfyStructuredOutput(isMyShape)`
     */
    toSatisfyStructuredOutput: <TValue>(validator: (value: unknown) => value is TValue) => void
    /**
     * Asserts selected tool-call args satisfy validator.
     *
     * Example:
     * `expect({ toolCalls }).toSatisfyToolCallArgs('builtIn_sparkCommand', isSparkArgs)`
     */
    toSatisfyToolCallArgs: (toolName: string, validator: (args: unknown) => boolean) => void
  }
}
