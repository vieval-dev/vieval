<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import InfoButton from './InfoButton.vue'

/**
 * "Run details" of a run page header, behind an info button next to the title: the raw identifiers (run id, report
 * path, report root) that the header no longer prints, each with an explicit "Copy" action.
 */
const props = defineProps<{
  reportPath?: null | string
  reportRoot?: null | string
  runId: string
}>()

const { t } = useI18n()
const rows = computed(() => [
  { key: 'runId', label: t('runs.details.runId'), value: props.runId },
  { key: 'reportPath', label: t('runs.details.reportPath'), value: props.reportPath },
  { key: 'reportRoot', label: t('runs.details.reportRoot'), value: props.reportRoot },
].filter((row): row is { key: string, label: string, value: string } => row.value != null && row.value !== ''))

const { copied, copy } = useClipboard({ copiedDuring: 1500, legacy: true })
/** Key of the row copied last, so only that row says "Copied". */
const copiedKey = shallowRef<string>()
function copyRow(row: { key: string, value: string }): void {
  copiedKey.value = row.key
  void copy(row.value)
}
</script>

<template>
  <InfoButton :label="t('runs.details.title')">
    <dl :class="['grid gap-x-3 gap-y-1.5 text-xs', 'grid-cols-[max-content_1fr_max-content] items-baseline']" data-testid="run-details">
      <template v-for="row in rows" :key="row.key">
        <dt :class="['muted']">
          {{ row.label }}
        </dt>
        <dd :class="['mono break-all text-neutral-700 dark:text-neutral-300']">
          {{ row.value }}
        </dd>
        <dd>
          <button type="button" :class="['btn', 'px-1.5! py-0.5! text-xs']" @click="copyRow(row)">
            {{ copied && copiedKey === row.key ? t('runs.id.copied') : t('runs.id.copy') }}
          </button>
        </dd>
      </template>
    </dl>
  </InfoButton>
</template>
