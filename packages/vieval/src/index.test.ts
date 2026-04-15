import { describe, expect, it } from 'vitest'

import { defineConfig, loadEnv } from './index'

describe('root exports', () => {
  it('re-exports config helpers from root entrypoint', () => {
    expect(typeof defineConfig).toBe('function')
    expect(typeof loadEnv).toBe('function')
  })
})
