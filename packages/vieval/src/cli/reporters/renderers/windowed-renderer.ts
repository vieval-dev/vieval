import { stripVTControlCharacters } from 'node:util'

// NOTICE:
// This renderer needs a grapheme-aware terminal width utility for emoji sequences such as `1️⃣`.
// `fast-string-width` is the enforced replacement for `string-width` in this repository.
import stringWidth from 'fast-string-width'

// NOTICE:
// Adapted from Vitest's WindowRenderer implementation.
// Source permalink: https://github.com/vitest-dev/vitest/blob/v4.1.1/packages/vitest/src/node/reporters/renderers/windowedRenderer.ts
// Adaptation scope: keep the bottom-window redraw and scheduling behavior while replacing Vitest logger and stream interception with injected callbacks for vieval.
// Changes: deterministic timer/reset hooks for tests, no direct process stdout/stderr interception in this task, and lifecycle exposed as start/schedule/finish/dispose with safe repeated cleanup.

const DEFAULT_RENDER_INTERVAL_MS = 1_000

const ESC = '\x1B['
const CARRIAGE_RETURN = '\r'
const CLEAR_LINE = `${ESC}K`
const MOVE_CURSOR_ONE_ROW_UP = `${ESC}1A`
const SYNC_START = `${ESC}?2026h`
const SYNC_END = `${ESC}?2026l`

type DefaultWindowRendererTimer = ReturnType<typeof globalThis.setInterval>

/**
 * Timer handle used by the renderer's periodic refresh loop.
 *
 * Use when:
 * - integrating with the default Node.js interval handle
 * - injecting a deterministic fake timer in tests
 *
 * Expects:
 * - `unref()` mirrors the Node.js timer contract when present
 *
 * Returns:
 * - the same handle or `void`
 */
export interface WindowRendererTimer {
  unref?: () => WindowRendererTimer | void
}

type WindowRendererTimerHooks<TTimer extends WindowRendererTimer>
  = {
    clearInterval?: undefined
    createInterval?: undefined
  }
  | {
    clearInterval: (timer: TTimer) => void
    createInterval: (callback: () => void, intervalMs: number) => TTimer
  }

interface WindowRendererBaseOptions {
  getColumns: () => number
  getWindow: () => string[]
  intervalMs?: number
  queueRenderReset?: (callback: () => void) => void
  supportsAnsiWindowing?: boolean
  writeOutput: (value: string) => void
}

type WindowRendererConstructorOptions<TTimer extends WindowRendererTimer> = WindowRendererBaseOptions & WindowRendererTimerHooks<TTimer>

/**
 * Dependency contract for the TTY window renderer.
 *
 * Use when:
 * - rendering the live reporter window into injected output sinks
 * - testing redraw behavior without touching process streams
 *
 * Expects:
 * - `getWindow()` returns the current bottom-window rows in render order
 * - `getColumns()` returns a positive terminal width
 * - custom timer injection supplies matching `createInterval` and `clearInterval`
 */
export type WindowRendererOptions<TTimer extends WindowRendererTimer = DefaultWindowRendererTimer> = WindowRendererConstructorOptions<TTimer>

interface ManagedWindowRendererTimer {
  clear: () => void
  unref?: () => WindowRendererTimer | void
}

interface ResolvedWindowRendererOptions {
  createInterval: (callback: () => void, intervalMs: number) => ManagedWindowRendererTimer
  getColumns: () => number
  getWindow: () => string[]
  intervalMs: number
  queueRenderReset: (callback: () => void) => void
  supportsAnsiWindowing: boolean
  writeOutput: (value: string) => void
}

/**
 * Renders a dynamic window at the bottom of the terminal.
 *
 * Use when:
 * - a reporter needs in-place TTY updates without leaking terminal control codes into tests
 * - callers want Vitest-style redraw behavior with injected output/timer dependencies
 *
 * Expects:
 * - `start()` runs before `schedule()`
 * - `finish()` or `dispose()` may be called multiple times safely
 *
 * Returns:
 * - no direct value; all effects are emitted through the injected callbacks
 *
 * Call stack:
 *
 * {@link WindowRenderer.start}
 *   -> periodic schedule callback
 *     -> {@link WindowRenderer.schedule}
 *       -> {@link WindowRenderer.renderWindow}
 */
export class WindowRenderer<TTimer extends WindowRendererTimer = DefaultWindowRendererTimer> {
  private readonly options: ResolvedWindowRendererOptions
  private renderInterval: ManagedWindowRendererTimer | undefined
  private renderScheduled = false
  private renderScheduleVersion = 0
  private windowHeight = 0
  private started = false
  private finished = false
  private bufferedOutput = ''

  constructor(options: WindowRendererOptions<TTimer>) {
    if (options.createInterval && options.clearInterval) {
      this.options = {
        createInterval: (callback, intervalMs) => {
          const timer = options.createInterval(callback, intervalMs)
          return {
            clear: () => options.clearInterval(timer),
            unref: timer.unref?.bind(timer),
          }
        },
        getColumns: options.getColumns,
        getWindow: options.getWindow,
        intervalMs: options.intervalMs ?? DEFAULT_RENDER_INTERVAL_MS,
        queueRenderReset: options.queueRenderReset ?? defaultQueueRenderReset,
        supportsAnsiWindowing: options.supportsAnsiWindowing ?? true,
        writeOutput: options.writeOutput,
      }
      return
    }

    this.options = {
      createInterval: defaultCreateInterval,
      getColumns: options.getColumns,
      getWindow: options.getWindow,
      intervalMs: options.intervalMs ?? DEFAULT_RENDER_INTERVAL_MS,
      queueRenderReset: options.queueRenderReset ?? defaultQueueRenderReset,
      supportsAnsiWindowing: options.supportsAnsiWindowing ?? true,
      writeOutput: options.writeOutput,
    }
  }

  /**
   * Starts the periodic refresh loop.
   *
   * Use when:
   * - the live reporter is about to emit in-place updates
   *
   * Expects:
   * - repeated calls are harmless and keep the existing timer
   *
   * Returns:
   * - no direct value
   */
  start(): void {
    if (this.started && !this.finished) {
      return
    }

    this.started = true
    this.finished = false
    this.renderScheduleVersion += 1

    if (!this.renderInterval) {
      this.renderInterval = this.options.createInterval(() => this.schedule(), this.options.intervalMs)
      this.renderInterval.unref?.()
    }
  }

  /**
   * Queues a render if one is not already in flight.
   *
   * Use when:
   * - reporter state changes and the bottom window should refresh
   *
   * Expects:
   * - the renderer has been started
   *
   * Returns:
   * - no direct value
   */
  schedule(): void {
    if (!this.started || this.finished || this.renderScheduled) {
      return
    }

    const renderScheduleVersion = this.renderScheduleVersion
    this.renderScheduled = true
    this.renderWindow()
    this.options.queueRenderReset(() => {
      if (this.renderScheduleVersion !== renderScheduleVersion) {
        return
      }

      this.renderScheduled = false
    })
  }

  /**
   * Clears the rendered window and stops the refresh loop.
   *
   * Use when:
   * - the live reporter is transitioning to final static output
   *
   * Expects:
   * - repeated calls are safe
   *
   * Returns:
   * - no direct value
   */
  finish(): void {
    if (this.finished) {
      return
    }

    this.finished = true
    this.started = false
    this.renderScheduleVersion += 1
    this.renderScheduled = false
    this.stopInterval()
    this.clearWindow()
    this.flushBufferedOutput()
  }

  /**
   * Stops the renderer and clears any visible window state.
   *
   * Use when:
   * - cleanup needs to happen from a `finally` block or interrupted run
   *
   * Expects:
   * - callers may invoke it more than once
   *
   * Returns:
   * - no direct value
   */
  dispose(): void {
    this.finish()
  }

  /**
   * Alias for disposal to match Vitest's renderer lifecycle naming.
   *
   * Use when:
   * - adapting code that expects `stop()`
   *
   * Expects:
   * - callers want the same semantics as `dispose()`
   *
   * Returns:
   * - no direct value
   */
  stop(): void {
    this.dispose()
  }

  /**
   * Writes reporter output through the renderer lifecycle.
   *
   * Use when:
   * - emitting log lines that must appear above the live ANSI window
   * - callers need deterministic buffering behavior in tests
   *
   * Expects:
   * - active ANSI window mode buffers until `schedule()` or `finish()`
   * - inactive or non-windowed mode writes directly
   *
   * Returns:
   * - no direct value
   */
  write(message: string): void {
    if (!this.isActiveWindowMode()) {
      this.writeOutput(message)
      return
    }

    this.bufferedOutput += message
  }

  private renderWindow(): void {
    const windowContent = this.options.getWindow()
    const rowCount = getRenderedRowCount(windowContent, this.options.getColumns())

    if (this.options.supportsAnsiWindowing) {
      this.writeOutput(SYNC_START)
      this.clearWindow()
    }

    this.flushBufferedOutput()
    this.writeOutput(windowContent.join('\n'))

    if (this.options.supportsAnsiWindowing) {
      this.writeOutput(SYNC_END)
      this.windowHeight = rowCount
      return
    }

    this.writeOutput('\n')
    this.windowHeight = 0
  }

  private clearWindow(): void {
    if (!this.options.supportsAnsiWindowing || this.windowHeight === 0) {
      return
    }

    this.writeOutput(`${CARRIAGE_RETURN}${CLEAR_LINE}`)

    for (let rowIndex = 1; rowIndex < this.windowHeight; rowIndex += 1) {
      this.writeOutput(`${CARRIAGE_RETURN}${MOVE_CURSOR_ONE_ROW_UP}${CLEAR_LINE}`)
    }

    this.windowHeight = 0
  }

  private stopInterval(): void {
    if (!this.renderInterval) {
      return
    }

    this.renderInterval.clear()
    this.renderInterval = undefined
  }

  private writeOutput(message: string): void {
    this.options.writeOutput(message)
  }

  private flushBufferedOutput(): void {
    if (this.bufferedOutput.length === 0) {
      return
    }

    this.writeOutput(this.bufferedOutput)
    this.bufferedOutput = ''
  }

  private isActiveWindowMode(): boolean {
    return this.started && !this.finished && this.options.supportsAnsiWindowing
  }
}

function defaultCreateInterval(callback: () => void, intervalMs: number): ManagedWindowRendererTimer {
  const timer = globalThis.setInterval(callback, intervalMs)

  return {
    clear: () => globalThis.clearInterval(timer),
    unref: timer.unref?.bind(timer),
  }
}

function defaultQueueRenderReset(callback: () => void): void {
  setTimeout(callback, 100).unref()
}

/** Calculate the rendered row count for the supplied rows and terminal width. */
function getRenderedRowCount(rows: string[], columns: number): number {
  const safeColumns = Math.max(1, columns)
  let count = 0

  for (const row of rows) {
    const text = stripVTControlCharacters(row)
    count += Math.max(1, Math.ceil(getTextDisplayWidth(text) / safeColumns))
  }

  return count
}

function getTextDisplayWidth(text: string): number {
  return stringWidth(stripVTControlCharacters(text))
}
