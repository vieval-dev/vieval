import type { LocalizedText } from 'vieval/events'

/**
 * Picks the text of a label or description for the reader's languages.
 *
 * Use when:
 * - showing a metric or artifact label, or description, recorded as one string or one string per locale
 *
 * Expects:
 * - `languages` in preference order, as `navigator.languages` gives them (`['zh-CN', 'en']`)
 *
 * Returns:
 * - the string itself for a plain string; otherwise the translation whose language and script match a preferred
 *   language (`zh-CN` reads `zh-Hans`, `zh-TW` reads `zh-Hant`), else the bare language, else `en`, else the first
 *   translation; `undefined` without text
 */
export function localize(text: LocalizedText | undefined, languages: readonly string[] = globalThis.navigator?.languages ?? []): string | undefined {
  if (text == null || typeof text === 'string')
    return text
  const entries = Object.entries(text)
  if (entries.length === 0)
    return undefined
  const tagged = entries.map(([tag, value]) => ({ locale: maximized(tag), value }))
  for (const language of languages) {
    const wanted = maximized(language)
    if (wanted == null)
      continue
    const exact = tagged.find(entry => entry.locale?.language === wanted.language && entry.locale.script === wanted.script)
    if (exact != null)
      return exact.value
    const sameLanguage = tagged.find(entry => entry.locale?.language === wanted.language)
    if (sameLanguage != null)
      return sameLanguage.value
  }
  return text.en ?? entries[0]![1]
}

/** Language and likely script of a BCP 47 tag (`zh-CN` → `zh` + `Hans`); `undefined` for a malformed tag. */
function maximized(tag: string): undefined | { language: string, script?: string } {
  try {
    const locale = new Intl.Locale(tag).maximize()
    return { language: locale.language, script: locale.script }
  }
  catch {
    return undefined
  }
}
