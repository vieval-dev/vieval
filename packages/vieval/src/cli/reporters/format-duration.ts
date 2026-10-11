import { formatDuration as formatDateFnsDuration, intervalToDuration } from 'date-fns'

/**
 * Normalizes a millisecond duration into the label used by CLI reporters.
 *
 * Before:
 * - 420
 * - 2_800
 * - 3_725_000
 *
 * After:
 * - "420ms"
 * - "2 seconds"
 * - "1 hour 2 minutes 5 seconds"
 */
export function formatHumanDuration(durationMs: number): string {
  if (durationMs < 1_000) {
    return `${Math.round(durationMs)}ms`
  }

  const formatted = formatDateFnsDuration(intervalToDuration({
    end: durationMs,
    start: 0,
  }), {
    delimiter: ' ',
    format: ['hours', 'minutes', 'seconds'],
    zero: false,
  })

  return formatted.length > 0 ? formatted : '0 seconds'
}
