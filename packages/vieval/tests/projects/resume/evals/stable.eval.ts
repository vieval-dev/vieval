import { caseOf, describeTask } from '../../../../src'

/** Every case has a result in the first attempt, so a retry skips this task. */
describeTask('resume-stable', () => {
  caseOf('first', async () => {}, { input: 'first' })
  caseOf('second', async () => {}, { input: 'second' })
})
