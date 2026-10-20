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

      // A custom task returns `TaskRunOutput` itself. Here the summaries are written by hand to show the shape;
      // `scoreCases` from `vieval/core/scoring` builds the same object from case outcomes.
      return {
        completion: { mean: 1, n: 1, name: 'completion', sum: 1, total: 1, unscored: {} },
        passed: { mean: 1, n: 1, name: 'passed', sum: 1, total: 1, unscored: {} },
        primary: 'task_default.models_resolved',
        scores: [{ mean: score, n: 1, name: 'task_default.models_resolved', sum: score, total: 1, unscored: {} }],
      }
    },
  }),
})
