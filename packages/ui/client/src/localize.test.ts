import { describe, expect, it } from 'vitest'

import { localize } from './localize'

const steps = { 'en': 'Agent steps', 'zh-Hans': 'Agent 步数', 'zh-Hant': 'Agent 步數' }

describe('localize', () => {
  /**
   * @example
   * expect(localize(steps, ['zh-CN'])).toBe('Agent 步数')
   */
  it('matches region tags to the translation of the same script', () => {
    expect(localize(steps, ['zh-CN'])).toBe('Agent 步数')
    expect(localize(steps, ['zh-TW'])).toBe('Agent 步數')
    expect(localize(steps, ['en-GB'])).toBe('Agent steps')
  })

  /**
   * @example
   * expect(localize(steps, ['ja', 'fr'])).toBe('Agent steps')
   */
  it('falls back to English, then to the first translation, and passes plain strings through', () => {
    expect(localize(steps, ['ja', 'fr'])).toBe('Agent steps')
    expect(localize({ 'zh-Hans': '步数' }, ['ja'])).toBe('步数')
    expect(localize('Steps', ['zh-CN'])).toBe('Steps')
    expect(localize(undefined, ['en'])).toBeUndefined()
  })
})
