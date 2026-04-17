import process from 'node:process'

import { createLoCoMoDatasetHash, createXsaiLoCoMoAnswerGenerator, deriveLoCoMoCases, evaluateLoCoMoCases, loadLoCoMoSamplesFromSnapDataset, loadOrDeriveLoCoMoCases, LOCOMO_CASES_SCHEMA_VERSION } from '@vieval/eval-agent-memory'
import { caseOf, describeTask } from 'vieval'

import { createLobeHubRetrieverAdapter } from '../../../src/adapters/retriever.ts'

const DEFAULT_SNAP_DATA_FILE = '/Users/neko/Git/github.com/snap-research/locomo/data/locomo10.json'

describeTask('locomo-lobehub', () => {
  caseOf('snap-locomo-retrieval-generation-scoring', async (context) => {
    const dataFile = process.env.LOCOMO_DATA_FILE ?? DEFAULT_SNAP_DATA_FILE
    const maxSamples = Number(process.env.LOCOMO_MAX_SAMPLES ?? '1')
    const maxCases = Number(process.env.LOCOMO_MAX_CASES ?? '5')
    const topK = Number(process.env.LOCOMO_TOP_K ?? '10')
    const concurrency = Number(process.env.LOCOMO_EVAL_CONCURRENCY ?? '4')
    const samples = await loadLoCoMoSamplesFromSnapDataset({ dataFile, maxSamples })
    const datasetHash = createLoCoMoDatasetHash(samples)

    const allCases = await loadOrDeriveLoCoMoCases({
      cache: context.cache,
      datasetHash,
      derive: async () => deriveLoCoMoCases(samples),
      schemaVersion: LOCOMO_CASES_SCHEMA_VERSION,
    })
    const cases = allCases.slice(0, maxCases)

    if (cases.length === 0) {
      throw new Error('Missing LoCoMo cases for evaluation.')
    }

    const retriever = createLobeHubRetrieverAdapter()
    const generator = createXsaiLoCoMoAnswerGenerator()
    const evaluation = await evaluateLoCoMoCases({
      cases,
      concurrency,
      generator,
      retriever,
      topK,
    })
    if (evaluation.summary.totalCases !== cases.length) {
      throw new Error('LoCoMo evaluation summary count mismatch.')
    }
    if (evaluation.summary.overallAverageScore < 0 || evaluation.summary.overallAverageScore > 1) {
      throw new Error('LoCoMo overall score is out of valid range 0..1.')
    }

    context.score(evaluation.summary.overallAverageScore)
    context.metric('locomo.overallAverageScore', evaluation.summary.overallAverageScore)
    context.metric('locomo.totalCases', evaluation.summary.totalCases)
    for (const category of [1, 2, 3, 4, 5] as const) {
      const categorySummary = evaluation.summary.byCategory[category]
      context.metric(`locomo.byCategory.${category}.averageScore`, categorySummary.averageScore)
      context.metric(`locomo.byCategory.${category}.count`, categorySummary.count)
    }
  }, {})
})
