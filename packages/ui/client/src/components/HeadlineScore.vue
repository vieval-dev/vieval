<script setup lang="ts">
import type { HeadlineResult, ScoreDefinition } from '../../../src/shared/contract'
import type { ColumnDefinition } from '../scores'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import MetricInfo from './MetricInfo.vue'

import { formatScore } from '../format'
import { completionParts, headlineView, scoreColumn, unscoredText } from '../scores'

/**
 * The headline of a run, a task, or a matrix cell, read the same everywhere: the value with the localized label of
 * the primary score, and the completion rate next to it (`87.5% Pass · completed 96.8%`), since a score over the
 * cases that produced a result says little without how many did. Hovering the value shows the score's description,
 * formula, grader, and counted cases in the metric hover card.
 *
 * Without a primary score the headline is the share of passed cases (`Passed cases`). When the tasks of a run name
 * different primary scores (`per-task`), the completion rate is the headline and each task's primary score is listed
 * under it with the task's name.
 *
 * Use when:
 * - a page, card, row, or switcher shows how a run, task, or matrix cell scored
 */
const props = defineProps<{
  /**
   * `end` right-aligns the lines, for a score column of a list.
   * @default 'start'
   */
  align?: 'end' | 'start'
  /** `score.defined` of the headline's scores (`headlineDefinitions`, `scoreDefinitions`). */
  definitions: readonly ScoreDefinition[]
  /**
   * Called when the completion rate below 100 % is clicked; the page shows the cases without a result. Without it, the
   * rate is plain text (inside a card that is a link itself, for example).
   */
  onErrors?: () => void
  result: HeadlineResult | null | undefined
  /**
   * `lg`: the number of a score card; `md`: a page header; `sm`: a list row, where the completion rate is shown only
   * below 100 % (the row's case bar says the rest).
   * @default 'md'
   */
  size?: 'lg' | 'md' | 'sm'
  /** Readable name of a task, for the tasks of a `per-task` headline. */
  taskLabel?: (taskId: string) => string
}>()

const { t } = useI18n()
const view = computed(() => (props.result == null ? undefined : headlineView(props.result, props.definitions)))
const completion = computed(() => (view.value == null ? { rate: '' } : completionParts(view.value.completion)))
/** What the hover card describes: the primary score, or the built-in passed share or completion rate. */
const column = computed<ColumnDefinition | undefined>(() => {
  if (view.value == null)
    return undefined
  if (view.value.definition != null)
    return scoreColumn(view.value.definition, props.definitions)
  return view.value.kind === 'passed-cases'
    ? { better: 'higher', description: t('scores.headline.passedDescription'), label: view.value.label, name: 'passed' }
    : { better: 'higher', description: t('scores.headline.perTaskDescription'), label: t('scores.completion.label'), name: 'completion' }
})
const unscoredCount = computed(() => Object.values(view.value?.summary.unscored ?? {}).reduce((sum, count) => sum + count, 0))
const incomplete = computed(() => view.value != null && view.value.completion.mean != null && view.value.completion.mean < 1)
const showCompletion = computed(() => view.value != null && view.value.kind !== 'per-task' && (props.size !== 'sm' || incomplete.value))
const valueClass = computed(() => ({ lg: 'text-2xl', md: 'text-xl', sm: 'text-sm' })[props.size ?? 'md'])
</script>

<template>
  <span v-if="view" :class="['inline-flex flex-col gap-1 min-w-0', props.align === 'end' && 'items-end text-right']" data-testid="headline">
    <span :class="['flex items-baseline flex-wrap gap-x-1.5 min-w-0', props.align === 'end' && 'justify-end']">
      <MetricInfo :name="column?.name ?? view.summary.name" :definition="column" :values="[]" :summary="view.summary" :completion="view.completion">
        <span :class="['inline-flex items-baseline gap-1.5 min-w-0 cursor-help']">
          <span :class="[valueClass, 'font-semibold tabular-nums leading-none']" data-testid="headline-value">{{ formatScore(view.summary.mean) }}</span>
          <span :class="['text-xs muted truncate']" data-testid="headline-label">{{ view.label }}</span>
        </span>
      </MetricInfo>
      <!-- Facts about the value itself (a change from the previous run), from the caller. -->
      <slot />
    </span>
    <span v-if="showCompletion || unscoredCount > 0" :class="['flex flex-wrap gap-x-1.5 text-xs tabular-nums', props.align === 'end' && 'justify-end']">
      <template v-if="showCompletion">
        <button
          v-if="incomplete && props.onErrors" type="button"
          :class="['text-right underline decoration-dotted underline-offset-2 [color:var(--ink-errored)]']"
          :title="t('scores.completion.showCases')"
          data-testid="headline-completion"
          @click.stop.prevent="props.onErrors()"
        >
          <span :class="['whitespace-nowrap']">{{ completion.rate }}</span><template v-if="completion.reasons != null">
            <!-- The space between the parts is the only place a narrow column may wrap the completion text. -->
            {{ ' ' }}<span :class="['whitespace-nowrap']">{{ completion.reasons }}</span>
          </template>
        </button>
        <span v-else :class="[incomplete ? '[color:var(--ink-errored)]' : 'muted']" :title="t('scores.completion.hint')" data-testid="headline-completion">
          <span :class="['whitespace-nowrap']">{{ completion.rate }}</span><template v-if="completion.reasons != null">
            <!-- The space between the parts is the only place a narrow column may wrap the completion text. -->
            {{ ' ' }}<span :class="['whitespace-nowrap']">{{ completion.reasons }}</span>
          </template>
        </span>
      </template>
      <span v-if="unscoredCount > 0" :class="['muted whitespace-nowrap']" :title="unscoredText(view.summary.unscored)" data-testid="headline-unscored">· {{ t('scores.headline.unscored', { n: unscoredCount }) }}</span>
    </span>
    <ul v-if="view.tasks.length > 0" :class="['m-0 p-0 list-none grid gap-0.5 text-xs']" data-testid="headline-tasks">
      <li v-for="task in view.tasks" :key="task.taskId" :class="['flex items-baseline gap-1.5 min-w-0']">
        <span :class="['truncate muted']">{{ props.taskLabel?.(task.taskId) ?? task.taskId }}</span>
        <span :class="['shrink-0']">{{ task.label }}</span>
        <b :class="['ml-auto shrink-0 tabular-nums']">{{ formatScore(task.summary.mean) }}</b>
      </li>
    </ul>
  </span>
  <span v-else :class="['muted tabular-nums']" data-testid="headline">—</span>
</template>
