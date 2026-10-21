<script setup lang="ts">
import type { HierarchyLevel } from '../hierarchy'

import { useClipboard, useTimeoutFn } from '@vueuse/core'
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger } from 'reka-ui'
import { shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import AnimatedContent from './AnimatedContent.vue'
import IconButton from './IconButton.vue'

import { levelLabel } from '../hierarchy'

/**
 * Overflow menu ("⋯") of a page header or a list row with explicit actions on an id, such as "Copy ID".
 *
 * Copying is an action with a text label and a "Copied" confirmation, instead of an unlabeled copy icon next to every
 * name. The id itself is shown in the menu, so it can also be read. The default slot adds the page's secondary actions
 * below it (`DropdownMenuItem`s, such as "Compare attempts" on a run page).
 */
const props = defineProps<{
  /** Full id to copy. */
  id: string
  /** Level the id belongs to, named in the menu label and the accessible name ("run", "experiment", …). */
  kind: HierarchyLevel
}>()

const { t } = useI18n()
const open = shallowRef(false)
const { copied, copy } = useClipboard({ copiedDuring: 1500, legacy: true })
// The confirmation stays visible briefly, then the menu closes by itself.
const { start: closeSoon } = useTimeoutFn(() => (open.value = false), 900, { immediate: false })

async function copyId(event: Event): Promise<void> {
  // Keep the menu open so "Copied" can be read.
  event.preventDefault()
  await copy(props.id)
  closeSoon()
}
</script>

<template>
  <DropdownMenuRoot v-model:open="open">
    <DropdownMenuTrigger as-child>
      <IconButton icon="i-mingcute-more-1-line" :label="t('runs.id.moreActions', { kind: levelLabel(props.kind).toLowerCase() })" :class="['relative z-1']" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent as-child :side-offset="4" align="end" :class="['floating min-w-56 max-w-96 p-1 text-sm']">
        <AnimatedContent>
          <DropdownMenuLabel :class="['px-2 py-1 text-xs muted break-all']">
            {{ levelLabel(props.kind).toLowerCase() }} <span class="font-mono">{{ props.id }}</span>
          </DropdownMenuLabel>
          <DropdownMenuItem :class="['menu-item']" data-testid="copy-id" @select="copyId">
            <span :class="copied ? 'i-mingcute-check-line text-green-600 dark:text-green-400' : 'i-mingcute-copy-2-line'" aria-hidden="true" />
            {{ copied ? t('runs.id.copied') : t('runs.id.copyId') }}
          </DropdownMenuItem>
          <template v-if="$slots.default">
            <DropdownMenuSeparator :class="['my-1 h-px bg-neutral-200 dark:bg-neutral-800']" />
            <slot />
          </template>
        </AnimatedContent>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
