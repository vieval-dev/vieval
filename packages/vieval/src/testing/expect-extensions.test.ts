import { describe, expect, it } from 'vitest'

import { installVievalExpectMatchers } from './expect-extensions'

installVievalExpectMatchers()

describe('expect extensions', () => {
  it('supports keyword include and exclude matchers with native .not', () => {
    expect('Calm and cute opening').toMustInclude(['calm', 'cute'])
    expect('Calm and cute opening').not.toMustInclude(['bestmove'])

    expect('Friendly chess commentary').toMustExclude(['bestmove', 'ponder'])
    expect('Friendly chess commentary').not.toMustExclude(['friendly'])
  })

  it('supports rubric score matcher', () => {
    expect({ reason: 'good', score: 0.91 }).toScoreRubricGreaterThan(0.8)
    expect(0.72).not.toScoreRubricGreaterThan(0.8)
  })

  it('supports structured output and tool call argument matchers', () => {
    expect({ move: 'Nf6' }).toSatisfyStructuredOutput((value): value is { move: string } => {
      if (value == null || typeof value !== 'object') {
        return false
      }

      return typeof (value as { move?: unknown }).move === 'string'
    })

    expect({
      toolCalls: [{
        args: { command: 'analyze' },
        name: 'builtIn_sparkCommand',
      }],
    }).toSatisfyToolCallArgs('builtIn_sparkCommand', (args) => {
      if (args == null || typeof args !== 'object') {
        return false
      }

      return typeof (args as { command?: unknown }).command === 'string'
    })
  })
})
