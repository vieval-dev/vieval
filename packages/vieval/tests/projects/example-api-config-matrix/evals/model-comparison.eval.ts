import { defineEval, defineTask } from '../../../../src/config'

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
      const agentModel = context.model()
      const runModel = context.task.matrix.run.model
      const scenario = context.task.matrix.run.scenario
      const matchesSelectedModel = runModel != null && agentModel.model === runModel
      const stressPenalty = scenario === 'stress' && runModel === 'gpt-4.1-mini' ? 0.15 : 0

      return {
        scores: [{
          kind: 'exact',
          score: Math.max(0, (matchesSelectedModel ? 1 : 0) - stressPenalty),
        }],
      }
    },
  }),
})
