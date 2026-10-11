import type { CaseOutputStream } from '../../core/runner/case-output'
import type { CliReporterCaseEndPayload, CliReporterCaseOutputPayload, CliReporterCaseState } from './types'

import { stripVTControlCharacters } from 'node:util'

// NOTICE:
// Grapheme-aware width is needed to truncate output lines containing CJK or emoji to one terminal row.
// `fast-string-width` is the enforced replacement for `string-width` in this repository.
import stringWidth from 'fast-string-width'
import c from 'tinyrainbow'

import { formatHumanDuration } from './format-duration'

// NOTICE:
// Block layout follows pnpm's TTY lifecycle script reporter (`renderScriptOutput`): a header line,
// `│ `-prefixed output, `[N lines collapsed]` above the last 10 lines of a passed script, the full output
// of a failed script, and a `└─ Done in ...` / `└─ Failed in ...` status line.
// Source: https://github.com/pnpm/pnpm/blob/main/pnpm11/cli/default-reporter/src/reporterForClient/reportLifecycleScripts.ts

/**
 * Number of trailing output lines kept visible for a passed case, matching pnpm.
 */
export const CASE_OUTPUT_VISIBLE_LINES = 10

const SEGMENTER = new Intl.Segmenter()

/**
 * Inputs for {@link formatCaseOutputBlock}.
 */
export interface CaseOutputBlockOptions {
  /**
   * Keeps only the last {@link CASE_OUTPUT_VISIBLE_LINES} lines of a passed case.
   */
  collapse: boolean
  /**
   * Enables ANSI colors.
   */
  colors: boolean
  /**
   * Wall time the case ran for.
   */
  durationMs: number
  /**
   * Failure message shown on the status line of failed and timed-out cases.
   */
  errorMessage?: string
  /**
   * Header line naming the case, for example `|project| task > case`.
   */
  header: string
  /**
   * Captured output lines.
   */
  lines: readonly CaseOutputLine[]
  /**
   * Terminal case state, or `stopped` when the task ended before the case reported its result.
   */
  state: 'stopped' | CliReporterCaseState
}

/**
 * Buffers case output for reporters without a live window and prints one block per case.
 */
export interface CaseOutputCollector {
  /**
   * Prints blocks of cases that never ended, for example after an interrupted run.
   */
  flush: () => void
  onCaseEnd: (payload: CliReporterCaseEndPayload) => void
  onCaseOutput: (payload: CliReporterCaseOutputPayload) => void
  onCaseStart: (payload: { caseId: string, caseName?: string, taskId: string }) => void
  onTaskQueued: (payload: { displayName?: string, projectName?: string, taskId: string }) => void
}

/**
 * Options for {@link createCaseOutputCollector}.
 */
export interface CaseOutputCollectorOptions {
  /**
   * Returns milliseconds from a monotonic or deterministic clock.
   */
  getNow: () => number
  /**
   * Writes one finished case block.
   */
  write: (value: string) => void
}

/**
 * One complete output line written by a case.
 */
export interface CaseOutputLine {
  stream: CaseOutputStream
  text: string
}

interface CollectedCase {
  caseName: string
  output: CaseOutputLines
  startedAt: number
  taskId: string
}

/**
 * Accumulates raw stream chunks of one case into terminal-safe lines.
 *
 * Use when:
 * - a reporter needs whole lines from chunked `process.stdout` / `process.stderr` writes
 *
 * Expects:
 * - chunks arrive in write order; a chunk may end in the middle of a line
 *
 * Returns:
 * - `lines` with terminal control sequences removed; an unterminated last line is included
 */
export class CaseOutputLines {
  /**
   * Captured lines, including a trailing line that has no newline yet.
   */
  get lines(): readonly CaseOutputLine[] {
    return this.partial == null ? this.completeLines : [...this.completeLines, this.partial]
  }

  private readonly completeLines: CaseOutputLine[] = []

  private partial: CaseOutputLine | undefined

  /**
   * Appends one raw chunk.
   */
  append(stream: CaseOutputStream, content: string): void {
    const pieces = content.split('\n')

    for (const [index, piece] of pieces.entries()) {
      const isLast = index === pieces.length - 1
      if (isLast && piece.length === 0) {
        break
      }

      // A chunk on another stream ends the pending partial line instead of joining it.
      if (this.partial != null && this.partial.stream !== stream) {
        this.completeLines.push(this.partial)
        this.partial = undefined
      }

      const text = `${this.partial?.text ?? ''}${piece}`
      this.partial = undefined
      if (isLast) {
        this.partial = { stream, text }
        break
      }
      this.completeLines.push({ stream, text: normalizeOutputLine(text) })
    }

    if (this.partial != null) {
      this.partial = { stream, text: normalizeOutputLine(this.partial.text) }
    }
  }

  /**
   * Appends one separator line written by the reporter itself, for example a retry marker.
   */
  appendMarker(text: string): void {
    if (this.partial != null) {
      this.completeLines.push(this.partial)
      this.partial = undefined
    }
    this.completeLines.push({ stream: 'stdout', text })
  }
}

/**
 * Creates the case output grouping used when stdout is not a TTY (CI logs, pipes).
 *
 * Use when:
 * - concurrent case output must stay readable without a live terminal window
 *
 * Expects:
 * - lifecycle calls follow the run order; `onCaseEnd` arrives once per case after retries
 *
 * Returns:
 * - a collector that prints each case's full output as one block when the case ends; nothing is collapsed,
 *   because a log file has no live view to recover hidden lines from
 */
export function createCaseOutputCollector(options: CaseOutputCollectorOptions): CaseOutputCollector {
  const tasks = new Map<string, { displayName?: string, projectName?: string }>()
  const cases = new Map<string, CollectedCase>()

  function getCase(taskId: string, caseId: string, caseName?: string): CollectedCase {
    const key = `${taskId}\u0000${caseId}`
    const existing = cases.get(key)
    if (existing != null) {
      return existing
    }
    const created = { caseName: caseName ?? caseId, output: new CaseOutputLines(), startedAt: options.getNow(), taskId }
    cases.set(key, created)
    return created
  }

  function writeCase(collected: CollectedCase, state: CaseOutputBlockOptions['state'], errorMessage?: string): void {
    if (collected.output.lines.length === 0) {
      return
    }
    const task = tasks.get(collected.taskId)
    options.write(formatCaseOutputBlock({
      collapse: false,
      colors: false,
      durationMs: options.getNow() - collected.startedAt,
      errorMessage,
      header: formatCaseOutputHeader(task?.projectName, task?.displayName ?? collected.taskId, collected.caseName),
      lines: collected.output.lines,
      state,
    }))
  }

  return {
    flush() {
      for (const collected of cases.values()) {
        writeCase(collected, 'stopped')
      }
      cases.clear()
    },
    onCaseEnd(payload) {
      const key = `${payload.taskId}\u0000${payload.caseId}`
      const collected = cases.get(key)
      if (collected == null) {
        return
      }
      cases.delete(key)
      writeCase(collected, payload.state, payload.errorMessage)
    },
    onCaseOutput(payload) {
      getCase(payload.taskId, payload.caseId).output.append(payload.stream, payload.content)
    },
    onCaseStart(payload) {
      const collected = getCase(payload.taskId, payload.caseId, payload.caseName)
      collected.caseName = payload.caseName ?? collected.caseName
    },
    onTaskQueued(payload) {
      const task = tasks.get(payload.taskId) ?? {}
      task.displayName = payload.displayName ?? task.displayName
      task.projectName = payload.projectName ?? task.projectName
      tasks.set(payload.taskId, task)
    },
  }
}

/**
 * Formats the static block printed once a case ends.
 *
 * Use when:
 * - a reporter replaces a case's live output with its final, pnpm-style collapsed form
 *
 * Expects:
 * - `lines` is non-empty; cases without output print no block
 *
 * Returns:
 * - the block text, ending with a newline
 */
export function formatCaseOutputBlock(options: CaseOutputBlockOptions): string {
  const color = (paint: (value: string) => string, value: string): string => options.colors ? paint(value) : value
  const bar = color(c.magentaBright, '│')
  const shownLines = options.collapse && options.state === 'passed' && options.lines.length > CASE_OUTPUT_VISIBLE_LINES
    ? options.lines.slice(-CASE_OUTPUT_VISIBLE_LINES)
    : options.lines
  const collapsedCount = options.lines.length - shownLines.length
  const duration = formatHumanDuration(options.durationMs)
  const message = options.errorMessage == null ? '' : `: ${options.errorMessage}`
  const status = {
    failed: color(c.red, `Failed in ${duration}${message}`),
    passed: color(c.magentaBright, `Done in ${duration}`),
    skipped: color(c.yellow, `Skipped after ${duration}`),
    stopped: color(c.yellow, `Stopped after ${duration}`),
    timeout: color(c.yellow, `Timed out in ${duration}${message}`),
  }[options.state]

  return [
    options.header,
    ...(collapsedCount > 0 ? [`[${collapsedCount} lines collapsed]`] : []),
    ...shownLines.map(line => `${bar} ${line.stream === 'stderr' ? color(c.gray, line.text) : line.text}`),
    `${color(c.magentaBright, '└─')} ${status}`,
    '',
  ].join('\n')
}

/**
 * Formats the header line naming one case.
 *
 * Before:
 * - project "demo", task "episodes [repeat=1]", case "chrome/open"
 *
 * After:
 * - "|demo| episodes [repeat=1] > chrome/open"
 */
export function formatCaseOutputHeader(projectName: string | undefined, taskName: string, caseName: string): string {
  return `${projectName == null ? '' : `|${projectName}| `}${taskName} > ${caseName}`
}

/**
 * Truncates a line to a terminal display width.
 *
 * Before:
 * - "a long output line", width 10
 *
 * After:
 * - "a long ou…"
 */
export function truncateToWidth(text: string, width: number): string {
  if (stringWidth(text) <= width) {
    return text
  }
  if (width <= 1) {
    return width === 1 ? '…' : ''
  }

  let result = ''
  let resultWidth = 0
  for (const { segment } of SEGMENTER.segment(text)) {
    const segmentWidth = stringWidth(segment)
    if (resultWidth + segmentWidth > width - 1) {
      break
    }
    result += segment
    resultWidth += segmentWidth
  }
  return `${result}…`
}

/**
 * Normalizes one output line so it can be printed inside a reporter block.
 *
 * Before:
 * - "\u001B[32mok\u001B[39m"
 * - "progress 10%\rprogress 100%"
 *
 * After:
 * - "ok"
 * - "progress 100%"
 */
function normalizeOutputLine(text: string): string {
  // A carriage return redraws the line in a terminal; only the last redraw is visible.
  const visible = text.slice(text.lastIndexOf('\r') + 1)

  return stripVTControlCharacters(visible).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
}
