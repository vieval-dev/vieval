import { createOpenAI } from '@xsai/providers'
import { caseOf, describeTask, expect } from 'vieval'
import { openrouterFromRunContext } from 'vieval/plugins/chat-models'

import { createEmotionAnalysisAgent } from '../../src/agents/emotion-analysis'

describeTask('analysis', () => {
  caseOf('case 1', async (task) => {
    const openai = openrouterFromRunContext(task.model())

    const agent = createEmotionAnalysisAgent({
      provider: createOpenAI({
        apiKey: openai.apiKey,
        baseURL: openai.baseURL,
      }),
      model: openai.model,
    })

    const res = await agent.handle('I am feeling very happy today!')
    expect(res).toBeOneOf(['happy', 'sad'])
  })
})
