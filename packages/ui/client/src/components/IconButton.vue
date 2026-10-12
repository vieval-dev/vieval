<script setup lang="ts">
import { TooltipArrow, TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui'

// Attributes go to the button itself, not to the tooltip root, so the button also works as the `as-child` trigger
// of a reka-ui Popover or DropdownMenu (which passes its handlers and ARIA attributes down).
defineOptions({ inheritAttrs: false })

/**
 * Icon-only ghost button with its label as a tooltip (reka-ui Tooltip) and as `aria-label`.
 *
 * Renders a link when `href` is set, otherwise a `<button>`. Needs a `TooltipProvider` above it (`App.vue`).
 */
const props = defineProps<{
  disabled?: boolean
  /** Saves the link target instead of opening it; the value is the suggested file name. */
  download?: string
  href?: string
  /** UnoCSS icon class, for example `i-mingcute-play-line`. */
  icon: string
  /** Accessible name and tooltip text. */
  label: string
  /** Opens a link in a new tab. */
  newTab?: boolean
}>()

const emit = defineEmits<{ click: [event: MouseEvent] }>()
</script>

<template>
  <TooltipRoot :delay-duration="300">
    <TooltipTrigger as-child>
      <a
        v-if="props.href"
        :href="props.href"
        :download="props.download"
        :target="props.newTab ? '_blank' : undefined"
        :rel="props.newTab ? 'noopener' : undefined"
        :aria-label="props.label"
        :class="['icon-btn']"
        v-bind="$attrs"
      >
        <span :class="props.icon" aria-hidden="true" />
      </a>
      <button
        v-else
        type="button"
        :disabled="props.disabled"
        :aria-label="props.label"
        :class="['icon-btn']"
        v-bind="$attrs"
        @click="emit('click', $event)"
      >
        <span :class="props.icon" aria-hidden="true" />
      </button>
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent :side-offset="4" :class="['tooltip']">
        {{ props.label }}
        <TooltipArrow :class="['tooltip-arrow']" />
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
