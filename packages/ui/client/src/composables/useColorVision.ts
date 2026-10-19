import type { ColorVision } from '../theme'

import { useLocalStorage } from '@vueuse/core'
import { computed, watchEffect } from 'vue'

import { COLOR_VISION_STORAGE_KEY, normalizeColorVision } from '../theme'

/**
 * Color vision mode picked by the user, persisted in `localStorage` and applied to `<html>` as `data-color-vision`.
 *
 * Use when:
 * - the theme color popover reads or changes the mode (`App.vue` mounts it once)
 *
 * Returns:
 * - `colorVision` (writable); every state color (`--mark-*`, `--ink-*` in `styles.css`) follows at once
 */
export function useColorVision() {
  const stored = useLocalStorage<ColorVision>(COLOR_VISION_STORAGE_KEY, 'default')
  const colorVision = computed({
    get: () => normalizeColorVision(stored.value),
    set: (value: ColorVision) => (stored.value = normalizeColorVision(value)),
  })
  watchEffect(() => {
    if (colorVision.value === 'safe')
      document.documentElement.dataset.colorVision = 'safe'
    else
      delete document.documentElement.dataset.colorVision
  })
  return { colorVision }
}
