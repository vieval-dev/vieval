import { describe, expect, it } from 'vitest'

import { scoreLoCoMoAnswer } from './score-locomo-answer'

describe('scoreLoCoMoAnswer', () => {
  it('scores category 5 as 1 only for no-information answers', () => {
    expect(scoreLoCoMoAnswer({
      category: 5,
      goldAnswer: 'irrelevant',
      prediction: 'No information available',
    })).toBe(1)

    expect(scoreLoCoMoAnswer({
      category: 5,
      goldAnswer: 'irrelevant',
      prediction: 'I think the answer is tokyo',
    })).toBe(0)
  })

  it('scores category 1 via averaged sub-answer token-f1', () => {
    const score = scoreLoCoMoAnswer({
      category: 1,
      goldAnswer: 'new york, san francisco',
      prediction: 'new york',
    })

    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  it('matches snap locomo category-1 multi-answer matching by splitting predictions too', () => {
    const score = scoreLoCoMoAnswer({
      category: 1,
      goldAnswer: 'Psychology, counseling certification',
      prediction: 'Psychology, counseling',
    })

    expect(score).toBeCloseTo(0.833333, 4)
  })

  it('scores category 3 by matching against the first semicolon-delimited span', () => {
    const score = scoreLoCoMoAnswer({
      category: 3,
      goldAnswer: 'june 12, 2020; accepted alternate formats',
      prediction: 'june 12 2020',
    })

    expect(score).toBe(1)
  })

  it('uses stemmed token matching like snap locomo scorer', () => {
    const score = scoreLoCoMoAnswer({
      category: 4,
      goldAnswer: 'run',
      prediction: 'running',
    })

    expect(score).toBe(1)
  })
})
