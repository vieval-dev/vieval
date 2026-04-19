import { describe, expect, it } from 'vitest'

import { ollamaFromRunContext, openaiFromRunContext, toChatModelRuntimeConfig, toOllamaChatModelRuntimeConfig, toOpenAIChatModelRuntimeConfig } from './runtime-config'

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

describe('toOpenAIChatModelRuntimeConfig', () => {
  it('returns typed openai config', () => {
    const config = toOpenAIChatModelRuntimeConfig({
      aliases: [],
      id: 'openai:gpt-4.1-mini',
      inferenceExecutor: 'openai',
      inferenceExecutorId: 'openai',
      model: 'gpt-4.1-mini',
      parameters: {
        apiKey: 'test-api-key',
      },
    })

    expect(config.inferenceExecutor).toBe('openai')
    expect(config.apiKey).toBe('test-api-key')
  })
})

describe('toOllamaChatModelRuntimeConfig', () => {
  it('returns typed ollama config', () => {
    const config = toOllamaChatModelRuntimeConfig({
      aliases: [],
      id: 'ollama:llama3.1',
      inferenceExecutor: 'ollama',
      inferenceExecutorId: 'ollama',
      model: 'llama3.1',
      parameters: {
        baseURL: 'http://127.0.0.1:11434',
      },
    })

    expect(config.inferenceExecutor).toBe('ollama')
    expect(config.baseURL).toBe('http://127.0.0.1:11434')
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
