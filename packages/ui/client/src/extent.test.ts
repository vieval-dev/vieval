import { describe, expect, it } from 'vitest'

import { extent } from './extent'

describe('extent', () => {
  /**
   * @example
   * expect(extent(values)).toEqual({ max: 299_999, min: 0 })
   */
  it('handles lists longer than the engine argument limit', () => {
    // ROOT CAUSE:
    //
    // Charts and time axes took `Math.min(...values)` / `Math.max(...values)` over every point or span of a run.
    // Spreading a long list passes each value as an argument, which throws `RangeError: Maximum call stack size
    // exceeded` once the list exceeds the engine's argument limit.
    //
    // We fixed this by reading the range in one loop (`extent`).
    const values = Array.from({ length: 300_000 }, (_, index) => index)

    expect(() => Math.max(...values)).toThrow(RangeError)
    expect(extent(values)).toEqual({ max: 299_999, min: 0 })
  })

  /**
   * @example
   * expect(extent([])).toEqual({ max: -Infinity, min: Infinity })
   */
  it('keeps the Math.min() / Math.max() result for an empty list', () => {
    expect(extent([])).toEqual({ max: -Infinity, min: Infinity })
  })
})
