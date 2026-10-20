import { defineEval, defineTask } from '../../../../src/config'
import { scoreCases } from '../../../../src/core/scoring'
import { modelFromRun } from '../../../../src/plugins/chat-models'

export default defineEval({
  description: 'Compares model behavior across baseline and stress scenarios.',
  matrix: {
    runMatrix: {
      override: {
        model: ['gpt-4.1-mini', 'gpt-4.1'],
      },
    },
  },
  name: 'model-comparison',
  task: defineTask({
    id: 'model-comparison',
    async run(context) {
      const agentModel = modelFromRun(context, { axis: 'model' })
      const runModel = context.task.matrix.run.model
      const scenario = context.task.matrix.run.scenario
      const matchesSelectedModel = runModel != null && agentModel.model === runModel
      const stressPenalty = scenario === 'stress' && runModel === 'gpt-4.1-mini' ? 0.15 : 0

      // A custom task runs no cases, so it reports its one measurement as one passed outcome and lets
      // `scoreCases` build the summaries (`scores`, `primary`, `completion`, `passed`) of `TaskRunOutput`.
      return scoreCases([{
        scores: { 'model_comparison.match': Math.max(0, (matchesSelectedModel ? 1 : 0) - stressPenalty) },
        state: 'passed',
        unscored: {},
      }])
    },
  }),
})
