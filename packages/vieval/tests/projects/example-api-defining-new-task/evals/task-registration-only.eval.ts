import { caseOf, describeTask, expect } from '../../../../src'
import { modelFromRun } from '../../../../src/plugins/chat-models'

describeTask('task-registration-only', () => {
  caseOf('registration-only-default', async (task) => {
    const currentModel = modelFromRun(task, { axis: 'model' })
    expect(currentModel.id.length).toBeGreaterThan(0)
  }, {
    input: {
      source: 'registration-only',
    },
  })
})
