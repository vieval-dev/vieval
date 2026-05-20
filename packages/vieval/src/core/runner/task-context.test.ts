import { describe, expect, it } from 'vitest'

import { chatModelFrom } from '../../plugins/chat-models'
import { createTaskExecutionContext } from './task-context'

describe('createTaskExecutionContext', () => {
  it('exposes configured models as data without owning model lookup policy', () => {
    const model = chatModelFrom({
      aliases: ['gpt-5-mini'],
      inferenceExecutor: 'openai',
      model: 'gpt-5-mini',
    })

    const context = createTaskExecutionContext({
      models: [model],
      task: {
        entry: {
          description: 'desc',
          directory: 'd',
          filePath: '/tmp/a.eval.ts',
          id: 'entry',
          name: 'entry',
        },
        id: 'task-1',
        inferenceExecutor: { id: model.id },
        matrix: {
          eval: {},
          meta: {
            evalRowId: 'default',
            runRowId: 'default',
          },
          run: {},
        },
      },
    })

    expect(context.models).toEqual([model])
    expect('model' in context).toBe(false)
  })
})
