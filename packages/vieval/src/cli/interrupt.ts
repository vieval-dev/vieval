import process from 'node:process'

import { constants } from 'node:os'

/**
 * Callbacks for {@link listenForInterrupt}.
 */
export interface InterruptListeners {
  /**
   * Runs on the second interrupt, when the user does not want to wait for cleanup. It must end the process.
   */
  onForceExit: (signal: InterruptSignal) => void
  /**
   * Runs on the first interrupt. The run should stop starting work and let running cases clean up.
   */
  onInterrupt: (signal: InterruptSignal) => void
}

/**
 * Process signals that interrupt a run.
 *
 * - `SIGINT`: Ctrl+C in a terminal
 * - `SIGTERM`: `kill <pid>`, container or CI shutdown
 * - `SIGHUP`: the controlling terminal was closed
 */
export type InterruptSignal = 'SIGHUP' | 'SIGINT' | 'SIGTERM'

const INTERRUPT_SIGNALS: readonly InterruptSignal[] = ['SIGHUP', 'SIGINT', 'SIGTERM']

/**
 * Normalizes an interrupt signal into the conventional shell exit code.
 *
 * Before:
 * - "SIGINT"
 * - "SIGTERM"
 * - "SIGHUP"
 *
 * After:
 * - 130
 * - 143
 * - 129
 */
export function exitCodeFromSignal(signal: InterruptSignal): number {
  // Shells report a process ended by signal N as 128 + N.
  return 128 + constants.signals[signal]
}

/**
 * Turns process interrupt signals into a two-step shutdown for one run.
 *
 * Use when:
 * - `vieval run` must give running cases a chance to run their cleanup (for example deleting cloud resources)
 *   instead of letting Node end the process on the first Ctrl+C
 *
 * Expects:
 * - the returned function is called when the run settles; afterwards the default signal behavior is restored
 *
 * Returns:
 * - a function that removes the listeners
 *
 * Call stack:
 *
 * runVievalCli (./run)
 *   -> {@link listenForInterrupt}
 *     -> first signal: {@link InterruptListeners.onInterrupt}
 *     -> second signal: {@link InterruptListeners.onForceExit}
 */
export function listenForInterrupt(listeners: InterruptListeners): () => void {
  let interrupted = false

  // NOTICE:
  // Registering a listener replaces Node's default action for that signal, which ends the process
  // immediately and skips every pending `finally` and abort listener.
  // Source: https://nodejs.org/api/process.html#signal-events
  // The default comes back once the listeners are removed.
  const handleSignal = (signal: InterruptSignal): void => {
    if (interrupted) {
      listeners.onForceExit(signal)
      return
    }

    interrupted = true
    listeners.onInterrupt(signal)
  }

  // One bound listener per signal, so the signal name does not depend on the listener arguments.
  const signalListeners = INTERRUPT_SIGNALS.map(signal => [signal, () => handleSignal(signal)] as const)
  for (const [signal, listener] of signalListeners) {
    process.on(signal, listener)
  }

  return () => {
    for (const [signal, listener] of signalListeners) {
      process.off(signal, listener)
    }
  }
}
