import type { LoCoMoCategory } from '../types.ts'

import { tokenF1 } from './token-f1.ts'

function scoreCategory1(prediction: string, goldAnswer: string): number {
  // Python parity:
  // Equivalent to multi-answer `f1(...)` in
  // `snap-research/locomo/task_eval/evaluation.py:141-145`.
  const predictionParts = prediction.split(',').map(value => value.trim()).filter(Boolean)
  const goldParts = goldAnswer.split(',').map(value => value.trim()).filter(Boolean)
  if (goldParts.length === 0) {
    return 0
  }

  const scores = goldParts.map(answer => Math.max(...predictionParts.map(predictionPart => tokenF1(predictionPart, answer)), 0))
  return scores.reduce((total, score) => total + score, 0) / scores.length
}

function scoreCategory3(prediction: string, goldAnswer: string): number {
  // Python parity:
  // Category 3 keeps only the first semicolon span before F1 in
  // `snap-research/locomo/task_eval/evaluation.py:203-205`.
  const firstSpan = goldAnswer.split(';')[0]?.trim() ?? goldAnswer
  return tokenF1(prediction, firstSpan)
}

function scoreCategory5(prediction: string): number {
  // Python parity:
  // Equivalent adversarial check in
  // `snap-research/locomo/task_eval/evaluation.py:217-221`.
  const normalized = prediction.toLowerCase()
  return normalized.includes('no information') || normalized.includes('not mentioned') ? 1 : 0
}

/**
 * Scores a LoCoMo answer using canonical per-category logic.
 *
 * Python parity:
 * - Category routing matches `eval_question_answering(...)` in
 *   `snap-research/locomo/task_eval/evaluation.py:203-221`.
 */
export function scoreLoCoMoAnswer(args: {
  category: LoCoMoCategory
  goldAnswer: number | string
  prediction: string
}): number {
  const gold = String(args.goldAnswer)

  switch (args.category) {
    case 1:
      return scoreCategory1(args.prediction, gold)
    case 2:
    case 4:
      return tokenF1(args.prediction, gold)
    case 3:
      return scoreCategory3(args.prediction, gold)
    case 5:
      return scoreCategory5(args.prediction)
  }
}
