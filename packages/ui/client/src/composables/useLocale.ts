import type { LocalePreference } from '../i18n'

import { useLocalStorage, usePreferredLanguages } from '@vueuse/core'
import { computed, watchEffect } from 'vue'

import { i18n, LOCALE_STORAGE_KEY, normalizeLocalePreference, resolveLocale } from '../i18n'

/**
 * Language picked by the user, persisted in `localStorage` and applied to vue-i18n and `<html lang>`.
 *
 * Use when:
 * - the Preferences popover reads or changes the language (`App.vue` mounts it once to apply it from the start)
 * - a component needs the reader's languages for an eval's `LocalizedText` (`localize` defaults to the same order)
 *
 * Returns:
 * - `preference` (writable): `auto` or a supported locale
 * - `locale`: the locale shown, the browser's best supported language while `auto`
 * - `languages`: `[locale, ...navigator.languages]`, the order `localize` reads translations in
 */
export function useLocale() {
  const stored = useLocalStorage<LocalePreference>(LOCALE_STORAGE_KEY, 'auto')
  // Follows `languagechange`, so `auto` switches when the browser's language list changes.
  const browserLanguages = usePreferredLanguages()
  const preference = computed({
    get: () => normalizeLocalePreference(stored.value),
    set: (value: LocalePreference) => (stored.value = normalizeLocalePreference(value)),
  })
  const locale = computed(() => (preference.value === 'auto' ? resolveLocale(browserLanguages.value) : preference.value))
  const languages = computed(() => [locale.value, ...browserLanguages.value])
  watchEffect(() => {
    i18n.global.locale.value = locale.value
    document.documentElement.lang = locale.value
  })
  return { languages, locale, preference }
}
