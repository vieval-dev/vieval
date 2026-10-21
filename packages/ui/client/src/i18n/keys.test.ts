import { describe, expect, it } from 'vitest'

import en from './locales/en'

/**
 * Every source file of the viewer, as text. `t()` takes any string, so vue-tsc does not catch a misspelled key; this
 * reads the keys the sources pass and checks them against the `en` messages instead.
 */
const sources = import.meta.glob<string>(['../**/*.{ts,vue}', '!../**/*.test.ts', '!./locales/**'], { eager: true, import: 'default', query: '?raw' })

/** The value at a dotted path of the messages, or `undefined` when a segment is missing. */
function messageAt(path: string): unknown {
  return path.split('.').reduce<unknown>((node, segment) => (node != null && typeof node === 'object' ? (node as Record<string, unknown>)[segment] : undefined), en)
}

/**
 * Keys passed as literals (`t('runs.home.title')`, `keypath="runs.chart.rate"`), and the fixed prefixes of keys built
 * from a template (`t(\`states.${state}\`)` reads the prefix `states`).
 */
function usedKeys(): { file: string, key: string, prefix: boolean }[] {
  const found: { file: string, key: string, prefix: boolean }[] = []
  for (const [file, text] of Object.entries(sources)) {
    for (const match of text.matchAll(/\bt\(\s*(['"])([\w.-]+)\1/g)) {
      found.push({ file, key: match[2]!, prefix: false })
    }
    for (const match of text.matchAll(/\bkeypath="([\w.-]+)"/g)) {
      found.push({ file, key: match[1]!, prefix: false })
    }
    for (const match of text.matchAll(/\bt\(\s*`([\w.-]+)\.\$\{/g)) {
      found.push({ file, key: match[1]!, prefix: true })
    }
  }
  return found
}

describe('message keys', () => {
  /**
   * @example
   * expect(missing).toEqual([])
   */
  it('finds every key the sources pass in the en messages', () => {
    const keys = usedKeys()
    const missing = keys
      .filter(({ key, prefix }) => prefix ? typeof messageAt(key) !== 'object' : typeof messageAt(key) !== 'string')
      .map(({ file, key }) => `${file}: ${key}`)

    // The scan must see the sources, or an empty result would pass for the wrong reason.
    expect(keys.length).toBeGreaterThan(100)
    expect(missing).toEqual([])
  })
})
