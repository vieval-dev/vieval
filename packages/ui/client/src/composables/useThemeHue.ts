import { useLocalStorage } from '@vueuse/core'
import { computed, watchEffect } from 'vue'

import { DEFAULT_HUE, HUE_STORAGE_KEY, HUE_VARIABLE, normalizeHue } from '../theme'

/**
 * Theme hue picked by the user, persisted in `localStorage` and applied to `<html>` as `--chromatic-hue`.
 *
 * Use when:
 * - the hue picker reads or changes the hue (`App.vue` mounts it once)
 *
 * Returns:
 * - `hue` (0–360, writable) and `reset()` back to {@link DEFAULT_HUE}; every `primary-*` color follows at once
 */
export function useThemeHue() {
  const stored = useLocalStorage<number>(HUE_STORAGE_KEY, DEFAULT_HUE)
  const hue = computed({
    get: () => normalizeHue(stored.value),
    set: (value: number) => (stored.value = normalizeHue(value)),
  })
  watchEffect(() => document.documentElement.style.setProperty(HUE_VARIABLE, String(hue.value)))
  return { hue, reset: () => (hue.value = DEFAULT_HUE) }
}
