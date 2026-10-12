<script setup lang="ts">
import type { MatrixAxes } from '../labels'

import { computed } from 'vue'

import IdLabel from './IdLabel.vue'

import { experimentLabel } from '../labels'

/**
 * Readable name of an experiment (`experimentLabel`): the matrix for default ids, the chosen id plus matrix chips
 * otherwise. The full id is in the tooltip and the copy button.
 */
const props = defineProps<{
  experimentId: string
  href?: string
  matrix: MatrixAxes | undefined
  /** See `IdLabel`'s `stretch`. */
  stretch?: boolean
}>()
const label = computed(() => experimentLabel(props.experimentId, props.matrix))
</script>

<template>
  <span :class="['inline-flex items-center gap-1.5 flex-wrap min-w-0']">
    <IdLabel :id="props.experimentId" :href="props.href" :label="label.text" :stretch="props.stretch" />
    <template v-if="!label.textIsMatrix">
      <span v-for="chip in label.chips" :key="chip.axis" :class="['badge state-neutral font-normal']">
        <span class="muted">{{ chip.axis }}</span>{{ chip.values }}
      </span>
    </template>
  </span>
</template>
