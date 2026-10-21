<script setup lang="ts">
import type { Grader, ScoreRecordedData } from 'vieval/events'

import type { ScoreDefinition } from '../../../src/shared/contract'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ObjectTree from './ObjectTree.vue'

import { localize } from '../localize'
import { formulaText, graderText, scoreDefinition, scoreLabel, unscoredReasonLabel } from '../scores'

/**
 * Why one score of one case has its value: the value, its definition (description, formula), what produced it (the
 * grader, or for a derived score the graders of its inputs), the rationale and metadata the record carried, and a link
 * to the grader's model calls.
 *
 * The body of the score badges on the case page, shared by the desktop popover and the phone drawer.
 */
const props = defineProps<{
  /** Model calls of the grader in this case; the link is shown when there are any. */
  callCount: number
  /** Case page on its inference tab, narrowed to the grader's calls. */
  callsHref?: string
  definitions: readonly ScoreDefinition[]
  name: string
  /** The last `score.recorded` of the score in the case's last round; absent when the case never recorded it. */
  record?: ScoreRecordedData
  /** The value as shown on the badge (a percentage, an unscored reason, or `—`). */
  text: string
}>()

const { t } = useI18n()
const definition = computed(() => scoreDefinition(props.name, props.definitions))
const label = computed(() => scoreLabel(props.name, props.definitions))
const description = computed(() => localize(definition.value?.description))
const formula = computed(() => formulaText(definition.value, props.definitions))
const grader = computed<Grader | undefined>(() => props.record?.grader ?? definition.value?.grader)
/** A derived score has no grader of its own; the graders of its inputs say what it rests on. */
const inputGraders = computed(() => (definition.value?.combine?.inputs ?? []).flatMap((input) => {
  const inputGrader = scoreDefinition(input.name, props.definitions)?.grader
  return inputGrader == null ? [] : [{ label: scoreLabel(input.name, props.definitions), text: graderText(inputGrader) }]
}))
const unscored = computed(() => (props.record != null && 'unscored' in props.record ? unscoredReasonLabel(props.record.unscored.reason) : undefined))
const derived = computed(() => props.record?.derived === true || definition.value?.combine != null)
</script>

<template>
  <div :class="['grid gap-2 text-xs']" data-testid="score-detail">
    <div :class="['flex items-start gap-2']">
      <div :class="['min-w-0']">
        <div :class="['text-sm font-semibold leading-snug']">
          {{ label }}
        </div>
        <div v-if="label !== props.name" :class="['mono text-[11px] opacity-70 break-all']">
          {{ props.name }}
        </div>
      </div>
      <b :class="['ml-auto text-lg tabular-nums leading-none']" data-testid="score-detail-value">{{ props.text }}</b>
    </div>
    <div v-if="definition?.primary || derived || unscored" :class="['flex flex-wrap gap-1']">
      <span v-if="definition?.primary" :class="['badge state-neutral']">{{ t('scores.detail.primary') }}</span>
      <span v-if="derived" :class="['badge state-neutral']" data-testid="score-detail-derived">{{ t('scores.detail.derived') }}</span>
      <span v-if="unscored" :class="['badge state-interrupted']" data-testid="score-detail-unscored">{{ t('scores.detail.unscored', { reason: unscored }) }}</span>
    </div>
    <p v-if="description" :class="['m-0 leading-snug opacity-90']">
      {{ description }}
    </p>
    <dl :class="['m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1']">
      <template v-if="formula">
        <dt :class="['opacity-70']">
          {{ t('scores.detail.formula') }}
        </dt>
        <dd :class="['m-0']">
          {{ formula }}
        </dd>
      </template>
      <template v-if="grader">
        <dt :class="['opacity-70']">
          {{ t('scores.detail.grader') }}
        </dt>
        <dd :class="['m-0']" data-testid="score-detail-grader">
          {{ graderText(grader) }}<span v-if="grader.id" :class="['mono opacity-70']"> ({{ grader.id }})</span>
        </dd>
      </template>
      <template v-else-if="inputGraders.length > 0">
        <dt :class="['opacity-70']">
          {{ t('scores.detail.graders') }}
        </dt>
        <dd :class="['m-0 grid gap-0.5']">
          <span v-for="input in inputGraders" :key="input.label">{{ input.label }}: {{ input.text }}</span>
        </dd>
      </template>
    </dl>
    <a v-if="props.callsHref && props.callCount > 0" :href="props.callsHref" :class="['link inline-flex items-center gap-1']" data-testid="score-detail-calls">
      <span class="i-mingcute-robot-line" aria-hidden="true" />{{ t('scores.detail.calls', { n: props.callCount }, props.callCount) }}
    </a>
    <div v-if="props.record?.rationale" :class="['grid gap-0.5']">
      <div :class="['opacity-70']">
        {{ t('scores.detail.rationale') }}
      </div>
      <!-- A judge's reasoning can run long; it scrolls inside the card. -->
      <p :class="['m-0 max-h-48 overflow-y-auto whitespace-pre-wrap leading-snug']" data-testid="score-detail-rationale">
        {{ props.record.rationale }}
      </p>
    </div>
    <div v-if="props.record?.metadata" :class="['grid gap-0.5']">
      <div :class="['opacity-70']">
        {{ t('scores.detail.metadata') }}
      </div>
      <div :class="['max-h-48 overflow-auto']">
        <ObjectTree :value="props.record.metadata" />
      </div>
    </div>
    <p v-if="props.record == null" :class="['m-0 opacity-70']">
      {{ t('scores.detail.noValue') }}
    </p>
  </div>
</template>
