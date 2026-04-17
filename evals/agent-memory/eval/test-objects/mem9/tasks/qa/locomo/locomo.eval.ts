import type { LoCoMoSample } from '@vieval/eval-agent-memory'

import process from 'node:process'

import { deriveLoCoMoCases, loadOrDeriveLoCoMoCases, LOCOMO_CASES_SCHEMA_VERSION, scoreLoCoMoAnswer } from '@vieval/eval-agent-memory'
import { caseOf, describeTask } from 'vieval'

import { createOpenAICompatibleAnswerGenerator } from '../../../src/adapters/answer-generator'
import { createMem9RetrieverAdapter } from '../../../src/adapters/retriever'

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

describeTask('locomo-mem9', () => {
  caseOf('cache-and-score-shape', async (context) => {
    const cases = await loadOrDeriveLoCoMoCases({
      cache: context.cache,
      datasetHash: 'fixture-locomo-mem9',
      derive: async () => deriveLoCoMoCases(fixtureDataset),
      schemaVersion: LOCOMO_CASES_SCHEMA_VERSION,
    })

    const singleCase = cases[0]
    if (singleCase == null) {
      throw new Error('Missing LoCoMo fixture case.')
    }

    const retriever = createMem9RetrieverAdapter({
      tenantId: process.env.MEM9_TENANT_ID ?? 'benchmark-locomo',
    })
    const generator = createOpenAICompatibleAnswerGenerator()

    const retrieval = await retriever.retrieveContext({
      question: singleCase.question,
      sampleId: singleCase.sampleId,
      topK: 10,
    })
    const prediction = await generator.generateAnswer({
      category: singleCase.category,
      contextText: retrieval.contextText,
      question: singleCase.question,
    })

    const score = scoreLoCoMoAnswer({
      category: singleCase.category,
      goldAnswer: singleCase.goldAnswer,
      prediction,
    })

    if (score < 0 || score > 1) {
      throw new Error('LoCoMo score is out of valid range 0..1.')
    }
  }, {})
})
