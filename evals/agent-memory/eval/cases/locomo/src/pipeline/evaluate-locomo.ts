import type { LoCoMoAnswerGeneratorAdapter, LoCoMoRetrieverAdapter } from '../contracts.ts'
import type { LoCoMoCase, LoCoMoCategory } from '../types.ts'

import { scoreLoCoMoAnswer } from '../scoring/score-locomo-answer.ts'

export interface LoCoMoEvaluationRecord {
  caseId: string
  category: LoCoMoCategory
  contextIds: string[]
  goldAnswer: string
  prediction: string
  question: string
  sampleId: string
  score: number
}

export interface LoCoMoEvaluationSummary {
  byCategory: Record<LoCoMoCategory, { averageScore: number, count: number }>
  overallAverageScore: number
  totalCases: number
}

interface Category5AnswerKey {
  a: string
  b: string
}

function shouldPutNoInformationFirst(caseId: string): boolean {
  let sum = 0
  for (let index = 0; index < caseId.length; index += 1) {
    sum += caseId.charCodeAt(index)
  }
  return sum % 2 === 0
}

function buildGenerationQuestion(input: {
  caseId: string
  category: LoCoMoCategory
  goldAnswer: string
  question: string
}): { answerKey?: Category5AnswerKey, question: string } {
  if (input.category === 2) {
    // Python parity:
    // Matches category-2 prompt suffix in
    // `snap-research/locomo/task_eval/gpt_utils.py:243-245`
    // (also mirrored in `claude_utils.py:151-153`, `gemini_utils.py:164-166`).
    return {
      question: `${input.question} Use DATE of CONVERSATION to answer with an approximate date.`,
    }
  }

  if (input.category === 5) {
    const noInformation = 'Not mentioned in the conversation'
    // Python parity:
    // Snap randomizes option order for category-5 MC prompts in
    // `task_eval/gpt_utils.py:246-253` (and equivalent claude/gemini utils).
    // We use deterministic caseId-based ordering for run-to-run reproducibility.
    if (shouldPutNoInformationFirst(input.caseId)) {
      return {
        answerKey: {
          a: noInformation,
          b: input.goldAnswer,
        },
        question: `${input.question} Select the correct answer: (a) ${noInformation} (b) ${input.goldAnswer}.`,
      }
    }

    return {
      answerKey: {
        a: input.goldAnswer,
        b: noInformation,
      },
      question: `${input.question} Select the correct answer: (a) ${input.goldAnswer} (b) ${noInformation}.`,
    }
  }

  return { question: input.question }
}

function resolveCategory5Prediction(prediction: string, answerKey: Category5AnswerKey): string {
  // Python parity:
  // Equivalent to `get_cat_5_answer(...)` in
  // `snap-research/locomo/task_eval/gpt_utils.py:128-143`
  // (same logic in `claude_utils.py:64-79`, `gemini_utils.py:74-89`).
  const normalized = prediction.trim().toLowerCase()
  if (normalized === 'a' || normalized === '(a)') {
    return answerKey.a
  }
  if (normalized === 'b' || normalized === '(b)') {
    return answerKey.b
  }

  return prediction
}

function roundScore(value: number): number {
  return Math.round(value * 10000) / 10000
}

function summarizeLoCoMoRecords(records: readonly LoCoMoEvaluationRecord[]): LoCoMoEvaluationSummary {
  const initialByCategory: Record<LoCoMoCategory, { averageScore: number, count: number }> = {
    1: { averageScore: 0, count: 0 },
    2: { averageScore: 0, count: 0 },
    3: { averageScore: 0, count: 0 },
    4: { averageScore: 0, count: 0 },
    5: { averageScore: 0, count: 0 },
  }

  const scoreSumByCategory: Record<LoCoMoCategory, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  }

  let totalScore = 0
  for (const record of records) {
    initialByCategory[record.category].count += 1
    scoreSumByCategory[record.category] += record.score
    totalScore += record.score
  }

  for (const category of [1, 2, 3, 4, 5] as const) {
    const count = initialByCategory[category].count
    initialByCategory[category].averageScore = count === 0 ? 0 : roundScore(scoreSumByCategory[category] / count)
  }

  return {
    // Python parity:
    // Same category-wise and overall averaging shape as aggregate report in
    // `snap-research/locomo/task_eval/evaluation_stats.py:94-109`.
    byCategory: initialByCategory,
    overallAverageScore: records.length === 0 ? 0 : roundScore(totalScore / records.length),
    totalCases: records.length,
  }
}

/**
 * Runs LoCoMo retrieval + generation + scoring with bounded concurrency.
 *
 * Call stack:
 *
 * evaluateLoCoMoCases (this module)
 *   -> {@link LoCoMoRetrieverAdapter.retrieveContext}
 *   -> {@link LoCoMoAnswerGeneratorAdapter.generateAnswer}
 *   -> {@link scoreLoCoMoAnswer}
 */
export async function evaluateLoCoMoCases(args: {
  cases: readonly LoCoMoCase[]
  concurrency?: number
  generator: LoCoMoAnswerGeneratorAdapter
  retriever: LoCoMoRetrieverAdapter
  topK?: number
}): Promise<{ records: LoCoMoEvaluationRecord[], summary: LoCoMoEvaluationSummary }> {
  const concurrency = Math.max(1, args.concurrency ?? 4)
  const topK = Math.max(1, args.topK ?? 10)
  const records: LoCoMoEvaluationRecord[] = []
  let cursor = 0

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= args.cases.length) {
        return
      }

      const caseItem = args.cases[index]
      if (caseItem == null) {
        return
      }

      const retrieval = await args.retriever.retrieveContext({
        question: caseItem.question,
        sampleId: caseItem.sampleId,
        topK,
      })

      const generationQuestion = buildGenerationQuestion({
        caseId: caseItem.caseId,
        category: caseItem.category,
        goldAnswer: caseItem.goldAnswer,
        question: caseItem.question,
      })

      const rawPrediction = await args.generator.generateAnswer({
        caseId: caseItem.caseId,
        category: caseItem.category,
        contextText: retrieval.contextText,
        goldAnswer: caseItem.goldAnswer,
        question: generationQuestion.question,
        sampleId: caseItem.sampleId,
      })
      const prediction = generationQuestion.answerKey == null ? rawPrediction : resolveCategory5Prediction(rawPrediction, generationQuestion.answerKey)

      const score = scoreLoCoMoAnswer({
        category: caseItem.category,
        goldAnswer: caseItem.goldAnswer,
        prediction,
      })

      records.push({
        caseId: caseItem.caseId,
        category: caseItem.category,
        contextIds: retrieval.contextIds ?? [],
        goldAnswer: caseItem.goldAnswer,
        prediction,
        question: caseItem.question,
        sampleId: caseItem.sampleId,
        score,
      })
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, args.cases.length) }, async () => await worker()))
  const sortedRecords = [...records].sort((left, right) => left.caseId.localeCompare(right.caseId))

  return {
    records: sortedRecords,
    summary: summarizeLoCoMoRecords(sortedRecords),
  }
}
