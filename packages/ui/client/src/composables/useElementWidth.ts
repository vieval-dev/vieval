import type { Ref } from 'vue'

import { useResizeObserver } from '@vueuse/core'
import { shallowRef } from 'vue'

/**
 * Content width of an element in CSS pixels, kept current with a `ResizeObserver`.
 *
 * Charts draw with a `viewBox` equal to this width, so text and marks keep their pixel size at any layout width.
 * A width of 0 (hidden container) keeps the previous width, so a chart never collapses to an empty `viewBox`.
 */
export function useElementWidth(element: Ref<HTMLElement | null | undefined>, fallback: number) {
  const width = shallowRef(fallback)
  useResizeObserver(element, ([entry]) => {
    if (entry != null && entry.contentRect.width > 0)
      width.value = Math.round(entry.contentRect.width)
  })
  return width
}
