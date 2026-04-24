import { describe, expect, it } from 'vitest'

import { chatModelFrom, chatModelMatrix, ChatModels, chatProviderFrom, ChatProviders } from './index'

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
  it('creates a model axis helper for runMatrix definitions', () => {
    expect(chatModelMatrix('openai/gpt-5-mini', 'openai/gpt-5-nano', 'openai/gpt-5-mini')).toEqual({
      model: ['openai/gpt-5-mini', 'openai/gpt-5-nano'],
    })
  })

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

  it('resolves callback-based openrouter model executor parameters from config env', async () => {
    const plugin = ChatModels({
      models: [
        chatModelFrom({
          aliases: ['agent-openrouter-mini'],
          apiKey: config => config.env.OPENROUTER_API_KEY,
          baseURL: config => config.env.OPENROUTER_BASE_URL,
          inferenceExecutor: 'openrouter',
          model: 'openai/gpt-4.1-mini',
        }),
      ],
    })

    const result = await plugin.configVieval?.({
      env: {
        OPENROUTER_API_KEY: 'openrouter-api-key',
        OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
      },
      models: [],
    })

    expect(result?.models).toEqual([
      {
        aliases: ['agent-openrouter-mini'],
        id: 'openrouter:openai/gpt-4.1-mini',
        inferenceExecutor: 'openrouter',
        inferenceExecutorId: 'openrouter',
        model: 'openai/gpt-4.1-mini',
        parameters: {
          apiKey: 'openrouter-api-key',
          baseURL: 'https://openrouter.ai/api/v1',
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

  it('preserves explicit execution policy configured through chatModelFrom', () => {
    expect(chatModelFrom({
      autoAttempt: 2,
      autoRetry: 1,
      model: 'gpt-4.1-mini',
      provider: 'openai-provider',
      timeout: 3_000,
    }).executionPolicy).toEqual({
      autoAttempt: 2,
      autoRetry: 1,
      timeout: 3_000,
    })
  })

  it('defaults judge-oriented chat models to autoRetry = 3', () => {
    expect(chatModelFrom({
      aliases: ['judge-mini'],
      inferenceExecutor: 'openai',
      model: 'gpt-4.1-mini',
    }).executionPolicy).toEqual({
      autoRetry: 3,
    })
  })
})
