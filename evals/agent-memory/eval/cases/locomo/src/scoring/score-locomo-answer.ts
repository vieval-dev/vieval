import type { LoCoMoCategory } from '../types'

import { tokenF1 } from './token-f1'

function scoreCategory1(prediction: string, goldAnswer: string): number {
  const subAnswers = goldAnswer.split(',').map(value => value.trim()).filter(Boolean)
  if (subAnswers.length === 0) {
    return 0
  }

  const scores = subAnswers.map(answer => tokenF1(prediction, answer))
  return scores.reduce((total, score) => total + score, 0) / scores.length
}

function scoreCategory3(prediction: string, goldAnswer: string): number {
  const firstSpan = goldAnswer.split(';')[0]?.trim() ?? goldAnswer
  return tokenF1(prediction, firstSpan)
}

function scoreCategory5(prediction: string): number {
  const normalized = prediction.toLowerCase()
  return normalized.includes('no information') || normalized.includes('not mentioned') ? 1 : 0
}

/**
 * Scores a LoCoMo answer using canonical per-category logic.
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
