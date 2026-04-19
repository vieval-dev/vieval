import { describe, expect, it } from 'vitest'

import { chatModelFrom, ChatModels, chatProviderFrom, ChatProviders } from './index'

describe('chatProviders', () => {
  it('resolves requiredEnv and optionalEnv provider parameters from config env', async () => {
    const plugin = ChatProviders({
      providers: [
        chatProviderFrom({
          id: 'openai-provider',
          inferenceExecutor: 'openai',
          optionalEnv: {
            baseURL: 'OPENAI_BASE_URL',
          },
          requiredEnv: {
            apiKey: 'OPENAI_API_KEY',
          },
        }),
      ],
    })

    const result = await plugin.configVieval?.({
      env: {
        OPENAI_API_KEY: 'test-api-key',
        OPENAI_BASE_URL: 'https://api.openai.com/v1',
      },
      models: [],
    })

    expect(result?.chatProviders).toEqual([
      {
        id: 'openai-provider',
        inferenceExecutor: 'openai',
        inferenceExecutorId: 'openai',
        optionalEnv: {
          baseURL: 'OPENAI_BASE_URL',
        },
        parameters: {
          apiKey: 'test-api-key',
          baseURL: 'https://api.openai.com/v1',
        },
        requiredEnv: {
          apiKey: 'OPENAI_API_KEY',
        },
      },
    ])
  })

  it('throws when requiredEnv key is missing', () => {
    const plugin = ChatProviders({
      providers: [
        chatProviderFrom({
          id: 'openai-provider',
          inferenceExecutor: 'openai',
          requiredEnv: {
            apiKey: 'OPENAI_API_KEY',
          },
        }),
      ],
    })

    expect(() => plugin.configVieval?.({
      env: {},
      models: [],
    })).toThrow('Missing required OPENAI_API_KEY.')
  })
})

describe('chatModels', () => {
  it('resolves provider-referenced models through registered chat providers', async () => {
    const providerPlugin = ChatProviders({
      providers: [
        chatProviderFrom({
          id: 'openai-provider',
          inferenceExecutor: 'openai',
          optionalEnv: {
            baseURL: 'OPENAI_BASE_URL',
          },
          requiredEnv: {
            apiKey: 'OPENAI_API_KEY',
          },
        }),
      ],
    })
    const providerResolvedConfig = await providerPlugin.configVieval?.({
      env: {
        OPENAI_API_KEY: 'test-api-key',
        OPENAI_BASE_URL: 'https://api.openai.com/v1',
      },
      models: [],
    }) ?? { models: [] }

    const modelsPlugin = ChatModels({
      models: [
        chatModelFrom({
          aliases: ['agent-mini'],
          model: 'gpt-4.1-mini',
          provider: 'openai-provider',
        }),
      ],
    })

    const result = await modelsPlugin.configVieval?.(providerResolvedConfig)

    expect(result?.models).toEqual([
      {
        aliases: ['agent-mini'],
        id: 'openai-provider:gpt-4.1-mini',
        inferenceExecutor: 'openai',
        inferenceExecutorId: 'openai',
        model: 'gpt-4.1-mini',
        parameters: {
          apiKey: 'test-api-key',
          baseURL: 'https://api.openai.com/v1',
        },
        provider: 'openai-provider',
      },
    ])
  })

  it('resolves callback-based model executor parameters from config env', async () => {
    const plugin = ChatModels({
      models: [
        chatModelFrom({
          aliases: ['gpt-3.5'],
          apiKey: config => config.env.OPENAI_API_KEY,
          baseURL: config => config.env.OPENAI_BASE_URL,
          inferenceExecutor: 'openai',
          model: 'gpt-3.5-turbo',
        }),
      ],
    })

    const result = await plugin.configVieval?.({
      env: {
        OPENAI_API_KEY: 'env-api-key',
        OPENAI_BASE_URL: 'https://api.openai.com/v1',
      },
      models: [],
    })

    expect(result?.models).toEqual([
      {
        aliases: ['gpt-3.5'],
        id: 'openai:gpt-3.5-turbo',
        inferenceExecutor: 'openai',
        inferenceExecutorId: 'openai',
        model: 'gpt-3.5-turbo',
        parameters: {
          apiKey: 'env-api-key',
          baseURL: 'https://api.openai.com/v1',
        },
        provider: undefined,
        runtimeResolvers: {
          apiKey: expect.any(Function),
          baseURL: expect.any(Function),
          headers: undefined,
        },
      },
    ])
  })

  it('throws when a model references an unknown provider id', async () => {
    const plugin = ChatModels({
      models: [
        chatModelFrom({
          model: 'gpt-4.1-mini',
          provider: 'missing-provider',
        }),
      ],
    })

    await expect(plugin.configVieval?.({
      models: [],
    })).rejects.toThrow('Unknown chat provider "missing-provider" referenced by model "missing-provider:gpt-4.1-mini".')
  })
})
