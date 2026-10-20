<script setup lang="ts">
import type { SkeletonVariant } from './LoadingSkeleton.vue'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import LoadingSkeleton from './LoadingSkeleton.vue'

import { ApiError } from '../api'

/**
 * Shared loading / error / empty frame around a view's content.
 *
 * The default slot renders only when there is no error, the data is loaded, and `empty` is false. While loading, a
 * skeleton in the shape of the content stands in for it (`skeleton`), so the layout does not jump when data arrives.
 */
const props = defineProps<{
  /** Show the empty state instead of the content. */
  empty?: boolean
  emptyHint?: string
  emptyText?: string
  /** Error of the request; an {@link ApiError} also names its HTTP status. */
  error?: Error | null
  loading?: boolean
  /** What is loading, for screen readers (the skeleton itself is hidden from them). */
  loadingText?: string
  /**
   * Shape of the loading placeholder.
   *
   * @default 'rows'
   */
  skeleton?: SkeletonVariant
  /** Number of rows, lines, or cards of the skeleton. */
  skeletonCount?: number
}>()

const emit = defineEmits<{ retry: [] }>()

const { t } = useI18n()

const status = computed(() => (props.error instanceof ApiError ? props.error.status : undefined))
const title = computed(() => {
  if (status.value === 0)
    return t('common.serverUnreachable')
  if (status.value === 404)
    return t('common.notFound')
  return status.value == null ? t('common.requestFailed') : t('common.requestFailedStatus', { status: status.value })
})
</script>

<template>
  <div v-if="props.error" role="alert" data-testid="state-error" :class="['flex flex-col items-center gap-2 py-10 px-4 text-center']">
    <span :class="['i-mingcute-alert-line text-3xl text-red-600 dark:text-red-400']" aria-hidden="true" />
    <div :class="['font-medium']">
      {{ title }}
    </div>
    <div :class="['muted text-sm max-w-xl break-words']">
      {{ props.error.message }}
    </div>
    <button :class="['btn mt-1']" type="button" @click="emit('retry')">
      <span class="i-mingcute-refresh-2-line" aria-hidden="true" /> {{ t('common.retry') }}
    </button>
  </div>
  <div v-else-if="props.loading" role="status" data-testid="state-loading" aria-busy="true">
    <span :class="['sr-only']">{{ props.loadingText ?? t('common.loading') }}</span>
    <LoadingSkeleton :variant="props.skeleton" :count="props.skeletonCount" />
  </div>
  <div v-else-if="props.empty" data-testid="state-empty" :class="['flex flex-col items-center gap-1.5 py-10 px-4 text-center']">
    <span :class="['i-mingcute-inbox-line text-3xl muted']" aria-hidden="true" />
    <div :class="['font-medium']">
      {{ props.emptyText ?? t('common.empty') }}
    </div>
    <div v-if="props.emptyHint" :class="['muted text-sm max-w-xl']">
      {{ props.emptyHint }}
    </div>
  </div>
  <slot v-else />
</template>
