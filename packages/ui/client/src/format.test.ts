import { describe, expect, it } from 'vitest'

import { formatCount } from './format'
import { i18n } from './i18n'

describe('formatCount', () => {
  /**
   * @example
   * expect(formatCount(48_213)).toBe('48.2K')
   * // with the viewer in Chinese
   * expect(formatCount(48_213)).toBe('4.8万')
   */
  it('keeps small counts exact and shortens large ones in the language picked for the viewer', () => {
    expect(formatCount(9999)).toBe('9999')
    expect(formatCount(48_213)).toBe('48.2K')

    i18n.global.locale.value = 'zh-Hans'

    expect(formatCount(48_213)).toBe('4.8万')
    expect(formatCount(1_000_000)).toBe('100万')
  })
})
