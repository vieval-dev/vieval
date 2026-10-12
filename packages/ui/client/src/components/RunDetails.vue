<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'
import { computed, shallowRef } from 'vue'

/**
 * Collapsed "Details" of a run page header: the raw identifiers (run id, report path, report root) that the header
 * no longer prints, each with an explicit "Copy" action.
 */
const props = defineProps<{
  reportPath?: null | string
  reportRoot?: null | string
  runId: string
}>()

const rows = computed(() => [
  { label: 'Run ID', value: props.runId },
  { label: 'Report path', value: props.reportPath },
  { label: 'Report root', value: props.reportRoot },
].filter((row): row is { label: string, value: string } => row.value != null && row.value !== ''))

const { copied, copy } = useClipboard({ copiedDuring: 1500, legacy: true })
/** Label of the row copied last, so only that row says "Copied". */
const copiedLabel = shallowRef<string>()
function copyRow(row: { label: string, value: string }): void {
  copiedLabel.value = row.label
  void copy(row.value)
}
</script>

<template>
  <CollapsibleRoot v-slot="{ open }" :class="['mt-1']">
    <CollapsibleTrigger :class="['btn', 'px-1.5! py-0.5! text-xs muted']">
      <span :class="[open ? 'i-mingcute-down-small-line' : 'i-mingcute-right-small-line']" aria-hidden="true" />Details
    </CollapsibleTrigger>
    <CollapsibleContent>
      <dl :class="['mt-1 grid gap-x-3 gap-y-1 text-xs', 'grid-cols-[max-content_1fr_max-content] items-baseline']" data-testid="run-details">
        <template v-for="row in rows" :key="row.label">
          <dt :class="['muted']">
            {{ row.label }}
          </dt>
          <dd :class="['mono break-all text-neutral-700 dark:text-neutral-300']">
            {{ row.value }}
          </dd>
          <dd>
            <button type="button" :class="['btn', 'px-1.5! py-0.5! text-xs']" @click="copyRow(row)">
              {{ copied && copiedLabel === row.label ? 'Copied' : 'Copy' }}
            </button>
          </dd>
        </template>
      </dl>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>
