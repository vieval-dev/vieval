import type { LocalizedText } from 'vieval/events'

import { currentLanguages, matchLocale } from './i18n'

/**
 * Picks the text of a label or description for the reader's languages.
 *
 * Use when:
 * - showing a metric or artifact label, or description, recorded as one string or one string per locale
 *
 * Expects:
 * - `languages` in preference order, as `navigator.languages` gives them (`['zh-CN', 'en']`); by default the viewer's
 *   locale first, then the browser's languages, so an eval's label follows the language picked in the preferences
 *
 * Returns:
 * - the string itself for a plain string; otherwise the translation whose language and script match a preferred
 *   language (`zh-CN` reads `zh-Hans`, `zh-TW` reads `zh-Hant`), else the bare language, else `en`, else the first
 *   translation; `undefined` without text
 */
export function localize(text: LocalizedText | undefined, languages: readonly string[] = currentLanguages()): string | undefined {
  if (text == null || typeof text === 'string')
    return text
  const entries = Object.entries(text)
  if (entries.length === 0)
    return undefined
  const tag = matchLocale(Object.keys(text), languages, { sameLanguage: true })
  return text[tag ?? 'en'] ?? entries[0]![1]
}
