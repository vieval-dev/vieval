<script lang="ts">
import type { PrimitiveProps } from 'reka-ui'
</script>

<script setup lang="ts">
import { Primitive } from 'reka-ui'

/**
 * Props of {@link AnimatedContent}.
 */
export interface AnimatedContentProps {
  /**
   * Element rendered as the animated outer container.
   *
   * @default 'div'
   */
  as?: PrimitiveProps['as']
}

/**
 * Container of a floating menu or popover that expands and focuses in on open and collapses on close, ported from
 * `AnimatedContent` of `@proj-airi/ui` (`moeru-ai/airi`, `packages/ui/src/components/animations/animated-content.vue`).
 *
 * Use as the `as-child` of reka-ui `DropdownMenuContent` / `PopoverContent`: reka renders this root, sets
 * `data-state="open|closed"` on it, and keeps it mounted until the closing animation ended, so the CSS below needs no
 * Vue state of its own.
 */
const props = withDefaults(defineProps<AnimatedContentProps>(), { as: 'div' })
</script>

<template>
  <Primitive :as="props.as" class="animated-content">
    <div class="animated-content__inner">
      <slot />
    </div>
  </Primitive>
</template>

<style>
/*
 * Same motion as airi's `AnimatedContent` (see that file for the references to drawesome's MorphBar and Video.js
 * popups it follows): the outer box fades in, moves 4px down, and grows from height 0 to auto; the inner layer
 * focuses from a 6px blur. Blur stays on the inner layer so the border and shadow of the surface stay sharp;
 * `overflow: clip` clips only the content during the height animation.
 *
 * `interpolate-size: allow-keywords` animates `height: auto` natively (Chromium); other browsers keep the fade and
 * the translation. https://developer.chrome.com/docs/css-ui/animate-to-height-auto
 *
 * The selectors are global classes because reka teleports the content out of this component's scope.
 */
.animated-content {
  overflow: clip;
}

.animated-content[data-state="open"] {
  animation: animated-content-fade-expand 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

.animated-content[data-state="closed"] {
  animation: animated-content-fade-collapse 160ms ease-in;
}

.animated-content[data-state="open"] .animated-content__inner {
  animation: animated-content-inner-focus-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

.animated-content[data-state="closed"] .animated-content__inner {
  animation: animated-content-inner-focus-out 160ms ease-in;
}

@supports (interpolate-size: allow-keywords) {
  .animated-content {
    height: auto;
    interpolate-size: allow-keywords;
  }

  .animated-content[data-state="open"] {
    animation-name: animated-content-size-expand;
  }

  .animated-content[data-state="closed"] {
    animation-name: animated-content-size-collapse;
  }
}

@keyframes animated-content-fade-expand {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes animated-content-fade-collapse {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(-4px); }
}

@keyframes animated-content-size-expand {
  from { height: 0; opacity: 0; transform: translateY(-4px); }
  to { height: auto; opacity: 1; transform: translateY(0); }
}

@keyframes animated-content-size-collapse {
  from { height: auto; opacity: 1; transform: translateY(0); }
  to { height: 0; opacity: 0; transform: translateY(-4px); }
}

@keyframes animated-content-inner-focus-in {
  from { filter: blur(6px); }
  to { filter: blur(0); }
}

@keyframes animated-content-inner-focus-out {
  from { filter: blur(0); }
  to { filter: blur(6px); }
}

@media (prefers-reduced-motion: reduce) {
  .animated-content[data-state],
  .animated-content[data-state] .animated-content__inner {
    animation: none;
  }
}
</style>
