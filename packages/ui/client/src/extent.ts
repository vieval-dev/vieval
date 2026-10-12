/**
 * Smallest and largest value of a list in one pass.
 *
 * Use when:
 * - a chart or time axis needs the range of a list that can be long (every point of a metric, every span of a run)
 *
 * Expects:
 * - numbers; `NaN` is skipped
 *
 * Returns:
 * - `{ min, max }`; an empty list gives `{ min: Infinity, max: -Infinity }`, the same as `Math.min()` / `Math.max()`
 *
 * NOTICE:
 * `Math.min(...values)` passes every value as an argument and throws `RangeError` once the list exceeds the engine's
 * argument limit (about 10^5 values), which a long live run reaches.
 */
export function extent(values: Iterable<number>): { max: number, min: number } {
  let min = Infinity
  let max = -Infinity
  for (const value of values) {
    if (value < min)
      min = value
    if (value > max)
      max = value
  }
  return { max, min }
}
