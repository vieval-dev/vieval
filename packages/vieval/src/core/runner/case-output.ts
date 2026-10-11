import process from 'node:process'

import { AsyncLocalStorage } from 'node:async_hooks'
import { Buffer } from 'node:buffer'

/**
 * Receives output chunks written while one case scope is active.
 */
export type CaseOutputSink = (stream: CaseOutputStream, content: string) => void

/**
 * Process stream that produced one captured output chunk.
 */
export type CaseOutputStream = 'stderr' | 'stdout'

/**
 * Process stream interception created by {@link createProcessOutputInterceptor}.
 */
export interface ProcessOutputInterceptor {
  /**
   * Restores the original `process.stdout.write` and `process.stderr.write`.
   *
   * Safe to call more than once, and before `start()`.
   */
  restore: () => void
  /**
   * Starts routing writes: case-scoped writes go to their case sink, all other writes to `onUnscopedOutput`.
   */
  start: (onUnscopedOutput: CaseOutputSink) => void
  /**
   * Writes to stderr without passing through the interception.
   */
  writeStderr: (value: string) => void
  /**
   * Writes to stdout without passing through the interception.
   */
  writeStdout: (value: string) => void
}

type StreamWriteCallback = (error?: Error | null) => void

// NOTICE:
// Eval modules are imported through Vitest's module runner (`cli/module-runtime.ts`),
// so the DSL that enters a case scope and the CLI that intercepts streams can be
// different module instances of this file. A per-module `AsyncLocalStorage` would
// never see scopes entered by the other instance.
// The store therefore lives on `process` under a `Symbol.for` key, the same way
// `dsl/registry.ts` shares its registration store.
// Removal condition: eval modules and the CLI always share one module graph.
const caseOutputStorageSymbol = Symbol.for('vieval.runner.case-output.storage')

/**
 * Routes `process.stdout` / `process.stderr` writes to the active case scope.
 *
 * Use when:
 * - the CLI runs many cases concurrently in one process and needs to know which case wrote what
 *
 * Expects:
 * - the writers are captured when the interceptor is created, so they stay usable before `start()`
 * - callers call `restore()` once the run settles
 * - `console.*` writes are covered because the global console writes through these streams
 * - child processes that inherit the file descriptors bypass this interception
 *
 * Returns:
 * - a handle with `start()`, `restore()`, and writers that bypass the interception
 *
 * Call stack:
 *
 * runVievalCli (../../cli/run)
 *   -> {@link createProcessOutputInterceptor}
 *     -> case code writes to `process.stdout`
 *       -> {@link CaseOutputSink} from {@link runWithCaseOutput}, or `onUnscopedOutput`
 */
export function createProcessOutputInterceptor(): ProcessOutputInterceptor {
  const storage = getCaseOutputStorage()
  const originalStdoutWrite = process.stdout.write
  const originalStderrWrite = process.stderr.write
  const writeStdout = (value: string): void => {
    originalStdoutWrite.call(process.stdout, value)
  }
  const writeStderr = (value: string): void => {
    originalStderrWrite.call(process.stderr, value)
  }

  function createWrite(stream: CaseOutputStream, onUnscopedOutput: CaseOutputSink): typeof process.stdout.write {
    return (
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | StreamWriteCallback,
      callback?: StreamWriteCallback,
    ): boolean => {
      const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined
      const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback
      const content = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(encoding ?? 'utf-8')
      const sink = storage.getStore() ?? onUnscopedOutput

      sink(stream, content)
      // Writable contract: the callback fires asynchronously once the chunk is handled.
      if (done != null) {
        process.nextTick(done)
      }
      return true
    }
  }

  return {
    restore() {
      process.stdout.write = originalStdoutWrite
      process.stderr.write = originalStderrWrite
    },
    start(onUnscopedOutput) {
      process.stdout.write = createWrite('stdout', onUnscopedOutput)
      process.stderr.write = createWrite('stderr', onUnscopedOutput)
    },
    writeStderr,
    writeStdout,
  }
}

/**
 * Runs one case callback with process output attributed to `sink`.
 *
 * Use when:
 * - the DSL runner executes one case and wants its stdout/stderr grouped per case
 *
 * Expects:
 * - output is captured only while {@link createProcessOutputInterceptor} is active
 * - async work started inside `run` keeps the scope through async context propagation
 *
 * Returns:
 * - the value returned by `run`
 */
export function runWithCaseOutput<T>(sink: CaseOutputSink, run: () => T): T {
  return getCaseOutputStorage().run(sink, run)
}

function getCaseOutputStorage(): AsyncLocalStorage<CaseOutputSink> {
  const processWithStorage = process as typeof process & {
    [caseOutputStorageSymbol]?: AsyncLocalStorage<CaseOutputSink>
  }

  processWithStorage[caseOutputStorageSymbol] ??= new AsyncLocalStorage<CaseOutputSink>()
  return processWithStorage[caseOutputStorageSymbol]
}
