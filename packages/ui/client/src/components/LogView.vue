<script setup lang="ts">
import type { LogLine, LogsResponse } from '../../../src/shared/contract'
import type { Segment } from './SegmentedControl.vue'

import Anser from 'anser'

import { useVirtualizer } from '@tanstack/vue-virtual'
import { useIntervalFn } from '@vueuse/core'
import { computed, shallowRef, useTemplateRef, watch } from 'vue'

import SegmentedControl from './SegmentedControl.vue'
import StateView from './StateView.vue'

import { ApiError } from '../api'
import { formatTime, shortTaskId } from '../format'

/**
 * Console output (`console.log` & co. captured per case) as a virtualized list, loaded page by page.
 *
 * Use when:
 * - showing the logs of a run or of one case; pages of 1000 lines load as the list scrolls to its end
 *
 * Expects:
 * - `load(offset, limit)` returns the `/logs` response; `follow` re-reads the tail every 2 s while the run is live
 */
const props = defineProps<{
  caseHref?: (line: LogLine) => string
  emptyText?: string
  /** Poll for new lines (live runs). */
  follow?: boolean
  load: (offset: number, limit: number) => Promise<LogsResponse>
  /** Show task/case columns (run-wide logs). */
  showCase?: boolean
}>()

const pageSize = 1000
const lines = shallowRef<LogLine[]>([])
const total = shallowRef(0)
const loading = shallowRef(true)
const error = shallowRef<ApiError>()
type Stream = 'all' | 'stderr' | 'stdout'
const stream = shallowRef<Stream>('all')
const streams: Segment<Stream>[] = [{ label: 'all', value: 'all' }, { label: 'stdout', value: 'stdout' }, { label: 'stderr', value: 'stderr' }]
let busy = false

async function loadMore(): Promise<void> {
  if (busy)
    return
  busy = true
  try {
    const page = await props.load(lines.value.length, pageSize)
    lines.value = [...lines.value, ...page.lines]
    total.value = page.total
    error.value = undefined
  }
  catch (caught) {
    error.value = caught instanceof ApiError ? caught : new ApiError(0, String(caught))
  }
  finally {
    busy = false
    loading.value = false
  }
}

async function reset(): Promise<void> {
  lines.value = []
  loading.value = true
  await loadMore()
}
watch(() => props.load, () => void reset(), { immediate: true })

// Following re-reads the tail every 2 s, only once every loaded page reached the end.
const following = useIntervalFn(() => {
  if (lines.value.length >= total.value)
    void loadMore()
}, 2000, { immediate: false })
watch(() => props.follow, follow => (follow ? following.resume() : following.pause()), { immediate: true })

const visible = computed(() => (stream.value === 'all' ? lines.value : lines.value.filter(line => line.stream === stream.value)))
const scroller = useTemplateRef<HTMLElement>('scroller')
const virtualizer = useVirtualizer(computed(() => ({
  count: visible.value.length,
  estimateSize: () => 20,
  getScrollElement: () => scroller.value ?? null,
  overscan: 30,
})))

// Load the next page once the last rendered row is near the end of what is loaded.
watch(() => virtualizer.value.getVirtualItems().at(-1)?.index, (index) => {
  if (index != null && index >= lines.value.length - 50 && lines.value.length < total.value)
    void loadMore()
})

/** ANSI escape sequences (colors of CLI tools) rendered as spans. */
function render(text: string) {
  return Anser.ansiToJson(text, { remove_empty: true, use_classes: false })
}

const range = computed(() => {
  const items = virtualizer.value.getVirtualItems()
  return items.length === 0 ? '' : `${items[0]!.index + 1}–${items.at(-1)!.index + 1}`
})
</script>

<template>
  <div :class="['flex flex-col']" data-testid="log-view">
    <div :class="['flex items-center flex-wrap gap-2 px-3 py-1.5 text-xs border-b border-neutral-200/50 dark:border-neutral-800/50']">
      <SegmentedControl v-model="stream" :items="streams" label="Output stream" />
      <span :class="['muted ml-auto']" data-testid="log-count">showing {{ range }} of {{ visible.length }} loaded · {{ total }} lines total</span>
      <span v-if="props.follow" :class="['badge state-running']"><span class="vv-pulse i-mingcute-airdrop-line" aria-hidden="true" />following</span>
    </div>
    <StateView :error="error" :loading="loading" :empty="total === 0" :empty-text="props.emptyText ?? 'No console output recorded'" empty-hint="vieval records console.log / console.error output written inside cases." skeleton="lines" @retry="reset">
      <div ref="scroller" :class="['overflow-auto h-[55vh] max-md:h-[65vh] min-h-48 bg-neutral-50 dark:bg-neutral-950 font-mono text-xs']">
        <div :style="{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', minWidth: '100%' }">
          <div
            v-for="item in virtualizer.getVirtualItems()" :key="item.index"
            :class="['absolute left-0 right-0 flex gap-2 px-2 whitespace-pre leading-5', visible[item.index]!.stream === 'stderr' && 'bg-red-50 dark:bg-red-950/30']"
            :style="{ transform: `translateY(${item.start}px)`, height: `${item.size}px` }"
          >
            <span :class="['muted select-none w-10 text-right shrink-0']">{{ item.index + 1 }}</span>
            <span :class="['muted select-none shrink-0 max-md:hidden']">{{ formatTime(visible[item.index]!.time) }}</span>
            <span :class="['select-none shrink-0 w-12', visible[item.index]!.stream === 'stderr' ? 'text-red-600 dark:text-red-400' : 'muted']">{{ visible[item.index]!.stream }}</span>
            <a v-if="props.showCase && visible[item.index]!.caseId && props.caseHref" :href="props.caseHref(visible[item.index]!)" :class="['link shrink-0 max-w-56 truncate']" :title="`${shortTaskId(visible[item.index]!.taskId ?? '')} › ${visible[item.index]!.caseId}`">{{ visible[item.index]!.caseId }}</a>
            <span><span v-for="(part, index) in render(visible[item.index]!.text)" :key="index" :style="{ color: part.fg ? `rgb(${part.fg})` : undefined, background: part.bg ? `rgb(${part.bg})` : undefined, fontWeight: part.decorations?.includes('bold') ? 600 : undefined }">{{ part.content }}</span></span>
          </div>
        </div>
      </div>
    </StateView>
  </div>
</template>
