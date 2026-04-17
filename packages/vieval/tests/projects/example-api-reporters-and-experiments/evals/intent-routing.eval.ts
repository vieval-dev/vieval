import { expect } from '../../../../src'
import { describeTask } from '../../../../src/dsl/task'

interface IntentRoutingCase {
  expectedByScenario: {
    baseline: string
    stress: string
  }
  utterance: string
}

const cases: IntentRoutingCase[] = [
  {
    expectedByScenario: {
      baseline: 'travel',
      stress: 'travel',
    },
    utterance: 'book a flight to tokyo',
  },
  {
    expectedByScenario: {
      baseline: 'support',
      stress: 'support',
    },
    utterance: 'where is my package',
  },
  {
    expectedByScenario: {
      baseline: 'billing',
      stress: 'billing',
    },
    utterance: 'please refund this invoice',
  },
]

describeTask('intent-routing', ({ casesFromInputs }) => {
  casesFromInputs('intent-case', cases, ({ matrix }) => {
    const scenario = String(matrix.run.scenario ?? 'baseline')
    const expectedIntent = scenario === 'stress'
      ? matrix.inputs.expectedByScenario.stress
      : matrix.inputs.expectedByScenario.baseline
    const normalizedUtterance = matrix.inputs.utterance.toLowerCase()

    const predictedIntent = normalizedUtterance.includes('flight')
      ? 'travel'
      : normalizedUtterance.includes('refund')
        ? 'billing'
        : 'support'

    expect(predictedIntent).toBe(expectedIntent)
  })
})
