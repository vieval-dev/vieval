import { defineEval, defineTask } from '../../../../src/config'
import { scoreCases } from '../../../../src/core/scoring'
import { modelFromEval } from '../../../../src/plugins/chat-models'

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
      const judgeModel = modelFromEval(context, { axis: 'rubricModel' })
      const strictPenalty = rubric === 'strict' ? 0.05 : 0
      const hasJudge = judgeModel.id.length > 0

      // A custom task runs no cases, so it reports its one measurement as one passed outcome and lets
      // `scoreCases` build the summaries (`scores`, `primary`, `completion`, `passed`) of `TaskRunOutput`.
      return scoreCases([{
        scores: { 'rubric_sensitivity.rubric': Math.max(0, (hasJudge ? 1 : 0) - strictPenalty) },
        state: 'passed',
        unscored: {},
      }])
    },
  }),
})
