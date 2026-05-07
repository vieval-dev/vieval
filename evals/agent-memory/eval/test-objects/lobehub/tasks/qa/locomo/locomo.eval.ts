import process from 'node:process'

import { createCachedLoCoMoAnswerGenerator, createLoCoMoDatasetHash, createXsaiLoCoMoAnswerGenerator, DEFAULT_LOCOMO_DATA_FILE, deriveLoCoMoCases, evaluateLoCoMoCases, loadLoCoMoSamplesFromSnapDatasetSync, LOCOMO_CASES_SCHEMA_VERSION, normalizeLoCoMoAnswerPredictionCacheMode } from '@vieval/eval-agent-memory'
import { describeTask } from 'vieval'

import { createLobeHubRetrieverAdapter } from '../../../src/adapters/retriever.ts'

const LOCOMO_PROMPT_VERSION = 'locomo-prompt-v1'

const dataFile = process.env.LOCOMO_DATA_FILE ?? DEFAULT_LOCOMO_DATA_FILE
const maxSamples = Number(process.env.LOCOMO_MAX_SAMPLES ?? '1')
const maxCases = Number(process.env.LOCOMO_MAX_CASES ?? '5')
const topK = Number(process.env.LOCOMO_TOP_K ?? '10')
const predictionCacheMode = normalizeLoCoMoAnswerPredictionCacheMode(process.env.LOCOMO_PREDICTION_CACHE)
const samples = loadLoCoMoSamplesFromSnapDatasetSync({ dataFile, maxSamples })
const datasetHash = createLoCoMoDatasetHash(samples)
const cases = deriveLoCoMoCases(samples).slice(0, maxCases)

if (cases.length === 0) {
  throw new Error('Missing LoCoMo cases for evaluation.')
}

describeTask('locomo-lobehub', (task) => {
  task.casesFromInputs('snap-locomo-retrieval-generation-scoring', cases, async (context) => {
    const caseItem = context.matrix.inputs

    const retriever = createLobeHubRetrieverAdapter()
    const generator = createCachedLoCoMoAnswerGenerator({
      cache: context.cache,
      generator: createXsaiLoCoMoAnswerGenerator(),
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
    context.metric('locomo.caseId', record.caseId)
    context.metric('locomo.category', record.category)
    context.metric('locomo.goldAnswer', record.goldAnswer)
    context.metric('locomo.prediction', record.prediction)
    context.metric('locomo.sampleId', record.sampleId)
    context.metric('locomo.totalCases', 1)
  }, {
    autoRetry: 5,
  })
})
