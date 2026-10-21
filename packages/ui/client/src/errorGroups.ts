import type { CaseNode, TaskNode } from '../../src/shared/contract'

import { i18n } from './i18n'

/**
 * Cases without a result that ended with the same error.
 */
export interface ErrorGroup {
  /** Cases in the group. */
  count: number
  /** `name` of the error (`APICallError`, `TypeError`, …) when the run recorded it. */
  errorName?: string
  /** One case of the group, to open its details. */
  example: Pick<CaseNode, 'caseId' | 'name' | 'taskId'>
  /** Stable key of the group: the error name and the normalized message. */
  key: string
  /** The normalized message shared by the group. */
  message: string
}

/** Longest message kept for grouping and display; provider errors append whole response bodies. */
const MAX_MESSAGE_LENGTH = 160

/**
 * Groups the cases of a run that produced no result (`errored`, `timeout`, `unfinished`) by their error.
 *
 * Use when:
 * - a run shows many cases without a result and the reader needs to see which failures caused them, for example
 *   provider rate limits versus dropped connections
 *
 * Expects:
 * - task nodes of one run snapshot; each case contributes its final state and error
 *
 * Returns:
 * - groups by error name and normalized message, largest first, then by message; a case without a message is grouped
 *   under a note in the viewer's language (reactive in the locale inside a `computed`)
 */
export function groupErrors(tasks: readonly Pick<TaskNode, 'cases'>[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>()
  for (const node of tasks.flatMap(task => task.cases)) {
    if (node.state !== 'errored' && node.state !== 'timeout' && node.state !== 'unfinished') {
      continue
    }

    const message = node.errorMessage == null
      ? i18n.global.t(node.state === 'unfinished' ? 'runs.errors.unfinished' : 'runs.errors.noMessage')
      : normalizeErrorMessage(node.errorMessage)
    const key = `${node.errorName ?? ''}\u0000${message}`
    const group = groups.get(key)
    if (group == null) {
      groups.set(key, { count: 1, errorName: node.errorName, example: { caseId: node.caseId, name: node.name, taskId: node.taskId }, key, message })
      continue
    }
    group.count += 1
  }

  return [...groups.values()].sort((left, right) => right.count - left.count || left.message.localeCompare(right.message))
}

/**
 * Normalizes an error message so that the same failure of different cases groups together.
 *
 * Keeps the first line, replaces long numbers and hexadecimal ids (request ids, timestamps) with `#`, and cuts the
 * rest. Short numbers such as HTTP status codes stay, so a 429 and a 502 remain apart.
 *
 * Before:
 * - "listener gpt-6-luna: Remote sent 429 response: {\"request_id\":\"9f2c4e11ab03d7e5\",\"ts\":1792391786006}"
 * - "ASR whisper-1: fetch failed\n    at node:internal/deps/undici"
 *
 * After:
 * - "listener gpt-6-luna: Remote sent 429 response: {\"request_id\":\"#\",\"ts\":#}"
 * - "ASR whisper-1: fetch failed"
 */
export function normalizeErrorMessage(message: string): string {
  const firstLine = message.split('\n', 1)[0]!.trim()
  const normalized = firstLine
    .replace(/\b[0-9a-f]{16,}\b/gi, '#')
    .replace(/\d{5,}/g, '#')
  return normalized.length > MAX_MESSAGE_LENGTH ? `${normalized.slice(0, MAX_MESSAGE_LENGTH)}…` : normalized
}
