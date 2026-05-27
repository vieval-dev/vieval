import type { LoCoMoAnswerAgentAdapter, LoCoMoAnswerAgentDiagnostics, LoCoMoAnswerGeneratorAdapter, LoCoMoRetrievalDiagnostics, LoCoMoRetrieverAdapter, LoCoMoScorerAdapter } from '../contracts.ts'
import type { LoCoMoCase, LoCoMoCategory } from '../types.ts'

import { scoreLoCoMoAnswer } from '../scoring/score-locomo-answer.ts'

export interface LoCoMoEvaluationRecord {
  caseId: string
  category: LoCoMoCategory
  contextIds: string[]
  goldAnswer: string
  agentScore?: number
  agentScoreReasoning?: string
  prediction: string
  question: string
  agentDiagnostics?: LoCoMoAnswerAgentDiagnostics
  retrievalDiagnostics?: LoCoMoRetrievalDiagnostics
  sampleId: string
  score: number
}

export interface LoCoMoEvaluationSummary {
  byCategory: Record<LoCoMoCategory, { averageScore: number, count: number }>
  overallAverageScore: number
  totalCases: number
}

interface LoCoMoAgentAnswerEvaluationArgs {
  answerer: LoCoMoAnswerAgentAdapter
  cases: readonly LoCoMoCase[]
  concurrency?: number
  mode: 'agentAnswer'
  scorer?: LoCoMoScorerAdapter
}

interface LoCoMoRetrievalGenerationEvaluationArgs {
  cases: readonly LoCoMoCase[]
  concurrency?: number
  generator: LoCoMoAnswerGeneratorAdapter
  mode?: 'retrievalGeneration'
  retriever: LoCoMoRetrieverAdapter
  scorer?: LoCoMoScorerAdapter
  topK?: number
}

type LoCoMoEvaluationArgs
  = | LoCoMoAgentAnswerEvaluationArgs
    | LoCoMoRetrievalGenerationEvaluationArgs

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

function normalizeAgentScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0
  }

  return Math.min(1, Math.max(0, score))
}

async function scoreLoCoMoRecordWithAgent(args: {
  caseItem: LoCoMoCase
  contextIds?: string[]
  contextText?: string
  prediction: string
  scorer?: LoCoMoScorerAdapter
}): Promise<{ agentScore?: number, agentScoreReasoning?: string }> {
  if (args.scorer == null) {
    return {}
  }

  const result = await args.scorer.scoreAnswer({
    category: args.caseItem.category,
    contextIds: args.contextIds,
    contextText: args.contextText,
    goldAnswer: args.caseItem.goldAnswer,
    prediction: args.prediction,
    question: args.caseItem.question,
    sampleId: args.caseItem.sampleId,
  })
  if (!Number.isFinite(result.score)) {
    return {}
  }

  return {
    agentScore: normalizeAgentScore(result.score),
    agentScoreReasoning: result.reasoning,
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
export async function evaluateLoCoMoCases(
  args: LoCoMoEvaluationArgs,
): Promise<{ records: LoCoMoEvaluationRecord[], summary: LoCoMoEvaluationSummary }> {
  const concurrency = Math.max(1, args.concurrency ?? 4)
  const topK = 'retriever' in args ? Math.max(1, args.topK ?? 10) : undefined
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

      const generationQuestion = buildGenerationQuestion({
        caseId: caseItem.caseId,
        category: caseItem.category,
        goldAnswer: caseItem.goldAnswer,
        question: caseItem.question,
      })

      if ('answerer' in args) {
        const answer = await args.answerer.answerCase({
          caseId: caseItem.caseId,
          category: caseItem.category,
          question: generationQuestion.question,
          rawQuestion: caseItem.question,
          sampleId: caseItem.sampleId,
        })
        const prediction = generationQuestion.answerKey == null ? answer.prediction : resolveCategory5Prediction(answer.prediction, generationQuestion.answerKey)

        const score = scoreLoCoMoAnswer({
          category: caseItem.category,
          goldAnswer: caseItem.goldAnswer,
          prediction,
        })
        const agentScore = await scoreLoCoMoRecordWithAgent({
          caseItem,
          contextIds: answer.contextIds ?? [],
          prediction,
          scorer: args.scorer,
        })

        records.push({
          agentDiagnostics: answer.diagnostics,
          caseId: caseItem.caseId,
          category: caseItem.category,
          contextIds: answer.contextIds ?? [],
          goldAnswer: caseItem.goldAnswer,
          ...agentScore,
          prediction,
          question: caseItem.question,
          sampleId: caseItem.sampleId,
          score,
        })
        continue
      }

      const retrieval = await args.retriever.retrieveContext({
        question: caseItem.question,
        sampleId: caseItem.sampleId,
        topK: topK ?? 10,
      })

      const rawPrediction = await args.generator.generateAnswer({
        caseId: caseItem.caseId,
        category: caseItem.category,
        contextText: retrieval.contextText,
        question: generationQuestion.question,
        sampleId: caseItem.sampleId,
      })
      const prediction = generationQuestion.answerKey == null ? rawPrediction : resolveCategory5Prediction(rawPrediction, generationQuestion.answerKey)

      const score = scoreLoCoMoAnswer({
        category: caseItem.category,
        goldAnswer: caseItem.goldAnswer,
        prediction,
      })
      const agentScore = await scoreLoCoMoRecordWithAgent({
        caseItem,
        contextIds: retrieval.contextIds ?? [],
        contextText: retrieval.contextText,
        prediction,
        scorer: args.scorer,
      })

      records.push({
        caseId: caseItem.caseId,
        category: caseItem.category,
        contextIds: retrieval.contextIds ?? [],
        goldAnswer: caseItem.goldAnswer,
        ...agentScore,
        prediction,
        question: caseItem.question,
        retrievalDiagnostics: retrieval.diagnostics,
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
