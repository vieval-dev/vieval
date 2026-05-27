import process from 'node:process'

import { createCachedLoCoMoAnswerGenerator, createLoCoMoDatasetHash, createXsaiLoCoMoAnswerGenerator, DEFAULT_LOCOMO_DATA_FILE, deriveLoCoMoCases, evaluateLoCoMoCases, loadLoCoMoSamplesFromSnapDatasetSync, LOCOMO_CASES_SCHEMA_VERSION, normalizeLoCoMoAnswerPredictionCacheMode } from '@vieval/eval-agent-memory'
import { describeTask } from 'vieval'
import { openrouterFromRunContext } from 'vieval/plugins/chat-models'

import { createMem9RetrieverAdapter } from '../../../src/adapters/retriever'

const LOCOMO_PROMPT_VERSION = 'locomo-prompt-v1'

const dataFile = process.env.LOCOMO_DATA_FILE ?? DEFAULT_LOCOMO_DATA_FILE
const maxSamples = Number(process.env.LOCOMO_MAX_SAMPLES ?? '1')
const maxCases = Number(process.env.LOCOMO_MAX_CASES ?? '5')
const topK = Number(process.env.LOCOMO_TOP_K ?? '10')
const predictionCacheMode = normalizeLoCoMoAnswerPredictionCacheMode(process.env.LOCOMO_PREDICTION_CACHE)
const samples = loadLoCoMoSamplesFromSnapDatasetSync({ dataFile, maxSamples })
const datasetHash = createLoCoMoDatasetHash(samples)
const datasetVersion = `${LOCOMO_CASES_SCHEMA_VERSION}-${datasetHash}`
const cases = deriveLoCoMoCases(samples).slice(0, maxCases)

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

describeTask('locomo-mem9', (task) => {
  task.casesFromInputs('snap-locomo-retrieval-generation-scoring', cases, async (context) => {
    const caseItem = context.matrix.inputs

    const retriever = createMem9RetrieverAdapter({
      tenantId: process.env.MEM9_TENANT_ID ?? 'benchmark-locomo',
    })
    const model = openrouterFromRunContext(context.model())
    const generator = createCachedLoCoMoAnswerGenerator({
      cache: context.cache,
      generator: createXsaiLoCoMoAnswerGenerator({
        apiKey: model.apiKey,
        baseUrl: model.baseURL,
        model: model.model,
      }),
      mode: predictionCacheMode,
      namespaceParts: {
        datasetHash,
        promptVersion: `${LOCOMO_CASES_SCHEMA_VERSION}-${LOCOMO_PROMPT_VERSION}`,
        retrieverId: retriever.id,
        topK,
      },
    })

    const evaluation = await evaluateLoCoMoCases({
      cases: [caseItem],
      concurrency: 1,
      generator,
      retriever,
      topK,
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
    context.metric('benchmark.locomo.top_k', topK)
    context.metric('benchmark.locomo.answer_score', record.score)
    context.metric('benchmark.locomo.context_ids', record.contextIds)
    context.metric('benchmark.locomo.retrieved_context_count', record.contextIds.length)
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
