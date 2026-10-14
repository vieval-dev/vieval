<script setup lang="ts">
import type { CaseTable, MetricSeparation } from '../caseMetrics'

import { computed, shallowRef } from 'vue'

/**
 * Body of {@link AxisPicker}: a search box and the axes grouped as on the chart, available (metrics ranked by how
 * well they separate failed from passed cases), repeats of another metric, and hidden automatically. Shared by the
 * desktop popover and the phone drawer, the same way AIRI's Live2D report shares its content.
 */
const props = defineProps<{
  labelOf: (name: string) => string
  separation: ReadonlyMap<string, MetricSeparation>
  table: CaseTable
}>()
/** Numeric axes on the chart, in chart order. */
const metrics = defineModel<string[]>('metrics', { required: true })
/** Category axes on the chart. */
const categories = defineModel<string[]>('categories', { required: true })

const query = shallowRef('')
function matches(name: string) {
  const text = query.value.trim().toLowerCase()
  return text === '' || name.toLowerCase().includes(text) || props.labelOf(name).toLowerCase().includes(text)
}
const aucOf = (name: string) => props.separation.get(name)?.auc
const byAuc = (a: string, b: string) => (aucOf(b) ?? 0) - (aucOf(a) ?? 0)

const onChart = computed(() => [...categories.value, ...metrics.value].filter(matches))
const available = computed(() => [
  ...props.table.groups.map(group => group.representative).filter(name => !metrics.value.includes(name)).toSorted(byAuc),
  ...props.table.categories.filter(name => !categories.value.includes(name)),
].filter(matches))
const repeats = computed(() => props.table.groups.flatMap(group => group.members
  .filter(member => !metrics.value.includes(member.name) && matches(member.name))
  .map(member => ({ ...member, of: group.representative }))))

function toggle(name: string): void {
  const list = props.table.categories.includes(name) ? categories : metrics
  list.value = list.value.includes(name) ? list.value.filter(item => item !== name) : [...list.value, name]
}

const row = 'flex items-center gap-2.5 w-full rounded-md px-2 py-1.5 text-left hover:bg-neutral-500/8 focus-visible:(outline-2 outline-primary-500)'
const heading = 'px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider muted'
/** Checkbox glyphs sized to the row text, so they read as controls and are easy to aim at. */
const check = 'shrink-0 text-lg'
</script>

<template>
  <div :class="['flex flex-col min-h-0']">
    <div :class="['p-2 border-b border-neutral-200/70 dark:border-neutral-700/50']">
      <input v-model="query" type="search" placeholder="Search metrics…" aria-label="Search metrics" :class="['w-full rounded-md border border-neutral-300/70 dark:border-neutral-700/60 bg-transparent px-2.5 py-1.5 outline-none focus-visible:(border-primary-500)']">
    </div>
    <div :class="['overflow-y-auto min-h-0 p-1']" data-testid="axis-picker-list">
      <div :class="[heading]">
        On the chart
      </div>
      <button v-for="name in onChart" :key="name" type="button" :class="[row]" :aria-pressed="true" @click="toggle(name)">
        <span :class="['i-mingcute-checkbox-fill text-primary-600 dark:text-primary-300', check]" aria-hidden="true" />
        <span :class="['truncate']" :title="name">{{ props.labelOf(name) }}</span>
        <span v-if="aucOf(name) !== undefined" :class="['ml-auto mono text-xs muted']">AUC {{ aucOf(name)!.toFixed(2) }}</span>
      </button>

      <div :class="[heading]">
        Available · best at telling failed from passed first
      </div>
      <button v-for="name in available" :key="name" type="button" :class="[row]" :aria-pressed="false" @click="toggle(name)">
        <span :class="['i-mingcute-square-line muted', check]" aria-hidden="true" />
        <span :class="['truncate']" :title="name">{{ props.labelOf(name) }}</span>
        <span v-if="table.categories.includes(name)" :class="['ml-auto text-xs muted']">category</span>
        <!-- Separation as a bar from 0.5 (none) to 1 (perfect), with the AUC beside it. -->
        <span v-else-if="aucOf(name) !== undefined" :class="['ml-auto flex items-center gap-1.5 shrink-0']" :title="`AUC ${aucOf(name)!.toFixed(2)}: higher in ${separation.get(name)!.higherIn} cases`">
          <span :class="['block w-16 h-1.5 rounded-full bg-neutral-500/15 overflow-hidden']">
            <span :class="['block h-full bg-[var(--series-1)]']" :style="{ width: `${(aucOf(name)! - 0.5) * 200}%` }" />
          </span>
          <span :class="['mono text-xs muted w-8 text-right']">{{ aucOf(name)!.toFixed(2) }}</span>
        </span>
      </button>

      <template v-if="repeats.length > 0">
        <div :class="[heading]">
          Repeats of a metric above
        </div>
        <button v-for="member in repeats" :key="member.name" type="button" :class="[row]" :aria-pressed="false" @click="toggle(member.name)">
          <span :class="['i-mingcute-square-line muted', check]" aria-hidden="true" />
          <span :class="['truncate']" :title="member.name">{{ props.labelOf(member.name) }}</span>
          <span :class="['ml-auto text-xs muted truncate']">≈ {{ props.labelOf(member.of) }} · r {{ member.r.toFixed(2) }}</span>
        </button>
      </template>

      <template v-if="table.constants.length + table.duplicates.length > 0">
        <div :class="[heading]">
          Hidden automatically
        </div>
        <p :class="['px-2 pb-2 m-0 muted leading-relaxed']">
          <span v-for="item in table.constants" :key="item.name" :class="['inline-block mr-2']">{{ props.labelOf(item.name) }} <span class="mono">= {{ item.value }}</span></span>
          <span v-for="item in table.duplicates" :key="item.name" :class="['inline-block mr-2']">{{ props.labelOf(item.name) }} = {{ props.labelOf(item.of) }}</span>
        </p>
      </template>
    </div>
  </div>
</template>
