import type { LoCoMoAnswerGeneratorAdapter, LoCoMoRetrieverAdapter, LoCoMoScorerAdapter } from '../contracts'
import type { LoCoMoCase } from '../types'

import { describe, expect, it, vi } from 'vitest'

import { evaluateLoCoMoCases } from './evaluate-locomo'

describe('evaluateLoCoMoCases', () => {
  it('evaluates cases with bounded concurrency and returns category aggregates', async () => {
    const cases: LoCoMoCase[] = [
      {
        caseId: 'sample-1::1',
        category: 2,
        evidence: ['D1:1'],
        goldAnswer: '2022',
        question: 'When did Alice move to Tokyo?',
        sampleId: 'sample-1',
      },
      {
        caseId: 'sample-1::2',
        category: 5,
        evidence: [],
        goldAnswer: 'Tokyo',
        question: 'Where did Bob move?',
        sampleId: 'sample-1',
      },
      {
        caseId: 'sample-1::3',
        category: 1,
        evidence: ['D2:3'],
        goldAnswer: 'adoption agencies',
        question: 'What did Caroline research?',
        sampleId: 'sample-1',
      },
    ]

    let runningJobs = 0
    let maxRunningJobs = 0

    const retriever: LoCoMoRetrieverAdapter = {
      id: 'retriever-test',
      async retrieveContext(input) {
        runningJobs += 1
        maxRunningJobs = Math.max(maxRunningJobs, runningJobs)
        await new Promise(resolve => setTimeout(resolve, 5))
        runningJobs -= 1
        return {
          contextIds: [`ctx:${input.sampleId}`],
          contextText: `Memory for ${input.question}`,
          diagnostics: {
            itemCount: 1,
            joinedMemoryCount: 1,
            retrievedContextCount: 1,
            retrievedLayerCounts: {
              contexts: 1,
            },
            searchedLayerCounts: {
              contexts: 1,
            },
          },
        }
      },
    }

    const generateAnswer = vi.fn(async (input: Parameters<LoCoMoAnswerGeneratorAdapter['generateAnswer']>[0]) => {
      if (input.category === 2) {
        return '2022'
      }
      if (input.category === 5) {
        return '(b)'
      }
      return 'adoption agencies'
    })
    const generator: LoCoMoAnswerGeneratorAdapter = {
      generateAnswer,
      id: 'generator-test',
    }

    const { records, summary } = await evaluateLoCoMoCases({
      cases,
      concurrency: 2,
      generator,
      retriever,
      topK: 5,
    })

    expect(maxRunningJobs).toBeLessThanOrEqual(2)
    expect(maxRunningJobs).toBeGreaterThanOrEqual(1)
    expect(generateAnswer).toHaveBeenCalledWith({
      caseId: 'sample-1::1',
      category: 2,
      contextText: 'Memory for When did Alice move to Tokyo?',
      question: 'When did Alice move to Tokyo? Use DATE of CONVERSATION to answer with an approximate date.',
      sampleId: 'sample-1',
    })

    expect(records).toHaveLength(3)
    expect(records[0]?.caseId).toBe('sample-1::1')
    expect(records[0]?.retrievalDiagnostics).toEqual({
      itemCount: 1,
      joinedMemoryCount: 1,
      retrievedContextCount: 1,
      retrievedLayerCounts: {
        contexts: 1,
      },
      searchedLayerCounts: {
        contexts: 1,
      },
    })
    expect(records[0]?.score).toBe(1)

    const categoryFiveRecord = records.find(record => record.category === 5)
    const categoryFivePrediction = categoryFiveRecord?.prediction
    expect([
      'Not mentioned in the conversation',
      'Tokyo',
    ]).toContain(categoryFivePrediction)
    expect(categoryFiveRecord?.score).toBeGreaterThanOrEqual(0)
    expect(categoryFiveRecord?.score).toBeLessThanOrEqual(1)

    expect(summary.totalCases).toBe(3)
    expect(summary.byCategory[2].averageScore).toBe(1)
    expect(summary.byCategory[5].averageScore).toBe(categoryFiveRecord?.score ?? 0)
  })

  it('keeps the canonical score and records optional agent scorer diagnostics', async () => {
    const cases: LoCoMoCase[] = [
      {
        caseId: 'sample-1::cat3',
        category: 3,
        evidence: ['D1:1'],
        goldAnswer: 'Liberal',
        question: 'What would Caroline political leaning likely be?',
        sampleId: 'sample-1',
      },
    ]
    const retriever: LoCoMoRetrieverAdapter = {
      id: 'retriever-test',
      async retrieveContext() {
        return {
          contextIds: ['D1:1'],
          contextText: 'Caroline frequently stands up for equality and LGBTQ+ rights.',
        }
      },
    }
    const generator: LoCoMoAnswerGeneratorAdapter = {
      async generateAnswer() {
        return 'standing up for equality'
      },
      id: 'generator-test',
    }
    const scoreAnswer = vi.fn<LoCoMoScorerAdapter['scoreAnswer']>().mockResolvedValue({
      reasoning: 'The prediction states the same political leaning in descriptive words.',
      score: 1,
    })
    const scorer: LoCoMoScorerAdapter = {
      id: 'agent-scorer-test',
      scoreAnswer,
    }

    const { records } = await evaluateLoCoMoCases({
      cases,
      generator,
      retriever,
      scorer,
    })

    expect(records[0]?.score).toBe(0)
    expect(records[0]?.agentScore).toBe(1)
    expect(records[0]?.agentScoreReasoning).toBe('The prediction states the same political leaning in descriptive words.')
    expect(scoreAnswer).toHaveBeenCalledWith({
      category: 3,
      contextIds: ['D1:1'],
      contextText: 'Caroline frequently stands up for equality and LGBTQ+ rights.',
      goldAnswer: 'Liberal',
      prediction: 'standing up for equality',
      question: 'What would Caroline political leaning likely be?',
      sampleId: 'sample-1',
    })
  })

  it('omits agent scorer diagnostics when the scoped scorer skips a category', async () => {
    const cases: LoCoMoCase[] = [
      {
        caseId: 'sample-1::cat4',
        category: 4,
        evidence: ['D1:1'],
        goldAnswer: 'Oliver',
        question: 'What pet does Caroline have?',
        sampleId: 'sample-1',
      },
    ]
    const retriever: LoCoMoRetrieverAdapter = {
      id: 'retriever-test',
      async retrieveContext() {
        return {
          contextIds: ['D1:1'],
          contextText: 'Caroline has a pet named Oliver.',
        }
      },
    }
    const scorer: LoCoMoScorerAdapter = {
      id: 'scoped-agent-scorer-test',
      async scoreAnswer() {
        return { score: Number.NaN }
      },
    }

    const { records } = await evaluateLoCoMoCases({
      cases,
      generator: {
        async generateAnswer() {
          return 'Oliver'
        },
        id: 'generator-test',
      },
      retriever,
      scorer,
    })

    expect(records[0]?.score).toBe(1)
    expect(records[0]?.agentScore).toBeUndefined()
    expect(records[0]?.agentScoreReasoning).toBeUndefined()
  })
})

describe('evaluateLoCoMoCases agentAnswer mode', () => {
  it('passes the formatted category 2 question directly to the answer agent', async () => {
    const answerCase = vi.fn().mockResolvedValue({
      contextIds: ['D1:3'],
      diagnostics: {
        memorySearches: [{ contextIdCount: 1, contextIds: ['D1:3'] }],
        operationId: 'op-1',
        status: 'done',
        steps: 2,
      },
      prediction: 'May 2023',
    })

    const result = await evaluateLoCoMoCases({
      answerer: { answerCase, id: 'test-answerer' },
      cases: [{
        caseId: 'case-cat2',
        category: 2,
        evidence: [],
        goldAnswer: 'May 2023',
        question: 'When did Caroline visit Melanie?',
        sampleId: 'conv-1',
      }],
      mode: 'agentAnswer',
    })

    expect(answerCase).toHaveBeenCalledWith({
      caseId: 'case-cat2',
      category: 2,
      question: 'When did Caroline visit Melanie? Use DATE of CONVERSATION to answer with an approximate date.',
      rawQuestion: 'When did Caroline visit Melanie?',
      sampleId: 'conv-1',
    })
    expect(result.records[0]?.prediction).toBe('May 2023')
    expect(result.records[0]?.contextIds).toEqual(['D1:3'])
    expect(result.records[0]?.agentDiagnostics).toEqual({
      memorySearches: [{ contextIdCount: 1, contextIds: ['D1:3'] }],
      operationId: 'op-1',
      status: 'done',
      steps: 2,
    })
  })

  it('passes the formatted category 5 multiple-choice prompt directly to the answer agent', async () => {
    const answerCase = vi.fn().mockResolvedValue({
      prediction: 'a',
    })

    const result = await evaluateLoCoMoCases({
      answerer: { answerCase, id: 'test-answerer' },
      cases: [{
        caseId: 'even',
        category: 5,
        evidence: [],
        goldAnswer: 'Caroline prefers museums',
        question: 'Which option is supported?',
        sampleId: 'conv-1',
      }],
      mode: 'agentAnswer',
    })

    expect(answerCase).toHaveBeenCalledWith({
      caseId: 'even',
      category: 5,
      question: 'Which option is supported? Select the correct answer: (a) Not mentioned in the conversation (b) Caroline prefers museums.',
      rawQuestion: 'Which option is supported?',
      sampleId: 'conv-1',
    })
    expect(result.records[0]?.prediction).toBe('Not mentioned in the conversation')
  })
})
