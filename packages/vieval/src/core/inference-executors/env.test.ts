import { describe, expect, it } from 'vitest'

import { envFrom, requiredEnvFrom } from './env'

describe('envFrom', () => {
  it('returns string value when present', () => {
    const value = envFrom('gpt-4o-mini', {
      type: 'string',
    })

    expect(value).toBe('gpt-4o-mini')
  })

  it('returns undefined when value is missing and required=false', () => {
    const value = envFrom(undefined, {
      type: 'string',
    })

    expect(value).toBeUndefined()
  })

  it('throws when required=true and value is missing', () => {
    expect(() => envFrom(undefined, {
      name: 'OPENAI_API_KEY',
      required: true,
      type: 'string',
    })).toThrow('Missing required OPENAI_API_KEY.')
  })

  it('throws when required=true and value is empty after trimming', () => {
    expect(() => envFrom('   ', {
      name: 'OPENAI_API_KEY',
      required: true,
      type: 'string',
    })).toThrow('Missing required OPENAI_API_KEY.')
  })
})

describe('requiredEnvFrom', () => {
  it('returns value when present', () => {
    const value = requiredEnvFrom('gpt-4.1-mini', {
      name: 'OPENAI_MODEL',
      type: 'string',
    })

    expect(value).toBe('gpt-4.1-mini')
  })

  it('throws when value is missing', () => {
    expect(() => requiredEnvFrom(undefined, {
      name: 'OPENAI_MODEL',
      type: 'string',
    })).toThrow('Missing required OPENAI_MODEL.')
  })
})
