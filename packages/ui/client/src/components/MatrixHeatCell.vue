<script setup lang="ts">
import type { ScoreDefinition } from '../../../src/shared/contract'
import type { CellComparison, GridCell } from '../matrixGrid'
import type { HeatFill } from './HeatCell.vue'

import { computed } from 'vue'

import CompletionRing from './CompletionRing.vue'
import HeatCell from './HeatCell.vue'
import MatrixCellDetail from './MatrixCellDetail.vue'

import { href } from '../router'

/**
 * One cell of the compact matrix: its score (or its difference from the baseline) on a fill whose strength follows
 * the value, so a whole grid reads at a glance. Hovering opens the cell's details ({@link MatrixCellDetail}: its full
 * card, configuration, every score, and its baseline comparison); the cell itself links to the task like the card does.
 */
const props = defineProps<{
  averagedNames: readonly string[]
  /** Text of the reader's baseline, for the comparison in the details. */
  baselineLabel?: string
  /** Outlined: the best settled cell of its row. */
  best?: boolean
  cell: GridCell
  comparison?: CellComparison
  /** The cell's values on the laid-out axes, for the details. */
  coordinates: readonly { name: string, value: string }[]
  definitions: readonly ScoreDefinition[]
  /** Narrow cells for wide grids: whole numbers, smaller type. */
  dense?: boolean
  /** The cell is a baseline cell: its own score, unfilled inside a dashed outline, for the differences around it. */
  isBase?: boolean
  /** Fill strength 0–1 (from the grid's color scale); `undefined` leaves the cell unfilled (incomplete, no pair). */
  strength?: number
}>()

const lead = computed(() => props.cell.members[0]!)
const shown = computed(() => {
  if (props.comparison != null) {
    const points = props.comparison.delta * 100
    const sign = points > 0 ? '+' : points < 0 ? '−' : '±'
    return `${sign}${Math.abs(points).toFixed(props.dense ? 0 : 1)}`
  }
  return props.cell.value == null ? '—' : (props.cell.value * 100).toFixed(props.dense ? 0 : 1)
})
// Gains and plain scores in the score hue, losses in the opposite hue (`PairsHeatmap.vue`); a difference within noise
// is faint. The fill strength and the ink are the shared heat cell's (`HeatCell.vue`, which caps the fill for contrast);
// this cell previously filled up to 95% and switched to `--heat-ink` above 60%, which left some cells hard to read.
const fill = computed<HeatFill | undefined>(() => (props.strength == null
  ? undefined
  : {
      faint: props.comparison != null && !props.comparison.clear,
      hue: props.comparison != null && props.comparison.delta < 0 ? 'loss' : 'gain',
      strength: props.strength,
    }))
</script>

<template>
  <HeatCell
    :text="shown" :fill="fill" :is-base="props.isBase" :best="props.best" :dense="props.dense"
    :href="href({ name: 'task', runKey: lead.latest.runKey, taskId: lead.latest.taskId })" test-id="matrix-heat-cell"
  >
    <CompletionRing v-if="props.cell.completion" :class="['absolute top-0.5 right-0.5']" :completion="props.cell.completion" :size="props.dense ? 9 : 11" />
    <template #detail>
      <MatrixCellDetail :cell="props.cell" :comparison="props.comparison" :coordinates="props.coordinates" :baseline-label="props.baselineLabel" :definitions="props.definitions" :averaged-names="props.averagedNames" />
    </template>
  </HeatCell>
</template>
