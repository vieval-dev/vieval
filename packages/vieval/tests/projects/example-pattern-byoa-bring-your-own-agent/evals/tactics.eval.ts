import { caseOf, describeTask, expect } from '../../../../src'
import { runMinimalAgent } from '../agent'

describeTask('tactics', () => {
  caseOf('tactics-default', async (task) => {
    const score = await runMinimalAgent(task)
    expect(score).toBe(1)
  }, {
    kind: 'tactics',
  })
}, {
  description: 'Fixture eval for tactical behavior.',
})
