import { defineEval, defineTask } from '../../../../src/config'
import { modelFromEval, modelFromRun } from '../../../../src/plugins/chat-models'

export default defineEval({
  description: 'Task-based eval fixture using chat-model matrix helpers.',
  matrix: {
    evalMatrix: {
      override: {
        rubric: ['strict'],
      },
    },
    runMatrix: {
      extend: {
        promptStyle: ['concise'],
      },
      override: {
        scenario: ['eval-scenario'],
      },
    },
  },
  name: 'task-default',
  task: defineTask({
    id: 'task-default',
    matrix: {
      evalMatrix: {
        extend: {
          evaluator: ['default-judge'],
          rubricModel: ['judge-mini'],
        },
      },
      runMatrix: {
        override: {
          model: ['gpt-4.1-mini'],
        },
      },
    },
    async run(context) {
      const defaultModel = modelFromRun(context, { axis: 'model' })
      const rubricModel = modelFromEval(context, { axis: 'rubricModel' })

      const score = defaultModel.id.length > 0 && rubricModel.id.length > 0 ? 1 : 0

      return {
        scores: [{ kind: 'exact', score }],
      }
    },
  }),
})
