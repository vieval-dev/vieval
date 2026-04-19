import { caseOf, describeTask, expect } from '../../../../src'

describeTask('prompt-language-ablation', () => {
  caseOf('resolves model with prompt-language and scenario matrix axes', async (context) => {
    const selectedModel = context.model()
    const language = context.task.matrix.run.promptLanguage
    const scenario = context.task.matrix.run.scenario

    expect(language).toBeDefined()
    expect(scenario).toBeDefined()
    expect(selectedModel.id.length).toBeGreaterThan(0)
  }, {
    input: {
      prompt: 'summarize the position in one sentence',
    },
  })
})
