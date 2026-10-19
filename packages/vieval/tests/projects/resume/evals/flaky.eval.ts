import process from 'node:process'

import { caseOf, describeTask, expect } from '../../../../src'

/**
 * One case per outcome: `passes` has a result, `wrong` has a wrong result, and `provider` errors until
 * `VIEVAL_TEST_PROVIDER_UP` is set, like a provider that rate-limited the first attempt.
 */
describeTask('resume-flaky', () => {
  caseOf('passes', async () => {}, { input: 'passes' })

  caseOf('wrong', async () => {
    expect('heard').toBe('expected')
  }, { input: 'wrong' })

  caseOf('provider', async () => {
    if (process.env.VIEVAL_TEST_PROVIDER_UP !== '1') {
      throw Object.assign(new Error('Remote sent 429 response'), { statusCode: 429 })
    }
  }, { input: 'provider' })
})
