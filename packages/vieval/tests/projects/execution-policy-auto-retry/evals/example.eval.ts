import { caseOf, describeTask } from '../../../../src'

let attempts = 0

describeTask('execution-policy-auto-retry-fixture', () => {
  caseOf('recovers-after-retry', async () => {
    attempts += 1

    if (attempts < 3) {
      throw new Error(`retry-${attempts}`)
    }
  }, {
    autoRetry: 2,
    input: 'retry-case',
  })
})
