import { describe, it } from 'vitest'

import { expect } from '../../../../src'

describe('example-api-expect expect extensions', () => {
  it('supports keyword, rubric, structured output, and tool-call matchers', () => {
    const text = 'Calm opening tip with short commentary.'

    expect(text).toMustInclude(['calm', 'opening'])
    expect(text).toMustExclude(['bestmove'])

    expect({ score: 0.91 }).toScoreRubricGreaterThan(0.8)

    expect({ move: 'Nf3' }).toSatisfyStructuredOutput((value): value is { move: string } => {
      if (value == null || typeof value !== 'object') {
        return false
      }

      return typeof (value as { move?: unknown }).move === 'string'
    })

    expect({
      toolCalls: [
        {
          args: { command: 'analyze' },
          name: 'planner',
        },
      ],
    }).toSatisfyToolCallArgs('planner', (args) => {
      if (args == null || typeof args !== 'object') {
        return false
      }

      return typeof (args as { command?: unknown }).command === 'string'
    })
  })
})
