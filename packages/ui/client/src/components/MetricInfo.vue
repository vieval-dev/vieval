<script setup lang="ts">
import type { MetricDefinition } from '../../../src/shared/contract'

import { HoverCardArrow, HoverCardContent, HoverCardPortal, HoverCardRoot, HoverCardTrigger } from 'reka-ui'

import AnimatedContent from './AnimatedContent.vue'
import MetricSummary from './MetricSummary.vue'

/**
 * Hover card of one metric around any trigger (a chip, a chart caption, a list row): shows {@link MetricSummary}.
 */
const props = defineProps<{
  current?: number | string
  definition?: MetricDefinition
  name: string
  values: readonly unknown[]
}>()
</script>

<template>
  <HoverCardRoot :open-delay="300" :close-delay="100">
    <HoverCardTrigger as-child>
      <slot />
    </HoverCardTrigger>
    <HoverCardPortal>
      <HoverCardContent as-child :side-offset="6" :class="['floating p-2.5 text-xs select-text']">
        <AnimatedContent>
          <MetricSummary :name="props.name" :definition="props.definition" :values="props.values" :current="props.current" />
          <HoverCardArrow :class="['floating-arrow']" />
        </AnimatedContent>
      </HoverCardContent>
    </HoverCardPortal>
  </HoverCardRoot>
</template>
