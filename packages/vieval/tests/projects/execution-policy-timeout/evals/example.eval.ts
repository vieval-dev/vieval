import { caseOf, describeTask } from '../../../../src'

describeTask('execution-policy-timeout-fixture', () => {
  caseOf('passes-fast', async () => {}, {
    input: 'fast',
  })

  caseOf('times-out', async () => {
    await new Promise<void>(() => {})
  }, {
    input: 'slow',
    timeout: 10,
  })
})
