import type { LogLine, LogsResponse } from './contract'

/**
 * Filters recorded console lines and returns one page in recording order.
 *
 * Use when:
 * - the Viewer reads a run's logs from its reducer or a published report
 *
 * Returns:
 * - the lines, the filtered total, and the offset of the next page if available
 */
export function buildLogs(lines: readonly LogLine[], query: { caseId?: string, limit: number, offset: number, round?: number, stream?: string, taskId?: string }): LogsResponse {
  const matched = lines.filter(line =>
    (query.taskId == null || line.taskId === query.taskId)
    && (query.caseId == null || line.caseId === query.caseId)
    && (query.stream == null || line.stream === query.stream)
    && (query.round == null || line.roundIndex === query.round))
  const page = matched.slice(query.offset, query.offset + query.limit)
  const nextOffset = query.offset + page.length
  return { lines: page, nextOffset: nextOffset < matched.length ? nextOffset : null, total: matched.length }
}
