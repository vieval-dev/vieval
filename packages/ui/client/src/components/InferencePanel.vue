<script setup lang="ts">
import type { CaseDetail } from '../../../src/shared/contract'
import type { TokenUsage } from '../../../src/shared/inference'

import { computed, reactive } from 'vue'

import ObjectTree from './ObjectTree.vue'
import StateBadge from './StateBadge.vue'

import { groupInferenceCalls, modelKeyOf, summarizeByModel, tokenUsage } from '../../../src/shared/inference'
import { formatCount, formatDuration, formatTime, previewValue } from '../format'
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
        <span class="i-mingcute-filter-line" aria-hidden="true" />calls of grader <span class="mono">{{ props.grader }}</span><span class="i-mingcute-close-line" aria-label="Show every call" />
      </button>
    </div>
    <section class="card">
      <h2 class="card-title">
        <span class="i-mingcute-coin-line" aria-hidden="true" />Usage
        <span v-if="single" class="text-xs muted font-normal mono">{{ single.label }}</span>
        <span v-else class="text-xs muted font-normal">{{ models.length }} models · tokens add up all of them</span>
      </h2>
      <dl :class="['p-3 grid gap-x-6 gap-y-3 text-sm']" style="grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))">
        <div>
          <dt class="text-xs muted">
            Model calls
          </dt>
          <dd :class="['text-xl font-semibold tabular-nums']" data-testid="inference-calls">
            {{ calls.length }}
          </dd>
          <dd v-if="failed > 0" class="text-xs text-red-700 dark:text-red-300">
            {{ failed }} failed
          </dd>
        </div>
        <div>
          <dt class="text-xs muted">
            Input tokens
          </dt>
          <dd :class="['text-xl font-semibold tabular-nums']" :title="overall.input?.toLocaleString()" data-testid="inference-input">
            {{ overall.input == null ? '—' : formatCount(overall.input) }}
          </dd>
          <dd v-if="overall.cached != null" class="text-xs muted tabular-nums">
            {{ formatCount(overall.cached) }} cached · {{ percentOf(overall.cached, overall.input) }}
          </dd>
        </div>
        <div>
          <dt class="text-xs muted">
            Output tokens
          </dt>
          <dd :class="['text-xl font-semibold tabular-nums']" :title="overall.output?.toLocaleString()" data-testid="inference-output">
            {{ overall.output == null ? '—' : formatCount(overall.output) }}
          </dd>
          <dd v-if="overall.reasoning" class="text-xs muted tabular-nums">
            {{ formatCount(overall.reasoning) }} reasoning
          </dd>
        </div>
        <div>
          <dt class="text-xs muted">
            Total tokens
          </dt>
          <dd :class="['text-xl font-semibold tabular-nums']" :title="overall.total?.toLocaleString()" data-testid="inference-total">
            {{ overall.total == null ? '—' : formatCount(overall.total) }}
          </dd>
          <dd v-if="multipleModels" class="text-xs muted" title="Each model counts with its own tokenizer and price, so this total is not a cost.">
            all {{ models.length }} models
          </dd>
        </div>
        <div>
          <dt class="text-xs muted">
            Model time
          </dt>
          <dd :class="['text-xl font-semibold tabular-nums']">
            {{ responses > 0 ? formatDuration(latencyMs) : '—' }}
          </dd>
          <dd v-if="responses > 0" class="text-xs muted tabular-nums">
            {{ formatDuration(latencyMs / responses) }} per call
          </dd>
        </div>
        <div>
          <dt class="text-xs muted">
            Tool calls
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
                Model
              </th>
              <th class="th text-right!">
                Calls
              </th>
              <th class="th text-right!">
                Input tokens
              </th>
              <th class="th text-right!">
                Output tokens
              </th>
              <th class="th text-right!">
                Total tokens
              </th>
              <th class="th text-right!">
                Model time
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="model in models" :key="model.key" :class="['border-b last:border-b-0 border-neutral-100/70 dark:border-neutral-900']">
              <td :class="['td mono text-xs']">
                {{ model.label }}
              </td>
              <td :class="['td mono text-xs text-right whitespace-nowrap']">
                {{ model.calls }}<span v-if="model.failed > 0" class="text-red-700 dark:text-red-300"> · {{ model.failed }} failed</span>
              </td>
              <td :class="['td mono text-xs text-right whitespace-nowrap']">
                {{ model.tokens.input?.toLocaleString() ?? '—' }}
                <span v-if="model.tokens.cached" class="muted">{{ percentOf(model.tokens.cached, model.tokens.input) }} cached</span>
              </td>
              <td :class="['td mono text-xs text-right whitespace-nowrap']">
                {{ model.tokens.output?.toLocaleString() ?? '—' }}
                <span v-if="model.tokens.reasoning" class="muted">{{ formatCount(model.tokens.reasoning) }} reasoning</span>
              </td>
              <td :class="['td mono text-xs text-right whitespace-nowrap']">
                {{ model.tokens.total?.toLocaleString() ?? '—' }}
              </td>
              <td :class="['td mono text-xs text-right whitespace-nowrap']">
                {{ model.responses > 0 ? formatDuration(model.latencyMs) : '—' }}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr :class="['border-t border-neutral-200/50 dark:border-neutral-800/50 font-semibold']" data-testid="inference-models-total">
              <td :class="['td text-xs']">
                All models
              </td>
              <td :class="['td mono text-xs text-right whitespace-nowrap']">
                {{ calls.length }}<span v-if="failed > 0" class="text-red-700 dark:text-red-300"> · {{ failed }} failed</span>
              </td>
              <td :class="['td mono text-xs text-right whitespace-nowrap']">
                {{ overall.input?.toLocaleString() ?? '—' }}
                <span v-if="overall.cached" class="muted font-normal">{{ percentOf(overall.cached, overall.input) }} cached</span>
              </td>
              <td :class="['td mono text-xs text-right whitespace-nowrap']">
                {{ overall.output?.toLocaleString() ?? '—' }}
                <span v-if="overall.reasoning" class="muted font-normal">{{ formatCount(overall.reasoning) }} reasoning</span>
              </td>
              <td :class="['td mono text-xs text-right whitespace-nowrap']">
                {{ overall.total?.toLocaleString() ?? '—' }}
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
          All usage fields as the provider reported them
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
                {{ value.toLocaleString() }}
              </dd>
            </template>
          </dl>
        </template>
      </details>
    </section>

    <section class="card">
      <h2 class="card-title">
        <span class="i-mingcute-robot-line" aria-hidden="true" />Calls
        <span class="text-xs muted font-normal">in order; open a row for its raw events</span>
      </h2>
      <div :class="['overflow-x-auto']">
        <table :class="['w-full max-md:min-w-[40rem]']" data-testid="inference-call-table">
          <thead>
            <tr :class="['border-b border-neutral-200/50 dark:border-neutral-800/50']">
              <th class="th">
                #
              </th>
              <th class="th">
                Time
              </th>
              <th v-if="multipleModels" class="th">
                Model
              </th>
              <th class="th text-right!">
                Latency
              </th>
              <th class="th text-right!">
                Input
              </th>
              <th class="th text-right!">
                Output
              </th>
              <th class="th">
                Model asked for
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(call, index) in calls" :key="call.seq">
              <tr :class="['border-b border-neutral-100/70 dark:border-neutral-900 cursor-pointer hover:bg-primary-500/5']" @click="toggle(call.seq)">
                <td :class="['td mono text-xs whitespace-nowrap']">
                  <button type="button" :class="['inline-flex items-center gap-1']" :aria-expanded="expanded.has(call.seq)" :aria-label="`Raw events of call ${index + 1}`" @click.stop="toggle(call.seq)">
                    <span :class="[expanded.has(call.seq) ? 'i-mingcute-down-line' : 'i-mingcute-right-line', 'muted']" aria-hidden="true" />{{ index + 1 }}
                  </button>
                  <span v-if="multipleRounds" class="badge state-neutral ml-1">round {{ call.roundIndex ?? 0 }}</span>
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
                  {{ call.tokens.input?.toLocaleString() ?? '—' }}
                  <span v-if="call.tokens.cached" class="muted">{{ percentOf(call.tokens.cached, call.tokens.input) }} cached</span>
                </td>
                <td :class="['td mono text-xs text-right whitespace-nowrap']">
                  {{ call.tokens.output?.toLocaleString() ?? '—' }}
                </td>
                <td :class="['td text-xs']">
                  <StateBadge v-if="call.state !== 'responded'" :state="call.state === 'pending' ? 'running' : 'failed'" />
                  <span v-if="call.error" :class="['ml-1 text-red-700 dark:text-red-300']">{{ previewValue(call.error, 120) }}</span>
                  <span v-else-if="call.state === 'responded' && call.toolCalls.length === 0" class="muted">no tool call</span>
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
