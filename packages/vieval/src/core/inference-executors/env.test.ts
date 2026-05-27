import { describe, expect, it } from 'vitest'

import { envFrom, requiredEnvFrom } from './env'

describe('envFrom', () => {
  it('returns string value when present', () => {
    const value = envFrom({
      OPENAI_MODEL: 'gpt-4o-mini',
    }, {
      name: 'OPENAI_MODEL',
      type: 'string',
    })

    expect(value).toBe('gpt-4o-mini')
  })

  it('returns undefined when value is missing and required=false', () => {
    const env: Record<string, string | undefined> = {}
    const value = envFrom(env, {
      name: 'OPENAI_MODEL',
      type: 'string',
    })

    expect(value).toBeUndefined()
  })

  it('throws when required=true and value is missing', () => {
    const env: Record<string, string | undefined> = {}
    expect(() => envFrom(env, {
      name: 'OPENAI_API_KEY',
      required: true,
      type: 'string',
    })).toThrow('Missing required OPENAI_API_KEY.')
  })

  it('throws when required=true and value is empty after trimming', () => {
    expect(() => envFrom({
      OPENAI_API_KEY: '   ',
    }, {
      name: 'OPENAI_API_KEY',
      required: true,
      type: 'string',
    })).toThrow('Missing required OPENAI_API_KEY.')
  })
})

describe('requiredEnvFrom', () => {
  it('returns value when present', () => {
    const value = requiredEnvFrom({
      OPENAI_MODEL: 'gpt-4.1-mini',
    }, {
      name: 'OPENAI_MODEL',
      type: 'string',
    })

    expect(value).toBe('gpt-4.1-mini')
  })

  it('throws when value is missing', () => {
    const env: Record<string, string | undefined> = {}
    expect(() => requiredEnvFrom(env, {
      name: 'OPENAI_MODEL',
      type: 'string',
    })).toThrow('Missing required OPENAI_MODEL.')
  })
})
