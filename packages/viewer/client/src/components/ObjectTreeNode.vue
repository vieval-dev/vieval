<script setup lang="ts">
import { computed, shallowRef } from 'vue'

/** One node of {@link ObjectTree}; containers render their children lazily once opened. */
const props = defineProps<{ depth: number, expandDepth: number, name?: string, value: unknown }>()

/** Children rendered at once; more appear with "show more" so huge arrays stay responsive. */
const pageSize = 200

const isContainer = computed(() => props.value != null && typeof props.value === 'object' && !(props.value instanceof Date))
const entries = computed(() => (isContainer.value ? Object.entries(props.value as Record<string, unknown>) : []))
const open = shallowRef(props.depth < props.expandDepth)
const shown = shallowRef(pageSize)
const summary = computed(() => (Array.isArray(props.value) ? `Array(${entries.value.length})` : `{${entries.value.length} keys}`))
const scalar = computed(() => {
  const value = props.value
  if (value instanceof Date)
    return { class: 'text-violet-700 dark:text-violet-300', text: value.toISOString() }
  if (typeof value === 'string')
    return { class: 'text-green-700 dark:text-green-400', text: JSON.stringify(value) }
  if (typeof value === 'number' || typeof value === 'bigint')
    return { class: 'text-blue-700 dark:text-blue-400', text: String(value) }
  if (typeof value === 'boolean')
    return { class: 'text-amber-700 dark:text-amber-400', text: String(value) }
  return { class: 'muted', text: value === null ? 'null' : 'undefined' }
})
</script>

<template>
  <div role="treeitem" :aria-expanded="isContainer ? open : undefined">
    <div :class="['flex items-start gap-1 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 rounded-sm']">
      <button v-if="isContainer && entries.length > 0" type="button" :class="['i-mingcute-right-line shrink-0 mt-[3px] muted transition-transform', open && 'rotate-90']" :aria-label="open ? 'Collapse' : 'Expand'" @click="open = !open" />
      <span v-else class="shrink-0 w-[1.1em]" />
      <span v-if="props.name != null" :class="['text-rose-700 dark:text-rose-300 shrink-0']">{{ props.name }}:</span>
      <span v-if="isContainer" :class="['muted cursor-pointer']" @click="open = !open">{{ summary }}</span>
      <span v-else :class="[scalar.class, 'break-all whitespace-pre-wrap']">{{ scalar.text }}</span>
    </div>
    <div v-if="isContainer && open" :class="['pl-4 border-l border-neutral-200/50 dark:border-neutral-800/50 ml-[0.45em]']">
      <ObjectTreeNode v-for="[key, child] in entries.slice(0, shown)" :key="key" :name="key" :value="child" :depth="props.depth + 1" :expand-depth="props.expandDepth" />
      <button v-if="entries.length > shown" type="button" :class="['link text-xs ml-4']" @click="shown += pageSize">
        show {{ Math.min(pageSize, entries.length - shown) }} more of {{ entries.length - shown }}
      </button>
    </div>
  </div>
</template>
