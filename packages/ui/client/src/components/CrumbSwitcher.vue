<script setup lang="ts">
import type { HierarchyLevel } from '../hierarchy'
import type { SwitcherOption } from '../switcher'

import { ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxItemIndicator, ComboboxRoot, ComboboxViewport, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, shallowRef } from 'vue'

import AnimatedContent from './AnimatedContent.vue'
import CountsBar from './CountsBar.vue'
import StateBadge from './StateBadge.vue'
import TimeAgo from './TimeAgo.vue'

import { formatScore } from '../format'
import { levelLabels } from '../hierarchy'
import { filterOptions } from '../switcher'

/**
 * Last breadcrumb segment (the page shown) as a switcher, like GitHub's "Switch repository": its label and a caret
 * open a popover with a search field and the siblings as small cards (state, score, time, …), the current one
 * checked. Ancestor segments stay plain links.
 *
 * Keyboard: the search field has focus; ↑/↓ move, Enter opens, Esc closes (reka-ui Combobox inside a Popover).
 */
const props = defineProps<{
  /** Id of the current item; it is checked and is the tooltip of the trigger. */
  current: string
  /** Readable label of the current item, shown in the breadcrumb. */
  label: string
  level: HierarchyLevel
  options: SwitcherOption[]
}>()
const emit = defineEmits<{ select: [option: SwitcherOption] }>()

const open = shallowRef(false)
const query = shallowRef('')
const visible = computed(() => filterOptions(props.options, query.value))

function choose(id: unknown): void {
  const option = props.options.find(item => item.id === id)
  if (option == null)
    return
  open.value = false
  query.value = ''
  emit('select', option)
  location.hash = option.href
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger
      :class="[
        'inline-flex items-center gap-0.5 min-w-0 max-w-56 md:max-w-96 rounded-md px-1 -mx-1 font-medium transition-colors',
        'hover:bg-primary-500/10 data-[state=open]:bg-primary-500/15 focus-visible:(outline-2 outline-offset-1 outline-primary-500)',
      ]"
      :title="props.current"
      :aria-label="`${props.label} — switch ${levelLabels[props.level].toLowerCase()}`"
      :data-testid="`switch-${props.level}`"
    >
      <span :class="['truncate']">{{ props.label }}</span>
      <span class="i-mingcute-down-small-line muted shrink-0" aria-hidden="true" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent as-child :side-offset="6" :collision-padding="12" align="start" :class="['floating w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden']">
        <AnimatedContent>
          <div :class="['px-3 py-2 text-sm font-semibold border-b border-neutral-200/50 dark:border-neutral-700/40']">
            Switch {{ levelLabels[props.level].toLowerCase() }}
          </div>
          <ComboboxRoot :model-value="props.current" :open="true" ignore-filter :reset-search-term-on-blur="false" @update:model-value="choose">
            <div :class="['p-2 border-b border-neutral-200/50 dark:border-neutral-700/40']">
              <!-- `display-value`: the field is for searching; by default it would show the current id, which then
                   became the search term and hid every sibling whose id does not contain it. -->
              <ComboboxInput
                v-model="query"
                :display-value="() => ''"
                auto-focus
                :placeholder="`Find ${/^[aeiou]/i.test(levelLabels[props.level]) ? 'an' : 'a'} ${levelLabels[props.level].toLowerCase()}…`"
                :class="['w-full rounded-md px-2 py-1.5 text-sm outline-none', 'bg-neutral-500/8 focus:(ring-2 ring-primary-500/40)']"
                data-testid="switch-search"
              />
            </div>
            <ComboboxContent position="inline" :class="['max-h-96 overflow-y-auto p-1']">
              <ComboboxViewport>
                <ComboboxEmpty :class="['px-2 py-3 text-sm muted text-center']">
                  Nothing matches “{{ query }}”
                </ComboboxEmpty>
                <ComboboxItem
                  v-for="option in visible"
                  :key="option.id"
                  :value="option.id"
                  :text-value="option.label"
                  :class="['relative flex flex-col gap-1 rounded-md px-2 py-1.5 pl-7 text-sm cursor-pointer outline-none', 'data-[highlighted]:bg-primary-500/10']"
                  :title="option.id"
                  data-testid="switch-option"
                >
                  <ComboboxItemIndicator :class="['absolute left-2 top-2 text-primary-600 dark:text-primary-300']">
                    <span class="i-mingcute-check-line" aria-hidden="true" />
                  </ComboboxItemIndicator>
                  <span :class="['flex items-center gap-2 min-w-0']">
                    <StateBadge v-if="option.state" :state="option.state" icon-only />
                    <span :class="['font-medium truncate']">{{ option.label }}</span>
                    <span v-if="option.score !== undefined" :class="['ml-auto shrink-0 tabular-nums text-xs font-semibold']" :title="option.scoreLabel">{{ formatScore(option.score) }}</span>
                  </span>
                  <span v-if="option.chips?.length" :class="['flex flex-wrap gap-1']">
                    <span v-for="chip in option.chips" :key="chip.axis" :class="['badge state-neutral font-normal']"><span class="muted">{{ chip.axis }}</span>{{ chip.values }}</span>
                  </span>
                  <span :class="['flex items-center gap-2 text-xs muted min-w-0']">
                    <span v-if="option.detail" class="truncate">{{ option.detail }}</span>
                    <TimeAgo v-if="option.time" :time="option.time" relative-only :class="['ml-auto shrink-0']" />
                  </span>
                  <CountsBar v-if="option.counts" :counts="option.counts" labels="none" />
                </ComboboxItem>
              </ComboboxViewport>
            </ComboboxContent>
          </ComboboxRoot>
        </AnimatedContent>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
