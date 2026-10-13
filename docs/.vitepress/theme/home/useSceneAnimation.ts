import type { DOMTarget, Scope, Tickable } from 'animejs'
import type { Ref } from 'vue'

import { createScope } from 'animejs'
import { onBeforeUnmount, onMounted } from 'vue'

/**
 * Builds the animations of one scene inside an anime.js scope.
 *
 * Selectors passed to anime.js inside the callback resolve within the scene root only.
 * Return every looping or long running animation so it can pause while the scene is off screen.
 */
export type SceneBuilder = (scope: Scope) => Tickable[]

/**
 * Runs a scene's anime.js animations only while the scene is visible.
 *
 * Use when:
 * - a home page scene animates SVG or DOM nodes under one root element
 *
 * Expects:
 * - the markup to render a complete, readable still frame without JavaScript, because
 *   server rendering, `prefers-reduced-motion: reduce`, and off-screen scenes all show it
 * - `build` to set any hidden initial state itself (for example with `utils.set`)
 *
 * Returns:
 * - nothing; the scope starts on first intersection and is reverted on unmount,
 *   which restores the markup to its still frame
 */
export function useSceneAnimation(root: Ref<DOMTarget | undefined>, build: SceneBuilder) {
  let scope: Scope | undefined
  let observer: IntersectionObserver | undefined
  let tickables: Tickable[] = []

  onMounted(() => {
    const element = root.value
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return

    // Building lazily keeps scenes below the fold from spending frames before anyone scrolls to them,
    // and pausing keeps six looping scenes from competing for the main thread.
    observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) {
        tickables.forEach(tickable => tickable.pause())
        return
      }

      if (scope) {
        tickables.forEach(tickable => tickable.resume())
        return
      }

      scope = createScope({ root: element })
      try {
        scope.add((self) => {
          tickables = build(self!)
        })
      }
      catch (error) {
        // A broken scene should fall back to its still frame instead of staying half initialized.
        scope.revert()
        tickables = []
        console.error('[vieval docs] scene animation failed', error)
      }
    }, { threshold: 0.15 })

    observer.observe(element)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    scope?.revert()
  })
}
