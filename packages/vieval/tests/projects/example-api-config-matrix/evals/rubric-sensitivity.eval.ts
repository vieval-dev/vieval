import { defineEval, defineTask } from '../../../../src/config'

export default defineEval({
  description: 'Explores rubric-model sensitivity over strict vs lenient judging.',
  matrix: {
    evalMatrix: {
      extend: {
        rubricModel: ['judge-mini', 'judge-large'],
      },
    },
  },
  name: 'rubric-sensitivity',
  task: defineTask({
    id: 'rubric-sensitivity',
    matrix: {
      evalMatrix: {
        override: {
          rubric: ['strict', 'lenient'],
        },
      },
    },
    async run(context) {
      const rubric = context.task.matrix.eval.rubric
      const rubricModelName = context.task.matrix.eval.rubricModel
      const judgeModel = rubricModelName == null ? null : context.model({ name: rubricModelName })
      const strictPenalty = rubric === 'strict' ? 0.05 : 0
      const hasJudge = judgeModel != null && judgeModel.id.length > 0

      return {
        scores: [{
          kind: 'judge',
          score: Math.max(0, (hasJudge ? 1 : 0) - strictPenalty),
        }],
      }
    },
  }),
})
