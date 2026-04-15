import { caseOf, describeTask, expect } from '../../../../src'

describeTask('assertion-pipeline', () => {
  caseOf('assertion-and-rubric-pipeline-default', async (context) => {
    const scenario = context.task.matrix.run.scenario
    expect(scenario).toBeDefined()
    expect(['baseline', 'stress']).toContain(scenario)

    const text = `Calm tactical guidance for ${scenario}.`
    const normalizedText = text.toLowerCase()

    expect(normalizedText.includes('calm')).toBe(true)
    expect(normalizedText.includes('tactical')).toBe(true)
    expect(normalizedText.includes('bestmove')).toBe(false)
    expect(normalizedText.includes('baseline')).toBe(true)

    const judgeModel = context.model({ name: 'judge-mini' })
    expect(judgeModel.id.length).toBeGreaterThan(0)
    expect(judgeModel.id).toBe(context.task.inferenceExecutor.id)

    const structuredOutput = { move: 'Nf3' }
    expect(typeof structuredOutput.move).toBe('string')
    expect(structuredOutput.move.length).toBeGreaterThan(0)
  }, undefined)
})
