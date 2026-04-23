import type { ChatProvider } from '@xsai/providers'

import { generateText } from 'xsai'

export function createEmotionAnalysisAgent(options: { provider: ChatProvider, model: string }) {
  return {
    handle: async (input: string): Promise<string> => {
      const res = await generateText({
        ...options.provider.chat(options.model),
        messages: [
          { role: 'system', content: 'You are an emotion analysis agent. Analyze the emotion of the user post and return the emotion. Possible values: happy, sad' },
          { role: 'user', content: `Analyze the emotion of the following user post and return the emotion: ${input}` },
        ],
      })

      const content = res.messages.at(-1)?.content
      if (!content) {
        throw new Error('No response from model')
      }

      if (typeof content !== 'string') {
        return content.filter(m => m.type === 'text').map(m => m.text).join('')
      }

      return content
    },
  }
}
