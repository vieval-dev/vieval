import { defineEval, defineTask } from '../../../../src/config'

export default defineEval({
  description: 'Task-based eval fixture using task.model() and task.model({ name }).',
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
        },
      },
      runMatrix: {
        override: {
          model: ['gpt-4.1-mini'],
        },
      },
    },
    async run(context) {
      const defaultModel = context.model()
      const rubricModel = context.model({ name: 'judge-mini' })

      const score = defaultModel.id.length > 0 && rubricModel.id.length > 0 ? 1 : 0

      return {
        scores: [{ kind: 'exact', score }],
      }
    },
  }),
})
