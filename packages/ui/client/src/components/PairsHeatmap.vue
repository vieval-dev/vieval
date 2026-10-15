<script setup lang="ts">
import type { CaseRow, MetricSeparation } from '../caseMetrics'

import { computed, shallowRef } from 'vue'

import { correlationOf } from '../caseMetrics'

/**
 * Every pair of metrics as one cell colored by how they move together (correlation on `log1p` values): the compact
 * form of a scatterplot matrix, which fits a dozen metrics where a matrix of scatterplots would be a wall of specks.
 * The diagonal holds each metric's AUC (how well it alone tells failed from passed cases). Picking a cell asks the
 * parent to show that pair as a scatterplot.
 */
const props = defineProps<{
  labelOf: (name: string) => string
  /** Metrics in matrix order. */
  metrics: readonly string[]
  rows: readonly CaseRow[]
  /** The pair shown as a scatterplot, highlighted. */
  selectedPair?: readonly [string, string]
  separation: ReadonlyMap<string, MetricSeparation>
}>()
const emit = defineEmits<{ select: [pair: [string, string]] }>()

const cells = computed(() => props.metrics.map((rowMetric, row) => props.metrics.slice(0, row).map((columnMetric) => {
  const n = props.rows.filter(item => item.numbers[rowMetric] != null && item.numbers[columnMetric] != null).length
  return { column: columnMetric, n, r: correlationOf(props.rows, columnMetric, rowMetric), row: rowMetric }
})))

// The cell under the pointer or focus, read out under the grid (one line instead of a tooltip per cell).
const readout = shallowRef<{ text: string }>()
function describe(cell: { column: string, n: number, r: number, row: string }): string {
  const strength = Math.abs(cell.r) >= 0.7 ? 'move together' : Math.abs(cell.r) >= 0.4 ? 'loosely related' : 'mostly independent'
  return `${props.labelOf(cell.column)} × ${props.labelOf(cell.row)} · r ${cell.r.toFixed(2)} (${strength}${cell.r < -0.4 ? ', opposite' : ''}) · ${cell.n} cases`
}
function isSelected(cell: { column: string, row: string }) {
  return props.selectedPair != null
    && props.selectedPair.includes(cell.column) && props.selectedPair.includes(cell.row)
}
/** Positive correlations in the primary hue, negative ones in teal; opacity follows |r|. */
const fill = (r: number) => `color-mix(in oklab, ${r >= 0 ? 'var(--series-1)' : 'var(--series-3)'} ${Math.round(Math.abs(r) * 100)}%, transparent)`
</script>

<template>
  <div :class="['grid gap-2']" data-testid="pairs-heatmap">
    <div :class="['overflow-x-auto']">
      <div :class="['grid gap-0.5 w-max']" :style="{ gridTemplateColumns: `minmax(0, 10rem) repeat(${props.metrics.length}, 2.75rem)` }">
        <template v-for="(rowMetric, row) in props.metrics" :key="rowMetric">
          <span :class="['text-xs muted truncate self-center pr-2 text-right']" :title="rowMetric">{{ props.labelOf(rowMetric) }}</span>
          <button
            v-for="cell in cells[row]" :key="cell.column" type="button"
            :class="[
              'h-9 rounded-sm text-[11px] mono tabular-nums transition-shadow focus-visible:(outline-2 outline-primary-500)',
              Math.abs(cell.r) > 0.6 ? 'text-white' : 'text-neutral-700 dark:text-neutral-200',
              isSelected(cell) ? 'ring-2 ring-neutral-900 dark:ring-white' : 'hover:ring-2 hover:ring-primary-500/60',
            ]"
            :style="{ background: fill(cell.r) }"
            :aria-pressed="isSelected(cell)"
            :aria-label="describe(cell)"
            @pointerenter="readout = { text: describe(cell) }" @focus="readout = { text: describe(cell) }"
            @pointerleave="readout = undefined" @blur="readout = undefined"
            @click="emit('select', [cell.column, cell.row])"
          >
            {{ cell.r.toFixed(2).replace(/^(-?)0\./, '$1.') }}
          </button>
          <!-- Diagonal: how well this metric alone tells failed from passed cases. -->
          <span :class="['h-9 rounded-sm grid place-items-center text-[10px] mono muted border border-dashed border-neutral-300/70 dark:border-neutral-700/60']" :title="`AUC of ${props.labelOf(rowMetric)}`">
            {{ props.separation.get(rowMetric)?.auc.toFixed(2).replace(/^0\./, '.') ?? '—' }}
          </span>
          <span v-for="index in props.metrics.length - row - 1" :key="`blank-${index}`" aria-hidden="true" />
        </template>
        <!-- Column labels under the grid, written bottom to top so narrow columns keep whole names. -->
        <span aria-hidden="true" />
        <span v-for="columnMetric in props.metrics" :key="`label-${columnMetric}`" :class="['text-[11px] muted justify-self-center max-h-28 truncate [writing-mode:vertical-rl] rotate-180 pt-1']" :title="columnMetric">{{ props.labelOf(columnMetric) }}</span>
      </div>
    </div>
    <div :class="['flex flex-wrap items-center gap-x-4 gap-y-1 text-xs muted min-h-5']">
      <span v-if="readout" :class="['text-neutral-800 dark:text-neutral-200']">{{ readout.text }}</span>
      <template v-else>
        <span :class="['inline-flex items-center gap-1']"><span :class="['inline-block w-3 h-3 rounded-sm']" :style="{ background: fill(0.9) }" />move together</span>
        <span :class="['inline-flex items-center gap-1']"><span :class="['inline-block w-3 h-3 rounded-sm']" :style="{ background: fill(-0.9) }" />move opposite</span>
        <span>diagonal: AUC (failed vs passed) · click a cell for its scatterplot</span>
      </template>
    </div>
  </div>
</template>
