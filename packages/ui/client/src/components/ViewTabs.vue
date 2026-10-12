<script setup lang="ts" generic="T extends string">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'

/**
 * One tab of {@link ViewTabs}.
 *
 * @param T value type of the tab
 */
export interface ViewTab<T extends string> {
  /** Number shown as a badge after the label (artifacts, log lines, …). */
  count?: number
  icon?: string
  label: string
  value: T
}

/**
 * Tab strip with keyboard support (reka-ui Tabs) and the panel of the selected tab (default slot).
 *
 * With `href`, triggers are links, so a tab is addressable and opens in a new browser tab; the page still gets
 * `update:modelValue` and decides how to navigate.
 */
const props = defineProps<{
  /** Address of a tab; makes the triggers links. */
  href?: (value: T) => string
  /** Inside a card: the strip spans the card edge to edge and the panel brings its own padding. */
  inCard?: boolean
  items: readonly ViewTab<T>[]
  label: string
}>()
const model = defineModel<T>({ required: true })

function select(value: unknown): void {
  if (typeof value === 'string')
    model.value = value as T
}
</script>

<template>
  <TabsRoot :model-value="model" @update:model-value="select">
    <TabsList :aria-label="props.label" :class="['flex items-center overflow-x-auto border-b border-neutral-200/50 dark:border-neutral-800/50', props.inCard ? 'px-1' : 'mb-3']">
      <TabsTrigger v-for="item in props.items" :key="item.value" :value="item.value" :as-child="props.href != null" :class="['tab']">
        <a v-if="props.href" :href="props.href(item.value)">
          <span v-if="item.icon" :class="item.icon" aria-hidden="true" />{{ item.label }}<span v-if="item.count != null" :class="['badge state-neutral']">{{ item.count }}</span>
        </a>
        <template v-else>
          <span v-if="item.icon" :class="item.icon" aria-hidden="true" />{{ item.label }}<span v-if="item.count != null" :class="['badge state-neutral']">{{ item.count }}</span>
        </template>
      </TabsTrigger>
      <!-- Notes or actions at the end of the strip. -->
      <slot name="extra" />
    </TabsList>
    <TabsContent :value="model" :class="['outline-none']">
      <slot />
    </TabsContent>
  </TabsRoot>
</template>
