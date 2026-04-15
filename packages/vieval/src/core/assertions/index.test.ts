import { describe, expect, it } from 'vitest'

import {
  collectFailedAssertions,
  evaluateAssertions,
  expectCustom,
  expectMustExclude,
  expectMustInclude,
  expectNot,
  expectRegex,
  expectRubric,
  expectStructuredOutput,
  expectToolCallArgs,
  toRunScores,
} from './index'

describe('assertions', () => {
  it('evaluates include and exclude assertions for short chess commentary text', async () => {
    const outcomes = await evaluateAssertions([
      expectMustInclude({
        id: 'must-include-tone',
        keywords: ['cute', 'opening'],
      }),
      expectMustExclude({
        id: 'must-exclude-engine-terms',
        keywords: ['bestmove', 'ponder'],
      }),
    ], {
      text: 'Cute opening, nice idea.',
    })

    expect(outcomes.map(outcome => outcome.pass)).toEqual([true, true])
    expect(collectFailedAssertions(outcomes)).toEqual([])

    const runScores = toRunScores(outcomes)
    expect(runScores).toEqual([
      { kind: 'exact', score: 1 },
      { kind: 'exact', score: 1 },
    ])
  })

  it('supports regex, structured output, and tool-call argument checks', async () => {
    const outcomes = await evaluateAssertions([
      expectRegex({
        id: 'starts-with-act-token',
        pattern: /^<\|ACT:/,
      }),
      expectStructuredOutput({
        id: 'structured-output-shape',
        validate: (value): value is { move: string } => {
          if (value == null || typeof value !== 'object') {
            return false
          }

          return typeof (value as { move?: unknown }).move === 'string'
        },
      }),
      expectToolCallArgs({
        id: 'spark-command-args',
        toolName: 'builtIn_sparkCommand',
        validate: (args) => {
          if (args == null || typeof args !== 'object') {
            return false
          }

          return typeof (args as { command?: unknown }).command === 'string'
        },
      }),
    ], {
      structuredOutput: { move: 'Nf6' },
      text: '<|ACT:"emotion":{"name":"think","intensity":0.8}|> Nice setup.',
      toolCalls: [{
        args: { command: 'analyze' },
        name: 'builtIn_sparkCommand',
      }],
    })

    expect(outcomes.map(outcome => outcome.pass)).toEqual([true, true, true])
  })

  it('supports inversion and rubric scoring assertions', async () => {
    const outcomes = await evaluateAssertions([
      expectNot(expectMustInclude({
        id: 'contains-bestmove',
        keywords: ['bestmove'],
      }), {
        id: 'must-not-include-bestmove',
      }),
      expectRubric({
        id: 'rubric-human-likeness',
        judge: async (context) => {
          if (context.text.includes('calm')) {
            return {
              judgeModel: 'openai:gpt-4.1-mini',
              reason: 'Tone is short and human-like.',
              score: 0.92,
            }
          }

          return {
            reason: 'Tone is too robotic.',
            score: 0.4,
          }
        },
        minScore: 0.8,
      }),
    ], {
      text: 'A calm answer for this position.',
    })

    expect(outcomes.map(outcome => outcome.pass)).toEqual([true, true])
    expect(outcomes[1]?.scoreKind).toBe('judge')
  })

  it('supports stateful custom assertions for dynamic measurements', async () => {
    const outcomes = await evaluateAssertions([
      expectCustom({
        evaluate: (context) => {
          const count = ((context.state.get('calls') as number | undefined) ?? 0) + 1
          context.state.set('calls', count)

          const pass = count >= 2
          return {
            pass,
            reason: pass ? 'Second sample reached.' : 'First sample does not satisfy threshold.',
            score: pass ? 1 : 0,
          }
        },
        id: 'stateful-threshold',
        scoreKind: 'exact',
      }),
    ], {
      state: new Map([['calls', 1]]),
      text: 'Stateful assertion check',
    })

    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]?.pass).toBe(true)
  })
})
