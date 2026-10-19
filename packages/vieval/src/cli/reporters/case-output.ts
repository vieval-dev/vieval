import type { CaseOutputStream } from '../../core/runner/case-output'
import type {
  CliReporter,
  CliReporterCaseEndPayload,
  CliReporterCaseOutputPayload,
  CliReporterCaseStartPayload,
  CliReporterCaseState,
  CliReporterTaskQueuedPayload,
} from './types'

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
 * Options for {@link CaseOutputCollector}.
 */
export interface CaseOutputCollectorOptions {
  /**
   * Keeps only the last {@link CASE_OUTPUT_VISIBLE_LINES} lines of a passed case.
   */
  collapse: boolean
  /**
   * Enables ANSI colors in printed blocks.
   */
  colors: boolean
  /**
   * Returns milliseconds from a monotonic or deterministic clock.
   */
  getNow: () => number
  /**
   * Holds every block until {@link CaseOutputCollector.flush} instead of printing it when its case ends.
   */
  holdUntilFlush: boolean
  /**
   * Writes one finished case block.
   */
  write: (value: string) => void
}

/**
 * One output line written by a case.
 */
export interface CaseOutputLine {
  stream: CaseOutputStream
  text: string
}

/**
 * Status shown on the last line of a block.
 *
 * - `late`: output written after the case's block was already printed (a timed-out case that kept running)
 * - `stopped`: the task ended before the case reported its result
 */
type CaseOutputBlockState = 'late' | 'stopped' | CliReporterCaseState

interface CaseOutputEntry {
  caseName: string
  durationMs?: number
  errorMessage?: string
  lines: CaseOutputLines
  order: number
  startedAt: number
  state?: CaseOutputBlockState
  taskId: string
}

interface CaseOutputTask {
  displayName?: string
  order: number
  projectName?: string
}

/**
 * Tracks the output of every case in a run and prints it as pnpm-style blocks.
 *
 * Use when:
 * - a reporter must group concurrent case output per case instead of interleaving it
 *
 * Expects:
 * - lifecycle calls follow the run order; `onCaseEnd` arrives once per case, after retries
 * - repeated or out-of-order calls for an ended case are ignored
 *
 * Returns:
 * - nothing directly; blocks go to `write` when a case ends, or on `flush()` with `holdUntilFlush`
 *
 * Call stack:
 *
 * runCaseOnce (../../dsl/task)
 *   -> process.stdout.write
 *     -> {@link CaseOutputCollector.onCaseOutput}
 * executeRegisteredCase (../../dsl/task)
 *   -> {@link CaseOutputCollector.onCaseEnd}
 *     -> block written now, or held until {@link CaseOutputCollector.flush}
 */
export class CaseOutputCollector {
  private readonly cases = new Map<string, CaseOutputEntry>()
  private readonly options: CaseOutputCollectorOptions
  private readonly tasks = new Map<string, CaseOutputTask>()

  constructor(options: CaseOutputCollectorOptions) {
    this.options = options
  }

  /**
   * Prints every block not printed yet, grouped by task in queue order and cases in start order.
   * Cases still running are printed as stopped.
   */
  flush(): void {
    const entries = [...this.cases.values()].sort((left, right) =>
      this.getTask(left.taskId).order - this.getTask(right.taskId).order || left.order - right.order)
    this.cases.clear()

    for (const entry of entries) {
      this.writeBlock(entry, entry.state ?? 'stopped')
    }
  }

  /**
   * Lines captured so far for one case, for live tails.
   */
  linesOf(taskId: string, caseId: string): readonly CaseOutputLine[] {
    return this.cases.get(createCaseKey(taskId, caseId))?.lines.lines ?? []
  }

  onCaseEnd(payload: CliReporterCaseEndPayload): void {
    const entry = this.cases.get(createCaseKey(payload.taskId, payload.caseId))
    if (entry == null || entry.state != null) {
      return
    }
    this.endCase(entry, payload.state, payload.errorMessage)
  }

  onCaseOutput(payload: CliReporterCaseOutputPayload): void {
    this.getCase(payload.taskId, payload.caseId).lines.append(payload.stream, payload.content)
  }

  onCaseStart(payload: CliReporterCaseStartPayload & { caseName?: string }): void {
    const entry = this.getCase(payload.taskId, payload.caseId)
    if (entry.state != null) {
      return
    }
    if (payload.retryIndex != null && payload.retryIndex > 0 && entry.lines.lines.length > 0) {
      entry.lines.appendMarker(`── retry ${payload.retryIndex}/${payload.autoRetry ?? payload.retryIndex} ──`)
    }
    entry.caseName = payload.caseName ?? entry.caseName
  }

  /**
   * Marks the cases of an ended task that never reported a result as stopped.
   */
  onTaskEnd(taskId: string): void {
    for (const entry of this.cases.values()) {
      if (entry.taskId === taskId && entry.state == null) {
        this.endCase(entry, 'stopped')
      }
    }
  }

  onTaskQueued(payload: CliReporterTaskQueuedPayload & { displayName?: string, projectName?: string }): void {
    const task = this.getTask(payload.taskId)
    task.displayName = payload.displayName ?? task.displayName
    task.projectName = payload.projectName ?? task.projectName
  }

  private endCase(entry: CaseOutputEntry, state: CaseOutputBlockState, errorMessage?: string): void {
    entry.state = state
    entry.errorMessage = errorMessage
    entry.durationMs = Math.max(0, this.options.getNow() - entry.startedAt)
    if (this.options.holdUntilFlush) {
      return
    }

    this.writeBlock(entry, state)
    // Keep the entry so output written after the case ended still knows its case name.
    entry.lines = new CaseOutputLines()
    entry.state = 'late'
  }

  private getCase(taskId: string, caseId: string): CaseOutputEntry {
    const key = createCaseKey(taskId, caseId)
    const existing = this.cases.get(key)
    if (existing != null) {
      return existing
    }

    const created: CaseOutputEntry = {
      caseName: caseId,
      lines: new CaseOutputLines(),
      order: this.cases.size,
      startedAt: this.options.getNow(),
      taskId,
    }
    this.cases.set(key, created)
    return created
  }

  private getTask(taskId: string): CaseOutputTask {
    const existing = this.tasks.get(taskId)
    if (existing != null) {
      return existing
    }

    const created = { order: this.tasks.size }
    this.tasks.set(taskId, created)
    return created
  }

  private writeBlock(entry: CaseOutputEntry, state: CaseOutputBlockState): void {
    const lines = entry.lines.lines
    if (lines.length === 0) {
      return
    }

    const color = (paint: (value: string) => string, value: string): string => this.options.colors ? paint(value) : value
    const shownLines = this.options.collapse && state === 'passed' && lines.length > CASE_OUTPUT_VISIBLE_LINES
      ? lines.slice(-CASE_OUTPUT_VISIBLE_LINES)
      : lines
    const collapsedCount = lines.length - shownLines.length
    const duration = formatHumanDuration(entry.durationMs ?? Math.max(0, this.options.getNow() - entry.startedAt))
    const message = entry.errorMessage == null ? '' : `: ${entry.errorMessage}`
    // A case without a result (`errored`, `timeout`) is yellow; red is kept for wrong results.
    const status = {
      errored: color(c.yellow, `Errored in ${duration}${message}`),
      failed: color(c.red, `Failed in ${duration}${message}`),
      late: color(c.yellow, 'Wrote more output after the case ended'),
      passed: color(c.magentaBright, `Done in ${duration}`),
      skipped: color(c.yellow, `Skipped after ${duration}`),
      stopped: color(c.yellow, `Stopped after ${duration}`),
      timeout: color(c.yellow, `Timed out in ${duration}${message}`),
    }[state]
    const task = this.getTask(entry.taskId)
    const project = task.projectName == null ? '' : color(c.dim, `|${task.projectName}| `)

    this.options.write([
      `${project}${task.displayName ?? entry.taskId} ${color(c.dim, '>')} ${entry.caseName}`,
      ...(collapsedCount > 0 ? [`[${collapsedCount} lines collapsed]`] : []),
      ...shownLines.map(line => `${color(c.magentaBright, '│')} ${line.stream === 'stderr' ? color(c.gray, line.text) : line.text}`),
      `${color(c.magentaBright, '└─')} ${status}`,
      '',
    ].join('\n'))
  }
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
  readonly lines: CaseOutputLine[] = []

  private lastLineOpen = false

  /**
   * Appends one raw chunk.
   */
  append(stream: CaseOutputStream, content: string): void {
    if (content.length === 0) {
      return
    }

    const pieces = content.split('\n')
    for (const [index, piece] of pieces.entries()) {
      const lastLine = this.lines.at(-1)
      // A chunk on another stream starts a new line instead of joining the open one.
      if (index === 0 && this.lastLineOpen && lastLine?.stream === stream) {
        lastLine.text = normalizeOutputLine(`${lastLine.text}${piece}`)
        continue
      }
      // The empty piece after a trailing newline is not a line.
      if (index === pieces.length - 1 && piece.length === 0) {
        continue
      }
      this.lines.push({ stream, text: normalizeOutputLine(piece) })
    }
    this.lastLineOpen = pieces.at(-1) !== ''
  }

  /**
   * Appends one separator line written by the reporter itself, for example a retry marker.
   */
  appendMarker(text: string): void {
    this.lines.push({ stream: 'stdout', text })
    this.lastLineOpen = false
  }
}

/**
 * Creates the reporter used when stdout is not a TTY (CI logs, pipes).
 *
 * Use when:
 * - there is no live window, but concurrent case output must stay readable
 *
 * Expects:
 * - `dispose()` runs once the run settles
 *
 * Returns:
 * - a reporter that prints each case's full output as one block when the case ends and nothing else;
 *   nothing is collapsed, because a log file has no live view to recover hidden lines from
 */
export function createCaseOutputReporter(options: Pick<CaseOutputCollectorOptions, 'getNow' | 'write'>): CliReporter {
  const collector = new CaseOutputCollector({ ...options, collapse: false, colors: false, holdUntilFlush: false })

  return {
    dispose: () => collector.flush(),
    onCaseEnd: payload => collector.onCaseEnd(payload),
    onCaseOutput: payload => collector.onCaseOutput(payload),
    onCaseStart: payload => collector.onCaseStart(payload),
    onRunEnd() {},
    onRunStart() {},
    onTaskEnd: payload => collector.onTaskEnd(payload.taskId),
    onTaskQueued: payload => collector.onTaskQueued(payload),
    onTaskStart() {},
  }
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

function createCaseKey(taskId: string, caseId: string): string {
  return `${taskId}\u0000${caseId}`
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
