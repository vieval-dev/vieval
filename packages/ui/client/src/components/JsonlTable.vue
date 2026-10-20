<script setup lang="ts">
import type { JsonlPage } from '../../../src/shared/contract'

import { useVirtualizer } from '@tanstack/vue-virtual'
import { computed, reactive, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ObjectTree from './ObjectTree.vue'
import StateView from './StateView.vue'

import { ApiError } from '../api'
import { previewValue } from '../format'
import { currentLocale } from '../i18n'

/**
 * JSONL file as a virtualized table: only visible rows are in the DOM, and pages of rows are fetched from the
 * server's line index on demand, so files with hundreds of thousands of lines scroll smoothly.
 *
 * Columns are the most frequent top-level keys of the first page; the selected row opens as an object tree.
 */
const props = defineProps<{ load: (offset: number, limit: number) => Promise<JsonlPage> }>()
const { t } = useI18n()

const pageSize = 200
const pages = reactive(new Map<number, unknown[]>())
const pending = new Set<number>()
const totalLines = shallowRef(0)
const partialTail = shallowRef(false)
const error = shallowRef<ApiError>()
const loading = shallowRef(true)
const selected = shallowRef<number>()

async function fetchPage(page: number): Promise<void> {
  if (pages.has(page) || pending.has(page))
    return
  pending.add(page)
  try {
    const result = await props.load(page * pageSize, pageSize)
    pages.set(page, result.rows)
    totalLines.value = result.totalLines
    partialTail.value = result.partialTail
    error.value = undefined
  }
  catch (caught) {
    error.value = caught instanceof ApiError ? caught : new ApiError(0, String(caught))
  }
  finally {
    pending.delete(page)
    loading.value = false
  }
}

watch(() => props.load, () => {
  pages.clear()
  selected.value = undefined
  loading.value = true
  void fetchPage(0)
}, { immediate: true })

const rowAt = (index: number) => pages.get(Math.floor(index / pageSize))?.[index % pageSize]

const isRecord = (value: unknown): value is Record<string, unknown> => value != null && typeof value === 'object' && !Array.isArray(value)

/**
 * Column paths of the first page: top-level keys, and one level of nested object keys (`record.type`), ordered by
 * how many rows have them. Envelopes such as AUV `{ version, record: {...} }` then show their useful fields.
 */
const columns = computed(() => {
  const counts = new Map<string, number>()
  const add = (path: string) => counts.set(path, (counts.get(path) ?? 0) + 1)
  for (const row of pages.get(0) ?? []) {
    if (!isRecord(row))
      continue
    for (const [key, value] of Object.entries(row)) {
      if (isRecord(value) && Object.keys(value).length > 0) {
        for (const nested of Object.keys(value))
          add(`${key}.${nested}`)
      }
      else {
        add(key)
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([key]) => key)
})

const scroller = useTemplateRef<HTMLElement>('scroller')
const virtualizer = useVirtualizer(computed(() => ({
  count: totalLines.value,
  estimateSize: () => 26,
  getScrollElement: () => scroller.value ?? null,
  overscan: 20,
})))

// Fetch the pages under the rendered window.
watch(() => virtualizer.value.getVirtualItems().map(item => Math.floor(item.index / pageSize)), (needed) => {
  for (const page of new Set(needed))
    void fetchPage(page)
})

const range = computed(() => {
  const items = virtualizer.value.getVirtualItems()
  return items.length === 0 ? { end: 0, start: 0 } : { end: items.at(-1)!.index + 1, start: items[0]!.index + 1 }
})
function cell(row: unknown, column: string): string {
  if (!isRecord(row))
    return column === (columns.value[0] ?? 'value') ? previewValue(row, 80) : ''
  const [key = column, nested] = column.split('.', 2)
  const outer = row[key] ?? row[column]
  const value = nested != null && isRecord(outer) && !(column in row) ? outer[nested] : outer
  return value === undefined ? '' : previewValue(value, 80)
}
</script>

<template>
  <StateView :error="error" :loading="loading" :empty="totalLines === 0" :empty-text="t('cases.jsonl.empty')" skeleton="lines" @retry="() => fetchPage(0)">
    <div :class="['flex flex-col gap-2']" data-testid="jsonl-table" :data-total-lines="totalLines" :data-rendered-start="range.start" :data-rendered-end="range.end" :data-dom-rows="virtualizer.getVirtualItems().length">
      <div :class="['flex items-center gap-2 text-xs muted']">
        <span class="i-mingcute-table-2-line" aria-hidden="true" />
        <span data-testid="jsonl-range">{{ t('cases.jsonl.range', { end: range.end.toLocaleString(currentLocale()), rendered: virtualizer.getVirtualItems().length, start: range.start.toLocaleString(currentLocale()), total: totalLines.toLocaleString(currentLocale()) }) }}</span>
        <span v-if="partialTail" class="badge state-running">{{ t('cases.jsonl.growing') }}</span>
      </div>
      <div ref="scroller" :class="['overflow-auto h-[45vh] min-h-48 rounded border border-neutral-200/50 dark:border-neutral-800/50']">
        <div :class="['sticky top-0 z-1 flex bg-neutral-100 dark:bg-neutral-800 text-xs font-medium min-w-max']">
          <div class="muted px-2 py-1 text-right shrink-0 w-16">
            #
          </div>
          <div v-for="column in columns.length > 0 ? columns : ['value']" :key="column" :class="['w-56 shrink-0 px-2 py-1 truncate mono text-xs']">
            {{ column }}
          </div>
        </div>
        <div :style="{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }" :class="['min-w-max']">
          <div
            v-for="item in virtualizer.getVirtualItems()" :key="item.index"
            :class="['absolute left-0 flex text-xs mono cursor-pointer border-b border-neutral-100/70 dark:border-neutral-900', selected === item.index ? 'selected' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50']"
            :style="{ height: `${item.size}px`, transform: `translateY(${item.start}px)` }"
            @click="selected = item.index"
          >
            <div class="muted px-2 py-1 text-right shrink-0 w-16">
              {{ item.index + 1 }}
            </div>
            <template v-if="rowAt(item.index) !== undefined">
              <div v-for="column in columns.length > 0 ? columns : ['value']" :key="column" :class="['w-56 shrink-0 px-2 py-1 truncate']">
                {{ cell(rowAt(item.index), column) }}
              </div>
            </template>
            <div v-else class="muted px-2 py-1">
              {{ t('cases.jsonl.loading') }}
            </div>
          </div>
        </div>
      </div>
      <div v-if="selected != null && rowAt(selected) !== undefined" :class="['rounded border border-neutral-200/50 dark:border-neutral-800/50 p-2 max-h-72 overflow-auto']">
        <div class="text-xs muted mb-1">
          {{ t('cases.jsonl.row', { n: selected + 1 }) }}
        </div>
        <ObjectTree :value="rowAt(selected)" :expand-depth="2" />
      </div>
    </div>
  </StateView>
</template>
