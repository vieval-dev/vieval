import { expect } from '../../../../src'
import { describeTask } from '../../../../src/dsl/task'

interface GroundingCase {
  answer: string
  requiresCitation: boolean
}

const cases: GroundingCase[] = [
  {
    answer: 'Paris is the capital of France. [source]',
    requiresCitation: true,
  },
  {
    answer: '2 + 2 = 4',
    requiresCitation: false,
  },
  {
    answer: 'The moon has no atmosphere. [source]',
    requiresCitation: true,
  },
]

describeTask('answer-grounding', ({ casesFromInputs }) => {
  casesFromInputs('grounding-case', cases, ({ matrix }) => {
    const scenario = String(matrix.run.scenario ?? 'baseline')
    const hasCitation = matrix.inputs.answer.includes('[source]')

    if (scenario === 'stress' && matrix.inputs.requiresCitation) {
      // In stress scenario, citation requirement is strict.
      expect(hasCitation).toBe(true)
      return
    }

    // In baseline or non-citation case, format requirement is relaxed.
    expect(matrix.inputs.answer.length > 0).toBe(true)
  })
})
