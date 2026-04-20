import { describe, expect, it } from 'vitest'

import { ollamaFromRunContext, openaiFromRunContext, openrouterFromRunContext, toChatModelRuntimeConfig } from './runtime-config'

describe('toChatModelRuntimeConfig', () => {
  it('normalizes openai model runtime config', () => {
    const config = toChatModelRuntimeConfig({
      aliases: ['agent-mini'],
      id: 'openai:gpt-4.1-mini',
      inferenceExecutor: 'openai',
      inferenceExecutorId: 'openai',
      model: 'gpt-4.1-mini',
      parameters: {
        apiKey: 'test-api-key',
        baseURL: 'https://api.openai.com/v1',
        headers: {
          'x-trace-id': 'trace-id',
        },
      },
    })

    expect(config).toEqual({
      apiKey: 'test-api-key',
      baseURL: 'https://api.openai.com/v1',
      headers: {
        'x-trace-id': 'trace-id',
      },
      inferenceExecutor: 'openai',
      model: 'gpt-4.1-mini',
    })
  })

  it('normalizes ollama model runtime config', () => {
    const config = toChatModelRuntimeConfig({
      aliases: ['local-llm'],
      id: 'ollama:llama3.1',
      inferenceExecutor: 'ollama',
      inferenceExecutorId: 'ollama',
      model: 'llama3.1',
      parameters: {
        baseURL: 'http://127.0.0.1:11434',
      },
    })

    expect(config).toEqual({
      baseURL: 'http://127.0.0.1:11434',
      headers: undefined,
      inferenceExecutor: 'ollama',
      model: 'llama3.1',
    })
  })

  it('normalizes openrouter model runtime config', () => {
    const config = toChatModelRuntimeConfig({
      aliases: ['agent-openrouter-mini'],
      id: 'openrouter:openai/gpt-4.1-mini',
      inferenceExecutor: 'openrouter',
      inferenceExecutorId: 'openrouter',
      model: 'openai/gpt-4.1-mini',
      parameters: {
        apiKey: 'openrouter-api-key',
        baseURL: 'https://openrouter.ai/api/v1',
        headers: {
          'http-referer': 'https://example.com',
          'x-title': 'Vieval',
        },
      },
    })

    expect(config).toEqual({
      apiKey: 'openrouter-api-key',
      baseURL: 'https://openrouter.ai/api/v1',
      headers: {
        'http-referer': 'https://example.com',
        'x-title': 'Vieval',
      },
      inferenceExecutor: 'openrouter',
      model: 'openai/gpt-4.1-mini',
    })
  })

  it('throws when openai apiKey is missing', () => {
    expect(() => toChatModelRuntimeConfig({
      aliases: [],
      id: 'openai:gpt-4.1-mini',
      inferenceExecutor: 'openai',
      inferenceExecutorId: 'openai',
      model: 'gpt-4.1-mini',
      parameters: {},
    })).toThrow('Missing required openai:gpt-4.1-mini.parameters.apiKey.')
  })

  it('throws for unsupported inferenceExecutor id', () => {
    expect(() => toChatModelRuntimeConfig({
      aliases: [],
      id: 'custom:model',
      inferenceExecutor: 'custom',
      inferenceExecutorId: 'custom',
      model: 'model',
      parameters: {},
    })).toThrow('Unsupported chat inference executor "custom" for model "custom:model".')
  })
})

describe('openaiFromRunContext', () => {
  it('resolves openai runtime config from run-context model', () => {
    const config = openaiFromRunContext({
      aliases: [],
      id: 'openai:gpt-4.1-mini',
      inferenceExecutor: 'openai',
      inferenceExecutorId: 'openai',
      model: 'gpt-4.1-mini',
      parameters: {
        apiKey: 'test-api-key',
      },
    })

    expect(config).toEqual({
      apiKey: 'test-api-key',
      baseURL: undefined,
      headers: undefined,
      inferenceExecutor: 'openai',
      model: 'gpt-4.1-mini',
    })
  })
})

describe('ollamaFromRunContext', () => {
  it('resolves ollama runtime config from run-context model', () => {
    const config = ollamaFromRunContext({
      aliases: [],
      id: 'ollama:llama3.1',
      inferenceExecutor: 'ollama',
      inferenceExecutorId: 'ollama',
      model: 'llama3.1',
      parameters: {
        baseURL: 'http://127.0.0.1:11434',
      },
    })

    expect(config).toEqual({
      baseURL: 'http://127.0.0.1:11434',
      headers: undefined,
      inferenceExecutor: 'ollama',
      model: 'llama3.1',
    })
  })
})

describe('openrouterFromRunContext', () => {
  it('resolves openrouter runtime config from run-context model', () => {
    const config = openrouterFromRunContext({
      aliases: [],
      id: 'openrouter:openai/gpt-4.1-mini',
      inferenceExecutor: 'openrouter',
      inferenceExecutorId: 'openrouter',
      model: 'openai/gpt-4.1-mini',
      parameters: {
        apiKey: 'openrouter-api-key',
        baseURL: 'https://openrouter.ai/api/v1',
      },
    })

    expect(config).toEqual({
      apiKey: 'openrouter-api-key',
      baseURL: 'https://openrouter.ai/api/v1',
      headers: undefined,
      inferenceExecutor: 'openrouter',
      model: 'openai/gpt-4.1-mini',
    })
  })
})
