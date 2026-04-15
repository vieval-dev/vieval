import { describe, expect, it } from 'vitest'

import { chatModelFrom } from '../../plugins/chat-models'
import { createTaskExecutionContext } from './task-context'

describe('createTaskExecutionContext', () => {
  it('prefers task.matrix.run.model for task.model()', () => {
    // ROOT CAUSE:
    //
    // The default resolver previously ignored the resolved run-matrix model axis.
    // That meant scheduled model overrides were lost and tasks fell back to the inferenceExecutor id.
    //
    // We fix this by checking task.matrix.run.model first before inferenceExecutor and configured fallback order.
    const baselineModel = chatModelFrom({
      aliases: ['gpt-4.1-mini'],
      model: 'gpt-4.1-mini',
      inferenceExecutor: 'openai',
    })
    const matrixSelectedModel = chatModelFrom({
      aliases: ['gpt-5-mini'],
      model: 'gpt-5-mini',
      inferenceExecutor: 'openai',
    })

    const context = createTaskExecutionContext({
      models: [baselineModel, matrixSelectedModel],
      task: {
        entry: {
          description: 'desc',
          directory: 'd',
          filePath: '/tmp/a.eval.ts',
          id: 'entry',
          name: 'entry',
        },
        id: 'task-1',
        matrix: {
          eval: {},
          meta: {
            evalRowId: 'default',
            runRowId: 'model=gpt-5-mini',
          },
          run: {
            model: 'gpt-5-mini',
          },
        },
        inferenceExecutor: { id: baselineModel.id },
      },
    })

    expect(context.model()).toEqual(matrixSelectedModel)
  })

  it('returns inferenceExecutor-selected model for task.model()', () => {
    const openAIModel = chatModelFrom({
      aliases: ['gpt-5-mini'],
      model: 'gpt-5-mini',
      inferenceExecutor: 'openai',
    })
    const context = createTaskExecutionContext({
      models: [openAIModel],
      task: {
        entry: {
          description: 'desc',
          directory: 'd',
          filePath: '/tmp/a.eval.ts',
          id: 'entry',
          name: 'entry',
        },
        id: 'task-1',
        matrix: {
          eval: {},
          meta: {
            evalRowId: 'default',
            runRowId: 'default',
          },
          run: {},
        },
        inferenceExecutor: { id: 'openai:gpt-5-mini' },
      },
    })

    expect(context.model()).toEqual(openAIModel)
  })

  it('throws when task.matrix.run.model references an unknown configured model', () => {
    const openAIModel = chatModelFrom({
      aliases: ['gpt-5-mini'],
      model: 'gpt-5-mini',
      inferenceExecutor: 'openai',
    })
    const context = createTaskExecutionContext({
      models: [openAIModel],
      task: {
        entry: {
          description: 'desc',
          directory: 'd',
          filePath: '/tmp/a.eval.ts',
          id: 'entry',
          name: 'entry',
        },
        id: 'task-1',
        matrix: {
          eval: {},
          meta: {
            evalRowId: 'default',
            runRowId: 'model=missing-model',
          },
          run: {
            model: 'missing-model',
          },
        },
        inferenceExecutor: { id: openAIModel.id },
      },
    })

    expect(() => context.model()).toThrow('Unknown configured model "missing-model" from task.matrix.run.model.')
  })

  it('resolves model by alias for task.model({ name })', () => {
    const openRouterModel = chatModelFrom({
      aliases: ['gpt-4o-mini'],
      model: 'openai/gpt-4o-mini',
      inferenceExecutor: 'openrouter',
    })
    const context = createTaskExecutionContext({
      models: [openRouterModel],
      task: {
        entry: {
          description: 'desc',
          directory: 'd',
          filePath: '/tmp/a.eval.ts',
          id: 'entry',
          name: 'entry',
        },
        id: 'task-1',
        matrix: {
          eval: {},
          meta: {
            evalRowId: 'default',
            runRowId: 'default',
          },
          run: {},
        },
        inferenceExecutor: { id: openRouterModel.id },
      },
    })

    expect(context.model({ name: 'gpt-4o-mini' })).toEqual(openRouterModel)
  })

  it('throws for unknown named model', () => {
    const openAIModel = chatModelFrom({
      model: 'gpt-5-mini',
      inferenceExecutor: 'openai',
    })
    const context = createTaskExecutionContext({
      models: [openAIModel],
      task: {
        entry: {
          description: 'desc',
          directory: 'd',
          filePath: '/tmp/a.eval.ts',
          id: 'entry',
          name: 'entry',
        },
        id: 'task-1',
        matrix: {
          eval: {},
          meta: {
            evalRowId: 'default',
            runRowId: 'default',
          },
          run: {},
        },
        inferenceExecutor: { id: openAIModel.id },
      },
    })

    expect(() => context.model({ name: 'missing' })).toThrow('Unknown configured model "missing".')
  })
})
