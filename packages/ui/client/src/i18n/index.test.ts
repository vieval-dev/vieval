import { describe, expect, it } from 'vitest'

import { normalizeLocalePreference, resolveLocale } from '.'

describe('resolveLocale', () => {
  /**
   * @example
   * expect(resolveLocale(['zh-CN', 'en'])).toBe('zh-Hans')
   */
  it('matches the browser languages to a supported locale by language and script', () => {
    expect(resolveLocale(['zh-CN', 'en'])).toBe('zh-Hans')
    expect(resolveLocale(['zh'])).toBe('zh-Hans')
    expect(resolveLocale(['en-GB'])).toBe('en')
    expect(resolveLocale(['ja', 'zh-SG'])).toBe('zh-Hans')
  })

  /**
   * @example
   * expect(resolveLocale(['zh-TW'])).toBe('en')
   */
  it('falls back to English for unsupported languages, other scripts, malformed tags, and no languages', () => {
    expect(resolveLocale(['zh-TW'])).toBe('en')
    expect(resolveLocale(['ja'])).toBe('en')
    expect(resolveLocale(['not a tag'])).toBe('en')
    expect(resolveLocale([])).toBe('en')
  })
})

describe('normalizeLocalePreference', () => {
  /**
   * @example
   * expect(normalizeLocalePreference('zh-CN')).toBe('auto')
   */
  it('keeps supported locales and `auto`, and reads anything else as `auto`', () => {
    expect(normalizeLocalePreference('zh-Hans')).toBe('zh-Hans')
    expect(normalizeLocalePreference('auto')).toBe('auto')
    expect(normalizeLocalePreference('zh-CN')).toBe('auto')
    expect(normalizeLocalePreference(null)).toBe('auto')
  })
})
