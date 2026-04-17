const ARTICLES = new Set(['a', 'an', 'and', 'the'])

/**
 * Normalizes answer text before token-level F1 scoring.
 *
 * Before:
 * - "The, Big Apple!"
 *
 * After:
 * - "big apple"
 */
export function normalizeLoCoMoAnswer(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 0 && !ARTICLES.has(token))
    .join(' ')
}

/**
 * Computes token-level F1 for two LoCoMo answer strings.
 */
export function tokenF1(prediction: string, groundTruth: string): number {
  const predictionTokens = normalizeLoCoMoAnswer(prediction).split(' ').filter(Boolean)
  const goldTokens = normalizeLoCoMoAnswer(groundTruth).split(' ').filter(Boolean)

  if (predictionTokens.length === 0 && goldTokens.length === 0) {
    return 1
  }

  if (predictionTokens.length === 0 || goldTokens.length === 0) {
    return 0
  }

  const goldTokenCounts = new Map<string, number>()
  for (const token of goldTokens) {
    goldTokenCounts.set(token, (goldTokenCounts.get(token) ?? 0) + 1)
  }

  let overlap = 0
  for (const token of predictionTokens) {
    const count = goldTokenCounts.get(token) ?? 0
    if (count > 0) {
      overlap += 1
      goldTokenCounts.set(token, count - 1)
    }
  }

  if (overlap === 0) {
    return 0
  }

  const precision = overlap / predictionTokens.length
  const recall = overlap / goldTokens.length
  return (2 * precision * recall) / (precision + recall)
}
