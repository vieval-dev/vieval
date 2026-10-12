<script setup lang="ts">
import { TooltipArrow, TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui'

/**
 * Readable label of a report level whose full id is in its tooltip.
 *
 * Use for experiment, attempt, and run names (`labels.ts`). Copying the id is an explicit action ("Copy ID" in an
 * `IdMenu`), not an icon next to every label.
 */
const props = defineProps<{
  /** Link target of the label; plain text without it. */
  href?: string
  /** Full id, shown in the tooltip and copied by the button. */
  id: string
  /** Readable label (`experimentLabel`, `attemptLabel`, `runLabel`). */
  label: string
  /**
   * Stretches the link over the nearest positioned ancestor (a row or card), so all of it is clickable while other
   * controls in it stay their own (a button inside a link is invalid HTML; such controls need `relative z-1`).
   */
  stretch?: boolean
}>()
</script>

<template>
  <span :class="['inline-flex items-center gap-1 min-w-0 max-w-full']">
    <TooltipRoot :delay-duration="400">
      <TooltipTrigger as-child>
        <a v-if="props.href" :href="props.href" :class="['link truncate min-w-0', props.stretch && 'stretched-link']">{{ props.label }}</a>
        <span v-else :class="['truncate min-w-0']" tabindex="0">{{ props.label }}</span>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent :side-offset="4" :class="['tooltip max-w-[min(40rem,90vw)] break-all']">
          <span :class="['opacity-70']">ID </span><span :class="['font-mono']">{{ props.id }}</span>
          <TooltipArrow :class="['tooltip-arrow']" />
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </span>
</template>
