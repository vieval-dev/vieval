import type { LoCoMoSample } from '@vieval/eval-agent-memory'

import { deriveLoCoMoCases, loadOrDeriveLoCoMoCases, LOCOMO_CASES_SCHEMA_VERSION, scoreLoCoMoAnswer } from '@vieval/eval-agent-memory'
import { caseOf, describeTask } from 'vieval'

import { createLobeHubRetrieverAdapter } from '../../../src/adapters/retriever'

const fixtureDataset: LoCoMoSample[] = [
  {
    qa: [
      {
        adversarialAnswer: null,
        answer: 'tokyo',
        category: 2,
        evidence: ['D1:3'],
        question: 'Where did Alice move?',
      },
    ],
    sampleId: 'sample-1',
  },
]

describeTask('locomo-lobehub', () => {
  caseOf('cache-and-retrieval-shape', async (context) => {
    const cases = await loadOrDeriveLoCoMoCases({
      cache: context.cache,
      datasetHash: 'fixture-locomo-lobehub',
      derive: async () => deriveLoCoMoCases(fixtureDataset),
      schemaVersion: LOCOMO_CASES_SCHEMA_VERSION,
    })

    const singleCase = cases[0]
    if (singleCase == null) {
      throw new Error('Missing LoCoMo fixture case.')
    }

    const retriever = createLobeHubRetrieverAdapter()
    const retrieval = await retriever.retrieveContext({
      question: singleCase.question,
      sampleId: singleCase.sampleId,
      topK: 10,
    })

    const score = scoreLoCoMoAnswer({
      category: singleCase.category,
      goldAnswer: singleCase.goldAnswer,
      prediction: retrieval.contextText,
    })

    if (score < 0 || score > 1) {
      throw new Error('LoCoMo score is out of valid range 0..1.')
    }
  }, {})
})
