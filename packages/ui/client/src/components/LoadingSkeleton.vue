<script setup lang="ts">
/**
 * Shapes a view takes while its data loads.
 *
 * - `cards`: project cards (home)
 * - `case`: tabs, the rounds timeline, and the input / output cards of a case
 * - `lines`: console or log lines
 * - `matrix`: matrix cells of an eval entry
 * - `media`: one large preview (a file, an image)
 * - `nav`: the sidebar tree
 * - `panel`: a card with a stat row and a chart (scores, metrics)
 * - `rows`: a list card with two-line rows (experiments, attempts, cases)
 * - `run`: the progress panel, the tab strip, and the execution tree of a run
 * - `task`: the summary card and the case list of a task
 */
export type SkeletonVariant = 'cards' | 'case' | 'lines' | 'matrix' | 'media' | 'nav' | 'panel' | 'rows' | 'run' | 'task'

/**
 * Placeholder in the layout of the content it stands for, so the page does not jump when data arrives.
 *
 * Every block uses the `skeleton` shortcut (`uno.config.ts`); widths repeat a fixed sequence instead of random values,
 * so the placeholder looks the same on every render and in screenshots.
 */
const props = withDefaults(defineProps<{
  /** Number of rows, lines, or cards. */
  count?: number
  variant?: SkeletonVariant
}>(), { variant: 'rows' })

/** Fixed sequence of text widths that reads as varied text. */
const widths = ['72%', '54%', '86%', '63%', '78%', '47%', '91%', '58%']
const width = (index: number) => widths[index % widths.length]
const range = (count: number) => Array.from({ length: count }, (_, index) => index)
</script>

<template>
  <div aria-hidden="true" data-testid="skeleton" :data-variant="props.variant">
    <div v-if="props.variant === 'cards'" :class="['grid gap-3']" style="grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr))">
      <div v-for="index in range(props.count ?? 3)" :key="index" :class="['card flex flex-col gap-3 p-4']">
        <div :class="['skeleton h-5']" :style="{ width: width(index) }" />
        <div :class="['skeleton h-3.5 w-40']" />
        <div :class="['flex items-center gap-2']">
          <div :class="['skeleton h-5 w-16']" /><div :class="['skeleton h-3 w-20']" />
        </div>
        <div :class="['skeleton h-2 w-full']" />
        <div :class="['flex items-end justify-between']">
          <div :class="['skeleton h-5 w-28']" /><div :class="['skeleton h-7 w-14']" />
        </div>
      </div>
    </div>

    <div v-else-if="props.variant === 'nav'" :class="['flex flex-col gap-2 px-1.5']">
      <div :class="['skeleton h-3 w-16 mb-1']" />
      <div v-for="index in range(props.count ?? 4)" :key="index" :class="['flex items-center gap-2']" :style="{ paddingLeft: index === 0 ? '0' : '1rem' }">
        <div :class="['skeleton size-4 shrink-0']" /><div :class="['skeleton h-3.5']" :style="{ width: width(index) }" />
      </div>
      <div :class="['skeleton h-3 w-20 mt-3 mb-1']" />
      <div v-for="index in range(props.count ?? 4)" :key="`r${index}`" :class="['flex items-start gap-2']">
        <div :class="['skeleton size-4 shrink-0']" />
        <div :class="['flex flex-col gap-1.5 flex-1']">
          <div :class="['skeleton h-3.5']" :style="{ width: width(index + 2) }" /><div :class="['skeleton h-2.5 w-3/5']" />
        </div>
      </div>
    </div>

    <div v-else-if="props.variant === 'lines'" :class="['flex flex-col gap-2 p-3']">
      <div v-for="index in range(props.count ?? 12)" :key="index" :class="['flex items-center gap-2']">
        <div :class="['skeleton h-3 w-8 shrink-0']" /><div :class="['skeleton h-3']" :style="{ width: width(index) }" />
      </div>
    </div>

    <div v-else-if="props.variant === 'media'" :class="['flex flex-col gap-2']">
      <div :class="['skeleton h-4 w-48']" />
      <div :class="['skeleton w-full aspect-video max-h-[50vh]']" />
    </div>

    <div v-else-if="props.variant === 'matrix'" :class="['card p-3 flex flex-col gap-3']">
      <div :class="['skeleton h-4 w-32']" />
      <div :class="['flex gap-2 overflow-hidden']">
        <div v-for="index in range(props.count ?? 3)" :key="index" :class="['skeleton shrink-0 w-44 md:w-56 h-28 rounded-xl']" />
      </div>
    </div>

    <div v-else-if="props.variant === 'panel'" :class="['card']">
      <div :class="['card-title']">
        <div :class="['skeleton h-4 w-28']" />
      </div>
      <div :class="['flex flex-wrap gap-x-8 gap-y-3 p-3']">
        <div v-for="index in range(3)" :key="index" :class="['flex flex-col gap-1.5']">
          <div :class="['skeleton h-3 w-16']" /><div :class="['skeleton h-6 w-14']" />
        </div>
      </div>
      <div :class="['skeleton h-36 mx-3 mb-3']" />
    </div>

    <div v-else-if="props.variant === 'run' || props.variant === 'task' || props.variant === 'case'" :class="['flex flex-col gap-4']">
      <div v-if="props.variant !== 'case'" :class="['card p-3 flex flex-col gap-3']">
        <div :class="['flex items-center gap-2']">
          <div :class="['skeleton h-5 w-16']" /><div :class="['skeleton h-5 w-24']" /><div :class="['skeleton h-3 w-20']" />
        </div>
        <template v-if="props.variant === 'run'">
          <div :class="['skeleton h-2.5 w-full rounded-full']" />
          <div :class="['skeleton h-32 w-full']" />
        </template>
        <div :class="['grid gap-x-6 gap-y-3']" style="grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))">
          <div v-for="index in range(6)" :key="index" :class="['flex flex-col gap-1.5']">
            <div :class="['skeleton h-3 w-20']" /><div :class="['skeleton h-6']" :style="{ width: width(index) }" />
          </div>
        </div>
      </div>
      <div v-if="props.variant !== 'task'" :class="['flex gap-4 border-b border-neutral-200/50 dark:border-neutral-800/50 pb-2.5 overflow-hidden']">
        <div v-for="index in range(4)" :key="index" :class="['skeleton h-4 shrink-0']" :style="{ width: `${4 + (index % 3) * 1.5}rem` }" />
      </div>
      <div v-if="props.variant === 'case'" :class="['card p-3 flex flex-col gap-2']">
        <div :class="['skeleton h-4 w-48']" />
        <div :class="['skeleton h-7 w-full']" />
      </div>
      <div v-if="props.variant === 'case'" :class="['grid gap-4']" style="grid-template-columns: repeat(auto-fit, minmax(min(380px, 100%), 1fr))">
        <div v-for="index in range(2)" :key="index" :class="['card p-3 flex flex-col gap-2']">
          <div :class="['skeleton h-4 w-20 mb-1']" />
          <div v-for="line in range(5)" :key="line" :class="['skeleton h-3']" :style="{ width: width(line + index * 3), marginLeft: `${(line % 3) * 0.75}rem` }" />
        </div>
      </div>
      <div v-else :class="['card']">
        <div :class="['card-title']">
          <div :class="['skeleton h-4 w-32']" />
        </div>
        <div v-for="index in range(props.count ?? 8)" :key="index" :class="['flex items-center gap-2 px-3 py-2 border-b last:border-b-0 border-neutral-100/70 dark:border-neutral-900']">
          <div :class="['skeleton size-4 shrink-0']" /><div :class="['skeleton h-3.5']" :style="{ width: width(index) }" /><div :class="['skeleton h-3 w-14 ml-auto shrink-0']" />
        </div>
      </div>
    </div>

    <div v-else :class="['card']">
      <div v-for="index in range(props.count ?? 5)" :key="index" :class="['flex flex-col gap-2 px-3 py-3 border-b last:border-b-0 border-neutral-100/70 dark:border-neutral-900']">
        <div :class="['flex items-center gap-2']">
          <div :class="['skeleton size-4 shrink-0']" /><div :class="['skeleton h-4']" :style="{ width: width(index) }" /><div :class="['skeleton h-5 w-10 ml-auto shrink-0']" />
        </div>
        <div :class="['skeleton h-2 w-full max-w-md']" />
      </div>
    </div>
  </div>
</template>
