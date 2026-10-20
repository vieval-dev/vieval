import { createI18n } from 'vue-i18n'

import en from './locales/en'
import zhHans from './locales/zh-Hans'

// Messages of the viewer chrome, one TypeScript module per area and locale:
//
//   locales/en/index.ts         combines the area modules; `en` is the schema (`Messages`)
//   locales/en/<area>.ts        common, navigation, preferences, states, runs, cases, compare, matrix, metrics, scores,
//                               evidence: a plain object literal (no `as const`, so values stay `string`)
//   locales/zh-Hans/<area>.ts   the same keys, `satisfies` the en module type: a missing or misspelled key fails vue-tsc
//
// Keys are nested camelCase objects (`preferences.language.auto`). Values use vue-i18n's message syntax:
// - named placeholders: `'More actions for this {kind}'`, called as `t('…', { kind })`
// - pipe plurals where English needs them: `'{n} case | {n} cases'`, called as `t('…', { n }, n)`
// - `@`, `{`, `}`, `|`, and `$` are syntax; write them as literals (`{'@'}`) when the text needs them
// Report data (case names, metric names, errors, ids) is never a message.

/** Messages of one locale; `en` is the schema every other locale must match. */
export type Messages = typeof en

/** Locales the viewer is translated into, with the native name the language picker shows. */
export const SUPPORTED_LOCALES = {
  'en': 'English',
  'zh-Hans': '简体中文',
} as const

/** Language picked in the preferences: a supported locale, or `auto` to follow the browser's languages. */
export type LocalePreference = 'auto' | SupportedLocale

/** Code of a locale the viewer is translated into (`en`, `zh-Hans`), as `LocalizedText` keys spell it. */
export type SupportedLocale = keyof typeof SUPPORTED_LOCALES

/**
 * `localStorage` key of the picked language; `client/public/scheme.js` reads the same key to set `<html lang>` before
 * the first paint.
 */
export const LOCALE_STORAGE_KEY = 'vieval-viewer:locale'

/**
 * Picks the tag of `available` that best fits the reader's languages, by language and likely script.
 *
 * Use when:
 * - choosing the viewer's locale ({@link resolveLocale}) or the translation of an eval's `LocalizedText` (`localize`)
 *
 * Expects:
 * - `wanted` in preference order, as `navigator.languages` gives them (`['zh-CN', 'en']`)
 * - `sameLanguage`: whether a tag of the same language but another script may stand in (`zh-TW` reading `zh-Hans`)
 *
 * Returns:
 * - for the first wanted tag that matches anything: the available tag of the same language and script (`zh-CN` and
 *   `zh-Hans` both maximize to `zh-Hans-CN`), else, with `sameLanguage`, the first of the same language; `undefined`
 *   when no wanted tag matches. Malformed tags are skipped.
 */
export function matchLocale<T extends string>(available: readonly T[], wanted: readonly string[], { sameLanguage = false } = {}): T | undefined {
  const tagged = available.map(tag => ({ locale: maximized(tag), tag }))
  for (const language of wanted) {
    const target = maximized(language)
    if (target == null)
      continue
    const exact = tagged.find(entry => entry.locale?.language === target.language && entry.locale.script === target.script)
    if (exact != null)
      return exact.tag
    const similar = sameLanguage ? tagged.find(entry => entry.locale?.language === target.language) : undefined
    if (similar != null)
      return similar.tag
  }
  return undefined
}

/**
 * Normalizes a stored language preference, falling back to `auto`.
 *
 * Before:
 * - "zh-Hans", "zh-CN", null
 *
 * After:
 * - "zh-Hans", "auto", "auto"
 */
export function normalizeLocalePreference(value: unknown): LocalePreference {
  return typeof value === 'string' && Object.hasOwn(SUPPORTED_LOCALES, value) ? value as SupportedLocale : 'auto'
}

/**
 * Resolves the viewer's locale from the reader's languages.
 *
 * Use when:
 * - the language preference is `auto`, and in `public/scheme.js`'s copy before the first paint
 *
 * Expects:
 * - `tags` in preference order (`navigator.languages`)
 *
 * Returns:
 * - the first supported locale of the same language and script (`zh-CN` → `zh-Hans`, `en-GB` → `en`); `en` when none
 *   matches. Another script of a supported language is not a match (`zh-TW` → `en`): it is a different written language.
 */
export function resolveLocale(tags: readonly string[]): SupportedLocale {
  return matchLocale(Object.keys(SUPPORTED_LOCALES) as SupportedLocale[], tags) ?? 'en'
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

/**
 * The viewer's vue-i18n instance (Composition API). `useLocale` sets its locale from the preference; `main.ts`
 * installs it.
 *
 * NOTICE: `fallbackWarn` and `missingWarn` are off because every locale is typed against `en`: a missing key is a
 * vue-tsc error, not a runtime state worth a console warning.
 */
export const i18n = createI18n<[Messages], SupportedLocale, false>({
  fallbackLocale: 'en',
  fallbackWarn: false,
  legacy: false,
  locale: 'en',
  messages: { 'en': en, 'zh-Hans': zhHans },
  missingWarn: false,
})

/**
 * The reader's languages in preference order: the viewer's locale, then the browser's languages.
 *
 * Use when:
 * - picking the translation of an eval's `LocalizedText` outside a component (`localize`'s default)
 *
 * Returns:
 * - `[currentLocale(), ...navigator.languages]`; reactive in the locale like {@link currentLocale}
 */
export function currentLanguages(): string[] {
  return [currentLocale(), ...(globalThis.navigator?.languages ?? [])]
}

/**
 * The locale the viewer shows now, for formatting outside components (`format.ts`, `labels.ts`).
 *
 * Use when:
 * - a plain module formats a number, date, or relative time with `Intl`
 *
 * Returns:
 * - the current locale code; it reads a ref, so a template or `computed` calling it re-runs when the language changes
 */
export function currentLocale(): SupportedLocale {
  return i18n.global.locale.value
}

declare module 'vue-i18n' {
  /** Types the keys of `useI18n().t` and `$t` in every component with the `en` schema. */
  export interface DefineLocaleMessage extends Messages {}
}
