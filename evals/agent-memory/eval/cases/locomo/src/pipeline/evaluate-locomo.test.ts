import type { LoCoMoAnswerGeneratorAdapter, LoCoMoRetrieverAdapter } from '../contracts'
import type { LoCoMoCase } from '../types'

import { describe, expect, it } from 'vitest'

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
        }
      },
    }

    const generator: LoCoMoAnswerGeneratorAdapter = {
      id: 'generator-test',
      async generateAnswer(input) {
        if (input.category === 2) {
          return '2022'
        }
        if (input.category === 5) {
          return '(b)'
        }
        return 'adoption agencies'
      },
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

    expect(records).toHaveLength(3)
    expect(records[0]?.caseId).toBe('sample-1::1')
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
})
