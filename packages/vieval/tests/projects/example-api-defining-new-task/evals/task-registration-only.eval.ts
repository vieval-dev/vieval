import { caseOf, describeTask, expect } from '../../../../src'

describeTask('task-registration-only', () => {
  caseOf('registration-only-default', async (task) => {
    const currentModel = task.model()
    expect(currentModel.id.length).toBeGreaterThan(0)
  }, {
    input: {
      source: 'registration-only',
    },
  })
})
