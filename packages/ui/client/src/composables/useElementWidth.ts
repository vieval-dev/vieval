import type { Ref } from 'vue'

import { useResizeObserver } from '@vueuse/core'
import { onMounted, shallowRef } from 'vue'

/**
 * Content width of an element in CSS pixels, kept current with a `ResizeObserver`.
 *
 * Charts draw with a `viewBox` equal to this width, so text and marks keep their pixel size at any layout width.
 * A width of 0 (hidden container) keeps the previous width, so a chart never collapses to an empty `viewBox`.
 * Call it in `setup` before the chart registers its own `onMounted` draw: the width is read on mount, ahead of that
 * draw, so the first frame is drawn at the real width instead of `fallback` and redrawn a frame later (a visible jump
 * when a chart swaps in).
 */
export function useElementWidth(element: Ref<HTMLElement | null | undefined>, fallback: number) {
  const width = shallowRef(fallback)
  // The observer reports only after the next layout; read the content width (no padding) synchronously on mount too.
  onMounted(() => {
    const target = element.value
    if (target == null || target.clientWidth === 0)
      return
    const style = getComputedStyle(target)
    width.value = Math.round(target.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight))
  })
  useResizeObserver(element, ([entry]) => {
    if (entry != null && entry.contentRect.width > 0)
      width.value = Math.round(entry.contentRect.width)
  })
  return width
}
