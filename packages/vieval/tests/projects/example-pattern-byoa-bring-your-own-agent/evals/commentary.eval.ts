import { caseOf, describeTask, expect } from '../../../../src'
import { runMinimalAgent } from '../agent'

describeTask('commentary', () => {
  caseOf('commentary-default', async (task) => {
    const score = await runMinimalAgent(task)
    expect(score).toBe(1)
  }, {
    input: {
      kind: 'commentary',
    },
  })
}, {
  description: 'Fixture eval for commentary behavior.',
})
