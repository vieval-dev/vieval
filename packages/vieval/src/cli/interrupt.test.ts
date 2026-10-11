import process from 'node:process'

import { describe, expect, it, vi } from 'vitest'

import { exitCodeFromSignal, listenForInterrupt } from './interrupt'

/**
 * @example
 * describe('listenForInterrupt', () => {})
 */
describe('listenForInterrupt', () => {
  /**
   * @example
   * it('interrupts on the first signal and force-exits on the second', () => {})
   */
  it('interrupts on the first signal and force-exits on the second', () => {
    const onInterrupt = vi.fn()
    const onForceExit = vi.fn()
    const stopListening = listenForInterrupt({ onForceExit, onInterrupt })

    // NOTICE:
    // `process.emit` invokes the registered signal listeners without delivering a real signal to the worker.
    // The Vitest worker registers no SIGINT/SIGTERM/SIGHUP listeners of its own, so only ours run.
    // Real delivery (and Node's default exit when no listener exists) is covered by the CLI interrupt check in the PR.
    // Removal condition: none; this is the intended way to exercise the listener policy in-process.
    try {
      process.emit('SIGINT')
      process.emit('SIGTERM')
    }
    finally {
      stopListening()
    }

    /**
     * @example
     * expect(onInterrupt).toHaveBeenCalledWith('SIGINT')
     */
    expect(onInterrupt).toHaveBeenCalledWith('SIGINT')
    expect(onInterrupt).toHaveBeenCalledTimes(1)
    /**
     * @example
     * expect(onForceExit).toHaveBeenCalledWith('SIGTERM')
     */
    expect(onForceExit).toHaveBeenCalledWith('SIGTERM')
  })

  /**
   * @example
   * it('restores the default signal behavior once stopped', () => {})
   */
  it('restores the default signal behavior once stopped', () => {
    const stopListening = listenForInterrupt({ onForceExit: vi.fn(), onInterrupt: vi.fn() })
    stopListening()

    /**
     * @example
     * expect(['SIGHUP', 'SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal))).toEqual([0, 0, 0])
     */
    expect(['SIGHUP', 'SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal))).toEqual([0, 0, 0])
  })
})

/**
 * @example
 * describe('exitCodeFromSignal', () => {})
 */
describe('exitCodeFromSignal', () => {
  /**
   * @example
   * it('uses the shell convention 128 + signal number', () => {})
   */
  it('uses the shell convention 128 + signal number', () => {
    /**
     * @example
     * expect(exitCodeFromSignal('SIGINT')).toBe(130)
     */
    expect(exitCodeFromSignal('SIGINT')).toBe(130)
    expect(exitCodeFromSignal('SIGTERM')).toBe(143)
    expect(exitCodeFromSignal('SIGHUP')).toBe(129)
  })
})
