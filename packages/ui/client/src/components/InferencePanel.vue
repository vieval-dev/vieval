<script setup lang="ts">
import type { CaseDetail } from '../../../src/shared/contract'
import type { TokenUsage } from '../../../src/shared/inference'

import { computed, reactive } from 'vue'
import { I18nT, useI18n } from 'vue-i18n'

import ObjectTree from './ObjectTree.vue'
import StateBadge from './StateBadge.vue'

import { groupInferenceCalls, modelKeyOf, summarizeByModel, tokenUsage } from '../../../src/shared/inference'
import { formatCount, formatDuration, formatTime, previewValue } from '../format'
import { currentLocale } from '../i18n'
import { isGraderCall } from '../scores'

/**
 * Model calls of one case: what they cost in total (calls, tokens, model time, tool calls), then one row per call
 * with its usage and the tool calls the model asked for. A row expands to the raw events.
 *
 * With more than one model, every model gets its own row, and the summary adds up the token counts each model
 * reported. That sum says how many tokens the case processed, but not what it cost: tokenizers and prices differ.
 *
 * With `grader`, only the calls of that grader (a score's judge) are shown and summed, with a chip to show them all.
 */
const props = defineProps<{
  events: CaseDetail['inference']
  /** Grader `id` of a score; narrows the panel to its calls ({@link isGraderCall}). */
  grader?: string
}>()
const emit = defineEmits<{ clearGrader: [] }>()
const { t } = useI18n()

const calls = computed(() => groupInferenceCalls(props.events)
  .filter(call => props.grader == null || isGraderCall(call, props.grader))
  .map(call => ({ ...call, tokens: tokenUsage(call.usage) })))
const models = computed(() => summarizeByModel(calls.value).map(model => ({
  ...model,
  tokens: tokenUsage(model.usage),
  /** Every usage field, for providers whose fields `tokenUsage` does not name. */
  usageFields: Object.entries(model.usage).sort(([left], [right]) => left.localeCompare(right)),
})))
const multipleModels = computed(() => models.value.length > 1)
const single = computed(() => (multipleModels.value ? undefined : models.value[0]))
/**
 * Token counts of every model added up. Normalized counts are added, not raw usage fields: providers name the same
 * count differently (`input_tokens`, `prompt_tokens`). A count stays absent when no model reported it.
 */
const overall = computed<TokenUsage>(() => {
  const sum = (pick: (tokens: TokenUsage) => number | undefined): number | undefined => {
    const values = models.value.map(model => pick(model.tokens)).filter(value => value != null)
    return values.length === 0 ? undefined : values.reduce((total, value) => total + value, 0)
  }
  return { cached: sum(tokens => tokens.cached), input: sum(tokens => tokens.input), output: sum(tokens => tokens.output), reasoning: sum(tokens => tokens.reasoning), total: sum(tokens => tokens.total) }
})
const failed = computed(() => models.value.reduce((sum, model) => sum + model.failed, 0))
const responses = computed(() => models.value.reduce((sum, model) => sum + model.responses, 0))
const latencyMs = computed(() => models.value.reduce((sum, model) => sum + model.latencyMs, 0))
const toolCallCount = computed(() => models.value.reduce((sum, model) => sum + model.toolCalls, 0))
const modelLabels = computed(() => new Map(models.value.map(model => [model.key, model.label])))
const multipleRounds = computed(() => calls.value.some(call => (call.roundIndex ?? 0) > 0))

function percentOf(part: number, whole: number | undefined): string {
  return whole == null || whole === 0 ? '' : `${Math.round((part / whole) * 100)}%`
}

/** Seq of the calls whose raw events are shown. */
const expanded = reactive(new Set<number>())
function toggle(seq: number): void {
  if (!expanded.delete(seq))
    expanded.add(seq)
}
</script>

<template>
  <div :class="['flex flex-col gap-4']" data-testid="inference-panel">
    <div v-if="props.grader" :class="['flex items-center gap-2 text-xs']">
      <button type="button" :class="['btn btn-active text-xs py-0.5!']" data-testid="inference-grader" @click="emit('clearGrader')">
        <span class="i-mingcute-filter-line" aria-hidden="true" /><I18nT keypath="cases.inference.graderCalls" scope="global">
          <template #grader>
            <span class="mono">{{ props.grader }}</span>
          </template>
        </I18nT><span class="i-mingcute-close-line" :aria-label="t('cases.inference.showEveryCall')" />
      </button>
    </div>
    <section class="card">
      <h2 class="card-title">
        <span class="i-mingcute-coin-line" aria-hidden="true" />{{ t('cases.inference.usage') }}
        <span v-if="single" class="text-xs muted font-normal mono">{{ single.label }}</span>
        <span v-else class="text-xs muted font-normal">{{ t('cases.inference.modelsSummed', { n: models.length }) }}</span>
      </h2>
      <dl :class="['p-3 grid gap-x-6 gap-y-3 text-sm']" style="grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))">
        <div>
          <dt class="text-xs muted">
            {{ t('cases.inference.modelCalls') }}
          </dt>
          <dd :class="['text-xl font-semibold tabular-nums']" data-testid="inference-calls">
            {{ calls.length }}
          </dd>
          <dd v-if="failed > 0" class="text-xs text-red-700 dark:text-red-300">
            {{ t('cases.inference.failed', { n: failed }) }}
          </dd>
        </div>
        <div>
          <dt class="text-xs muted">
            {{ t('cases.inference.inputTokens') }}
          </dt>
          <dd :class="['text-xl font-semibold tabular-nums']" :title="overall.input?.toLocaleString(currentLocale())" data-testid="inference-input">
            {{ overall.input == null ? '—' : formatCount(overall.input) }}
          </dd>
          <dd v-if="overall.cached != null" class="text-xs muted tabular-nums">
            {{ t('cases.inference.cachedOfInput', { count: formatCount(overall.cached), percent: percentOf(overall.cached, overall.input) }) }}
          </dd>
        </div>
        <div>
          <dt class="text-xs muted">
            {{ t('cases.inference.outputTokens') }}
          </dt>
          <dd :class="['text-xl font-semibold tabular-nums']" :title="overall.output?.toLocaleString(currentLocale())" data-testid="inference-output">
            {{ overall.output == null ? '—' : formatCount(overall.output) }}
          </dd>
          <dd v-if="overall.reasoning" class="text-xs muted tabular-nums">
            {{ t('cases.inference.reasoning', { count: formatCount(overall.reasoning) }) }}
          </dd>
        </div>
        <div>
          <dt class="text-xs muted">
            {{ t('cases.inference.totalTokens') }}
          </dt>
          <dd :class="['text-xl font-semibold tabular-nums']" :title="overall.total?.toLocaleString(currentLocale())" data-testid="inference-total">
            {{ overall.total == null ? '—' : formatCount(overall.total) }}
          </dd>
          <dd v-if="multipleModels" class="text-xs muted" :title="t('cases.inference.totalNotCost')">
            {{ t('cases.inference.allModelsCount', { n: models.length }) }}
          </dd>
        </div>
        <div>
          <dt class="text-xs muted">
            {{ t('cases.inference.modelTime') }}
          </dt>
          <dd :class="['text-xl font-semibold tabular-nums']">
            {{ responses > 0 ? formatDuration(latencyMs) : '—' }}
          </dd>
          <dd v-if="responses > 0" class="text-xs muted tabular-nums">
            {{ t('cases.inference.perCall', { duration: formatDuration(latencyMs / responses) }) }}
          </dd>
        </div>
        <div>
          <dt class="text-xs muted">
            {{ t('cases.inference.toolCalls') }}
          </dt>
          <dd :class="['text-xl font-semibold tabular-nums']">
            {{ toolCallCount }}
          </dd>
        </div>
      </dl>
      <div v-if="multipleModels" :class="['overflow-x-auto border-t border-neutral-200/50 dark:border-neutral-800/50']">
        <table :class="['w-full max-md:min-w-[40rem]']" data-testid="inference-models">
          <thead>
            <tr :class="['border-b border-neutral-200/50 dark:border-neutral-800/50']">
              <th class="th">
                {{ t('cases.inference.model') }}
              </th>
              <th class="th text-right!">
                {{ t('cases.inference.calls') }}
              </th>
              <th class="th text-right!">
                {{ t('cases.inference.inputTokens') }}
              </th>
              <th class="th text-right!">
                {{ t('cases.inference.outputTokens') }}
              </th>
              <th class="th text-right!">
                {{ t('cases.inference.totalTokens') }}
              </th>
              <th class="th text-right!">
                {{ t('cases.inference.modelTime') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="model in models" :key="model.key" :class="['border-b last:border-b-0 border-neutral-100/70 dark:border-neutral-900']">
              <td :class="['td mono text-xs']">
                {{ model.label }}
              </td>
              <td :class="['td mono text-xs text-right whitespace-nowrap']">
                {{ model.calls }}<span v-if="model.failed > 0" class="text-red-700 dark:text-red-300"> · {{ t('cases.inference.failed', { n: model.failed }) }}</span>
              </td>
              <td :class="['td mono text-xs text-right whitespace-nowrap']">
                {{ model.tokens.input?.toLocaleString(currentLocale()) ?? '—' }}
                <span v-if="model.tokens.cached" class="muted">{{ t('cases.inference.cached', { percent: percentOf(model.tokens.cached, model.tokens.input) }) }}</span>
              </td>
              <td :class="['td mono text-xs text-right whitespace-nowrap']">
                {{ model.tokens.output?.toLocaleString(currentLocale()) ?? '—' }}
                <span v-if="model.tokens.reasoning" class="muted">{{ t('cases.inference.reasoning', { count: formatCount(model.tokens.reasoning) }) }}</span>
              </td>
              <td :class="['td mono text-xs text-right whitespace-nowrap']">
                {{ model.tokens.total?.toLocaleString(currentLocale()) ?? '—' }}
              </td>
              <td :class="['td mono text-xs text-right whitespace-nowrap']">
                {{ model.responses > 0 ? formatDuration(model.latencyMs) : '—' }}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr :class="['border-t border-neutral-200/50 dark:border-neutral-800/50 font-semibold']" data-testid="inference-models-total">
              <td :class="['td text-xs']">
                {{ t('cases.inference.allModels') }}
              </td>
              <td :class="['td mono text-xs text-right whitespace-nowrap']">
                {{ calls.length }}<span v-if="failed > 0" class="text-red-700 dark:text-red-300"> · {{ t('cases.inference.failed', { n: failed }) }}</span>
              </td>
              <td :class="['td mono text-xs text-right whitespace-nowrap']">
                {{ overall.input?.toLocaleString(currentLocale()) ?? '—' }}
                <span v-if="overall.cached" class="muted font-normal">{{ t('cases.inference.cached', { percent: percentOf(overall.cached, overall.input) }) }}</span>
              </td>
              <td :class="['td mono text-xs text-right whitespace-nowrap']">
                {{ overall.output?.toLocaleString(currentLocale()) ?? '—' }}
                <span v-if="overall.reasoning" class="muted font-normal">{{ t('cases.inference.reasoning', { count: formatCount(overall.reasoning) }) }}</span>
              </td>
              <td :class="['td mono text-xs text-right whitespace-nowrap']">
                {{ overall.total?.toLocaleString(currentLocale()) ?? '—' }}
              </td>
              <td :class="['td mono text-xs text-right whitespace-nowrap']">
                {{ responses > 0 ? formatDuration(latencyMs) : '—' }}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <details v-if="models.some(model => model.usageFields.length > 0)" :class="['px-3 py-3 text-xs', multipleModels ? 'border-t border-neutral-200/50 dark:border-neutral-800/50' : 'pt-0']">
        <summary :class="['cursor-pointer muted']">
          {{ t('cases.inference.usageFields') }}
        </summary>
        <template v-for="model in models" :key="model.key">
          <div v-if="multipleModels && model.usageFields.length > 0" :class="['mt-3 mono font-semibold']">
            {{ model.label }}
          </div>
          <dl :class="['mt-2 grid gap-x-4 gap-y-1 mono']" style="grid-template-columns: max-content max-content">
            <template v-for="[name, value] in model.usageFields" :key="name">
              <dt class="muted">
                {{ name }}
              </dt>
              <dd class="text-right">
                {{ value.toLocaleString(currentLocale()) }}
              </dd>
            </template>
          </dl>
        </template>
      </details>
    </section>

    <section class="card">
      <h2 class="card-title">
        <span class="i-mingcute-robot-line" aria-hidden="true" />{{ t('cases.inference.calls') }}
        <span class="text-xs muted font-normal">{{ t('cases.inference.callsHint') }}</span>
      </h2>
      <div :class="['overflow-x-auto']">
        <table :class="['w-full max-md:min-w-[40rem]']" data-testid="inference-call-table">
          <thead>
            <tr :class="['border-b border-neutral-200/50 dark:border-neutral-800/50']">
              <th class="th">
                #
              </th>
              <th class="th">
                {{ t('cases.inference.time') }}
              </th>
              <th v-if="multipleModels" class="th">
                {{ t('cases.inference.model') }}
              </th>
              <th class="th text-right!">
                {{ t('cases.inference.latency') }}
              </th>
              <th class="th text-right!">
                {{ t('cases.inference.input') }}
              </th>
              <th class="th text-right!">
                {{ t('cases.inference.output') }}
              </th>
              <th class="th">
                {{ t('cases.inference.modelAskedFor') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(call, index) in calls" :key="call.seq">
              <tr :class="['border-b border-neutral-100/70 dark:border-neutral-900 cursor-pointer hover:bg-primary-500/5']" @click="toggle(call.seq)">
                <td :class="['td mono text-xs whitespace-nowrap']">
                  <button type="button" :class="['inline-flex items-center gap-1']" :aria-expanded="expanded.has(call.seq)" :aria-label="t('cases.inference.rawEvents', { n: index + 1 })" @click.stop="toggle(call.seq)">
                    <span :class="[expanded.has(call.seq) ? 'i-mingcute-down-line' : 'i-mingcute-right-line', 'muted']" aria-hidden="true" />{{ index + 1 }}
                  </button>
                  <span v-if="multipleRounds" class="badge state-neutral ml-1">{{ t('cases.round', { n: call.roundIndex ?? 0 }) }}</span>
                </td>
                <td :class="['td mono text-xs muted whitespace-nowrap']">
                  {{ formatTime(call.requestedAt ?? call.settledAt) }}
                </td>
                <td v-if="multipleModels" :class="['td mono text-xs whitespace-nowrap']">
                  {{ modelLabels.get(modelKeyOf(call.provider)) }}
                </td>
                <td :class="['td mono text-xs text-right whitespace-nowrap']">
                  {{ formatDuration(call.latencyMs) }}
                </td>
                <td :class="['td mono text-xs text-right whitespace-nowrap']">
                  {{ call.tokens.input?.toLocaleString(currentLocale()) ?? '—' }}
                  <span v-if="call.tokens.cached" class="muted">{{ t('cases.inference.cached', { percent: percentOf(call.tokens.cached, call.tokens.input) }) }}</span>
                </td>
                <td :class="['td mono text-xs text-right whitespace-nowrap']">
                  {{ call.tokens.output?.toLocaleString(currentLocale()) ?? '—' }}
                </td>
                <td :class="['td text-xs']">
                  <StateBadge v-if="call.state !== 'responded'" :state="call.state === 'pending' ? 'running' : 'failed'" />
                  <span v-if="call.error" :class="['ml-1 text-red-700 dark:text-red-300']">{{ previewValue(call.error, 120) }}</span>
                  <span v-else-if="call.state === 'responded' && call.toolCalls.length === 0" class="muted">{{ t('cases.inference.noToolCall') }}</span>
                  <span v-for="toolCall in call.toolCalls" :key="toolCall.id ?? toolCall.name" :class="['mono block truncate max-w-[36rem]']" :title="previewValue(toolCall.args, 2000)">
                    <b>{{ toolCall.name }}</b> <span class="muted">{{ previewValue(toolCall.args, 100) }}</span>
                  </span>
                </td>
              </tr>
              <tr v-if="expanded.has(call.seq)" :class="['border-b border-neutral-100/70 dark:border-neutral-900']">
                <td :colspan="multipleModels ? 7 : 6" :class="['td bg-neutral-500/5']">
                  <div v-for="event in call.events" :key="event.seq" :class="['mb-2 last:mb-0']">
                    <div :class="['text-xs mono muted mb-1']">
                      {{ event.event }} · {{ formatTime(event.time) }} · seq {{ event.seq }}
                    </div>
                    <ObjectTree :value="event.data" />
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
