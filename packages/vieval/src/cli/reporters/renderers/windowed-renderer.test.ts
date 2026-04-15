import { describe, expect, it, vi } from 'vitest'

import { WindowRenderer } from './windowed-renderer'

/**
 * @example
 * describe('window renderer', () => {})
 */
describe('window renderer', () => {
  /**
   * @example
   * it('renders current window content when scheduled after start', () => {})
   */
  it('renders current window content when scheduled after start', () => {
    const writes: string[] = []
    const resetCallbacks: Array<() => void> = []
    const intervalHandle = { unref: vi.fn(() => intervalHandle) }
    const createInterval = vi.fn(() => intervalHandle)
    const clearInterval = vi.fn()

    const renderer = new WindowRenderer({
      writeOutput: value => writes.push(value),
      getWindow: () => ['line-a', 'line-b'],
      getColumns: () => 120,
      createInterval,
      clearInterval,
      queueRenderReset: (callback) => {
        resetCallbacks.push(callback)
      },
    })

    renderer.start()
    renderer.schedule()

    expect(createInterval).toHaveBeenCalledOnce()
    expect(intervalHandle.unref).toHaveBeenCalledOnce()
    expect(writes.join('')).toContain('line-a\nline-b')
    expect(resetCallbacks).toHaveLength(1)
  })

  /**
   * @example
   * it('coalesces schedule requests until the injected reset callback runs', () => {})
   */
  it('coalesces schedule requests until the injected reset callback runs', () => {
    const writes: string[] = []
    let resetRenderSchedule: (() => void) | undefined

    const renderer = new WindowRenderer({
      writeOutput: value => writes.push(value),
      getWindow: () => ['line-a'],
      getColumns: () => 120,
      createInterval: () => ({ unref() { return this } }),
      clearInterval: vi.fn(),
      queueRenderReset: (callback) => {
        resetRenderSchedule = callback
      },
    })

    renderer.start()
    renderer.schedule()
    renderer.schedule()

    expect(writes.join('')).toBe('\u001B[?2026hline-a\u001B[?2026l')

    resetRenderSchedule?.()

    renderer.schedule()

    expect(writes.join('')).toBe(
      '\u001B[?2026hline-a\u001B[?2026l\u001B[?2026h\r\u001B[Kline-a\u001B[?2026l',
    )
  })

  /**
   * @example
   * it('ignores stale reset callbacks from a finished run after restart while preserving coalescing', () => {})
   */
  it('ignores stale reset callbacks from a finished run after restart while preserving coalescing', () => {
    const writes: string[] = []
    const resetCallbacks: Array<() => void> = []
    let currentWindow = 'line-a'

    const renderer = new WindowRenderer({
      writeOutput: value => writes.push(value),
      getWindow: () => [currentWindow],
      getColumns: () => 120,
      supportsAnsiWindowing: false,
      createInterval: () => ({ unref() { return this } }),
      clearInterval: vi.fn(),
      queueRenderReset: (callback) => {
        resetCallbacks.push(callback)
      },
    })

    renderer.start()
    renderer.schedule()
    renderer.schedule()

    expect(writes).toEqual(['line-a', '\n'])
    expect(resetCallbacks).toHaveLength(1)

    const staleReset = resetCallbacks[0]

    renderer.finish()

    currentWindow = 'line-b'

    renderer.start()
    renderer.schedule()
    renderer.schedule()

    expect(writes).toEqual(['line-a', '\n', 'line-b', '\n'])
    expect(resetCallbacks).toHaveLength(2)

    const currentReset = resetCallbacks[1]

    staleReset()
    renderer.schedule()

    expect(writes).toEqual(['line-a', '\n', 'line-b', '\n'])

    currentReset()
    renderer.schedule()

    expect(writes).toEqual(['line-a', '\n', 'line-b', '\n', 'line-b', '\n'])
  })

  /**
   * @example
   * it('renders plain output without ANSI window control when windowing is disabled', () => {})
   */
  it('renders plain output without ANSI window control when windowing is disabled', () => {
    const writes: string[] = []

    const renderer = new WindowRenderer({
      writeOutput: value => writes.push(value),
      getWindow: () => ['line-a', 'line-b'],
      getColumns: () => 120,
      supportsAnsiWindowing: false,
      createInterval: () => ({ unref() { return this } }),
      clearInterval: vi.fn(),
      queueRenderReset: () => {},
    })

    renderer.start()
    renderer.schedule()
    renderer.finish()

    expect(writes.join('')).toBe('line-a\nline-b\n')
  })

  /**
   * @example
   * it('keeps fallback renders separated across multiple schedule cycles', () => {})
   */
  it('keeps fallback renders separated across multiple schedule cycles', () => {
    const writes: string[] = []
    const resetCallbacks: Array<() => void> = []
    let currentWindow = ['line-a']

    const renderer = new WindowRenderer({
      writeOutput: value => writes.push(value),
      getWindow: () => currentWindow,
      getColumns: () => 120,
      supportsAnsiWindowing: false,
      createInterval: () => ({ unref() { return this } }),
      clearInterval: vi.fn(),
      queueRenderReset: (callback) => {
        resetCallbacks.push(callback)
      },
    })

    renderer.start()
    renderer.schedule()
    resetCallbacks[0]?.()

    currentWindow = ['line-b']
    renderer.schedule()
    resetCallbacks[1]?.()
    renderer.finish()

    expect(writes.join('')).toContain('line-a\n')
    expect(writes.join('')).toContain('line-b\n')
    expect(writes.join('')).not.toContain('line-aline-b')
  })

  /**
   * @example
   * it('buffers active output writes until the next render lifecycle flush', () => {})
   */
  it('buffers active output writes until the next render lifecycle flush', () => {
    const writes: string[] = []
    const resetCallbacks: Array<() => void> = []

    const renderer = new WindowRenderer({
      writeOutput: value => writes.push(value),
      getWindow: () => ['line-a'],
      getColumns: () => 120,
      createInterval: () => ({ unref() { return this } }),
      clearInterval: vi.fn(),
      queueRenderReset: (callback) => {
        resetCallbacks.push(callback)
      },
    })

    renderer.start()
    renderer.write('buffered log\n')

    expect(writes).toEqual([])

    renderer.schedule()

    expect(writes.join('')).toBe('\u001B[?2026hbuffered log\nline-a\u001B[?2026l')
    expect(resetCallbacks).toHaveLength(1)

    resetCallbacks[0]?.()
    renderer.write('second log\n')
    renderer.finish()

    expect(writes.join('')).toBe(
      '\u001B[?2026hbuffered log\nline-a\u001B[?2026l\r\u001B[Ksecond log\n',
    )
  })

  /**
   * @example
   * it('writes output directly when the renderer is inactive', () => {})
   */
  it('writes output directly when the renderer is inactive', () => {
    const writes: string[] = []

    const renderer = new WindowRenderer({
      writeOutput: value => writes.push(value),
      getWindow: () => ['line-a'],
      getColumns: () => 120,
      createInterval: () => ({ unref() { return this } }),
      clearInterval: vi.fn(),
      queueRenderReset: () => {},
    })

    renderer.write('before start\n')
    renderer.start()
    renderer.finish()
    renderer.write('after finish\n')

    expect(writes.join('')).toBe('before start\nafter finish\n')
  })

  /**
   * @example
   * it('uses display width instead of string length when clearing wide-character rows', () => {})
   */
  it('uses display width instead of string length when clearing wide-character rows', () => {
    const cases = [
      {
        expected: '\u001B[?2026h界\u001B[?2026l\r\u001B[K\r\u001B[1A\u001B[K',
        line: '界',
      },
      {
        expected: '\u001B[?2026h😀\u001B[?2026l\r\u001B[K\r\u001B[1A\u001B[K',
        line: '😀',
      },
      {
        expected: '\u001B[?2026he\u0301\u001B[?2026l\r\u001B[K',
        line: 'e\u0301',
      },
      {
        // ROOT CAUSE:
        //
        // Keycap emoji are multi-code-point grapheme clusters. `1️⃣` is composed from
        // the ASCII digit, variation selector, and combining keycap mark. Counting
        // code points or East Asian width units independently can collapse this to a
        // single column even though terminals render it as a wide emoji.
        //
        // We keep the renderer on a one-column terminal here so the regression is
        // visible in the clear-window row count.
        expected: '\u001B[?2026h1️⃣\u001B[?2026l\r\u001B[K\r\u001B[1A\u001B[K',
        line: '1️⃣',
      },
    ] as const

    for (const { line, expected } of cases) {
      const writes: string[] = []

      const renderer = new WindowRenderer({
        writeOutput: value => writes.push(value),
        getWindow: () => [line],
        getColumns: () => 1,
        createInterval: () => ({ unref() { return this } }),
        clearInterval: vi.fn(),
        queueRenderReset: () => {},
      })

      renderer.start()
      renderer.schedule()
      renderer.finish()

      expect(writes.join('')).toBe(expected)
    }
  })

  /**
   * @example
   * it('clears the rendered rows and stops timers safely when finished or disposed repeatedly', () => {})
   */
  it('clears the rendered rows and stops timers safely when finished or disposed repeatedly', () => {
    const writes: string[] = []
    const intervalHandle = { unref: vi.fn(() => intervalHandle) }
    const clearInterval = vi.fn<(timer: typeof intervalHandle) => void>()

    const renderer = new WindowRenderer({
      writeOutput: value => writes.push(value),
      getWindow: () => ['12345', '67890'],
      getColumns: () => 5,
      createInterval: () => intervalHandle,
      clearInterval,
      queueRenderReset: () => {},
    })

    renderer.start()
    renderer.schedule()
    renderer.finish()
    renderer.dispose()
    renderer.dispose()

    expect(clearInterval).toHaveBeenCalledTimes(1)
    expect(clearInterval).toHaveBeenCalledWith(intervalHandle)
    expect(writes.join('')).toBe(
      '\u001B[?2026h12345\n67890\u001B[?2026l\r\u001B[K\r\u001B[1A\u001B[K',
    )
  })

  /**
   * @example
   * it('clears redraws from the start of the line and keeps post-finish writes aligned', () => {})
   */
  it('clears redraws from the start of the line and keeps post-finish writes aligned', () => {
    const writes: string[] = []
    const resetCallbacks: Array<() => void> = []
    let currentWindow = ['wide-line']

    const renderer = new WindowRenderer({
      writeOutput: value => writes.push(value),
      getWindow: () => currentWindow,
      getColumns: () => 120,
      createInterval: () => ({ unref() { return this } }),
      clearInterval: vi.fn(),
      queueRenderReset: (callback) => {
        resetCallbacks.push(callback)
      },
    })

    renderer.start()
    renderer.schedule()
    resetCallbacks[0]?.()

    currentWindow = ['short']
    renderer.schedule()
    renderer.finish()
    renderer.write('after finish\n')

    expect(writes.join('')).toBe(
      '\u001B[?2026hwide-line\u001B[?2026l\u001B[?2026h\r\u001B[Kshort\u001B[?2026l\r\u001B[Kafter finish\n',
    )
  })
})
