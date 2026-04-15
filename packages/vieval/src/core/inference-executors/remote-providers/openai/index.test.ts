import { describe, expect, it } from 'vitest'

import { createOpenAIFromEnv, normalizeOpenAITextOutput } from './index'

describe('normalizeOpenAITextOutput', () => {
  it('returns empty string when provider text is null', () => {
    expect(normalizeOpenAITextOutput({ text: null })).toBe('')
  })

  it('returns text when provider text is a string', () => {
    expect(normalizeOpenAITextOutput({ text: 'hello' })).toBe('hello')
  })
})

describe('createOpenAIFromEnv', () => {
  it('reads required values from default env keys', () => {
    const runtime = createOpenAIFromEnv({
      env: {
        OPENAI_API_KEY: 'sk-test',
        OPENAI_MODEL: 'gpt-4.1-mini',
      },
    })

    expect(runtime.apiKey).toBe('sk-test')
    expect(runtime.model).toBe('gpt-4.1-mini')
    expect(runtime.baseURL).toBeUndefined()
  })

  it('uses fallback defaults when env keys are missing', () => {
    const runtime = createOpenAIFromEnv(
      {
        env: {},
      },
      {
        apiKey: 'sk-default',
        model: 'gpt-4.1-nano',
        baseURL: 'https://example.com/v1',
      },
    )

    expect(runtime.apiKey).toBe('sk-default')
    expect(runtime.model).toBe('gpt-4.1-nano')
    expect(runtime.baseURL).toBe('https://example.com/v1')
  })

  it('supports custom key names', () => {
    const runtime = createOpenAIFromEnv({
      apiKey: 'CUSTOM_API_KEY',
      env: {
        CUSTOM_API_KEY: 'sk-custom',
        CUSTOM_BASE_URL: 'https://custom.local/v1',
        CUSTOM_MODEL: 'o4-mini',
      },
      baseURL: 'CUSTOM_BASE_URL',
      model: 'CUSTOM_MODEL',
    })

    expect(runtime.apiKey).toBe('sk-custom')
    expect(runtime.baseURL).toBe('https://custom.local/v1')
    expect(runtime.model).toBe('o4-mini')
  })

  it('throws when required key is missing and no fallback is provided', () => {
    expect(() => createOpenAIFromEnv({
      env: {
        OPENAI_MODEL: 'gpt-4.1-mini',
      },
    })).toThrow('Missing required OPENAI_API_KEY.')
  })
})
