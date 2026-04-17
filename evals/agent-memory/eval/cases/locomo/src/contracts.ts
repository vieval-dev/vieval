import type { LoCoMoCategory } from './types.ts'

export interface LoCoMoRetrieverAdapter {
  id: string
  retrieveContext: (input: {
    question: string
    sampleId: string
    topK: number
  }) => Promise<{
    contextIds?: string[]
    contextText: string
  }>
}

export interface LoCoMoAnswerGeneratorAdapter {
  id: string
  generateAnswer: (input: {
    caseId: string
    category: LoCoMoCategory
    contextText: string
    goldAnswer: string
    question: string
    sampleId: string
  }) => Promise<string>
}

export interface LoCoMoJudgeAdapter {
  id: string
  judgeAnswer: (input: {
    goldAnswer: string
    prediction: string
    question: string
  }) => Promise<0 | 1>
}
