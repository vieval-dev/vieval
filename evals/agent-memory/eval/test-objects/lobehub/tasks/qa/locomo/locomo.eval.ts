import type { LoCoMoCategory, LoCoMoScorerAdapter } from '@vieval/eval-agent-memory'

import process from 'node:process'

import { createLoCoMoDatasetHash, createXsaiLoCoMoScorer, DEFAULT_LOCOMO_DATA_FILE, deriveLoCoMoCases, evaluateLoCoMoCases, loadLoCoMoSamplesFromSnapDatasetSync, LOCOMO_CASES_SCHEMA_VERSION } from '@vieval/eval-agent-memory'
import { describeTask } from 'vieval'

import { createLobeHubAnswerAgentAdapter } from '../../../src/adapters/answer-agent.ts'

const dataFile = process.env.LOCOMO_DATA_FILE ?? DEFAULT_LOCOMO_DATA_FILE
const maxSamples = Number(process.env.LOCOMO_MAX_SAMPLES ?? '1')
const maxCases = Number(process.env.LOCOMO_MAX_CASES ?? '5')
const samples = loadLoCoMoSamplesFromSnapDatasetSync({ dataFile, maxSamples })
const datasetHash = createLoCoMoDatasetHash(samples)
const datasetVersion = `${LOCOMO_CASES_SCHEMA_VERSION}-${datasetHash}`
const cases = deriveLoCoMoCases(samples).slice(0, maxCases)

function parseAgentScorerCategories(value: string | undefined): Set<LoCoMoCategory> {
  const rawCategories = value?.split(',').map(part => Number(part.trim())).filter(Number.isInteger)
  const categories = rawCategories == null || rawCategories.length === 0 ? [3] : rawCategories

  return new Set(categories.filter((category): category is LoCoMoCategory =>
    category === 1 || category === 2 || category === 3 || category === 4 || category === 5,
  ))
}

function createCategoryScopedScorer(scorer: LoCoMoScorerAdapter, categories: ReadonlySet<LoCoMoCategory>): LoCoMoScorerAdapter {
  return {
    id: `${scorer.id}:categories-${[...categories].sort().join('-')}`,
    async scoreAnswer(input) {
      if (!categories.has(input.category)) {
        return {
          reasoning: 'Agent scorer disabled for this category.',
          score: Number.NaN,
        }
      }

      return await scorer.scoreAnswer(input)
    },
  }
}

const agentScorerModel = process.env.LOCOMO_AGENT_SCORER_MODEL
const agentScorerCategories = parseAgentScorerCategories(process.env.LOCOMO_AGENT_SCORER_CATEGORIES)
const agentScorer = agentScorerModel == null || agentScorerModel.trim() === ''
  ? undefined
  : createCategoryScopedScorer(createXsaiLoCoMoScorer({ model: agentScorerModel }), agentScorerCategories)

if (cases.length === 0) {
  throw new Error('Missing LoCoMo cases for evaluation.')
}

function calculateEvidenceRecall(evidence: readonly string[], contextIds: readonly string[]): number | null {
  if (evidence.length === 0) {
    return null
  }

  const retrieved = new Set(contextIds)
  const matched = evidence.filter(evidenceId => retrieved.has(evidenceId)).length
  return matched / evidence.length
}

function classifyLocomoFailure(args: {
  category: number | string
  evidenceRecall?: null | number
  prediction: string
  score: number
}): string {
  if (args.score >= 1) {
    return 'correct'
  }

  const prediction = args.prediction.trim().toLowerCase()
  if (args.score === 0 && (prediction.includes('not mentioned') || prediction.includes('no information'))) {
    return 'over_refusal'
  }
  if (args.evidenceRecall === 0) {
    return 'missing_evidence'
  }
  if (String(args.category) === '2' && args.score < 1) {
    return 'possible_wrong_date'
  }
  if (args.score > 0 && args.score < 1) {
    return 'partial_match'
  }
  if (args.score === 0 && prediction.length > 0) {
    return 'wrong_or_hallucinated'
  }
  return 'unknown'
}

describeTask('locomo-lobehub', (task) => {
  task.casesFromInputs('snap-locomo-agent-answer-scoring', cases, async (context) => {
    const caseItem = context.matrix.inputs

    const evaluation = await evaluateLoCoMoCases({
      answerer: createLobeHubAnswerAgentAdapter(),
      cases: [caseItem],
      concurrency: 1,
      mode: 'agentAnswer',
      scorer: agentScorer,
    })
    const record = evaluation.records[0]
    if (record == null) {
      throw new Error(`Missing LoCoMo evaluation record for ${caseItem.caseId}.`)
    }

    context.score(record.score)
    const evidenceRecall = calculateEvidenceRecall(caseItem.evidence, record.contextIds)
    context.metric('locomo.caseId', record.caseId)
    context.metric('locomo.category', record.category)
    context.metric('locomo.goldAnswer', record.goldAnswer)
    context.metric('locomo.prediction', record.prediction)
    context.metric('locomo.sampleId', record.sampleId)
    context.metric('locomo.totalCases', 1)
    context.metric('benchmark.id', 'locomo')
    context.metric('benchmark.dataset.id', 'locomo')
    context.metric('benchmark.dataset.version', datasetVersion)
    context.metric('benchmark.case.id', record.caseId)
    context.metric('benchmark.locomo.case_id', record.caseId)
    context.metric('benchmark.locomo.sample_id', record.sampleId)
    context.metric('benchmark.locomo.category', record.category)
    context.metric('benchmark.locomo.question', record.question)
    context.metric('benchmark.locomo.gold_answer', record.goldAnswer)
    context.metric('benchmark.locomo.prediction', record.prediction)
    context.metric('benchmark.locomo.answer_score', record.score)
    if (record.agentScore != null) {
      context.metric('benchmark.locomo.agent_score', record.agentScore)
      context.metric('benchmark.locomo.agent_score_reasoning', record.agentScoreReasoning ?? null)
      context.metric('benchmark.locomo.score_gap', record.agentScore - record.score)
    }
    context.metric('benchmark.locomo.context_ids', record.contextIds)
    context.metric('benchmark.locomo.retrieved_context_count', record.contextIds.length)
    if (record.retrievalDiagnostics != null) {
      context.metric('benchmark.locomo.retrieval.item_count', record.retrievalDiagnostics.itemCount ?? null)
      context.metric('benchmark.locomo.retrieval.joined_memory_count', record.retrievalDiagnostics.joinedMemoryCount ?? null)
      context.metric('benchmark.locomo.retrieval.raw_context_count', record.retrievalDiagnostics.retrievedContextCount ?? null)
      context.metric('benchmark.locomo.retrieval.raw_layer_counts', JSON.stringify(record.retrievalDiagnostics.retrievedLayerCounts ?? {}))
      context.metric('benchmark.locomo.retrieval.searched_layer_counts', JSON.stringify(record.retrievalDiagnostics.searchedLayerCounts ?? {}))
    }
    if (record.agentDiagnostics != null) {
      context.metric('benchmark.locomo.agent.operation_id', record.agentDiagnostics.operationId ?? null)
      context.metric('benchmark.locomo.agent.status', record.agentDiagnostics.status ?? null)
      context.metric('benchmark.locomo.agent.steps', record.agentDiagnostics.steps ?? null)
      context.metric('benchmark.locomo.agent.tool_call_count', record.agentDiagnostics.toolCallCount ?? null)
      context.metric('benchmark.locomo.agent.memory_tool_call_count', record.agentDiagnostics.memoryToolCallCount ?? null)
      context.metric('benchmark.locomo.agent.memory_searches', JSON.stringify(record.agentDiagnostics.memorySearches ?? []))
      context.metric('benchmark.locomo.agent.final_message_id', record.agentDiagnostics.finalMessageId ?? null)
    }
    context.metric('benchmark.locomo.evidence_ids', caseItem.evidence)
    context.metric('benchmark.locomo.evidence_recall', evidenceRecall)
    context.metric('benchmark.locomo.failure_kind', classifyLocomoFailure({
      category: record.category,
      evidenceRecall,
      prediction: record.prediction,
      score: record.score,
    }))
  }, {
    autoRetry: 5,
  })
})
