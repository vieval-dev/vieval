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
 * Options for {@link interceptProcessOutput}.
 */
export interface InterceptProcessOutputOptions {
  /**
   * Receives output written outside every case scope.
   *
   * @default writes the chunk to the original stream
   */
  onUnscopedOutput?: CaseOutputSink
}

/**
 * Active process stream interception created by {@link interceptProcessOutput}.
 */
export interface ProcessOutputInterception {
  /**
   * Restores the original `process.stdout.write` and `process.stderr.write`.
   *
   * Safe to call more than once.
   */
  restore: () => void
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
 * - callers call `restore()` once the run settles
 * - `console.*` writes are covered because the global console writes through these streams
 * - child processes that inherit the file descriptors bypass this interception
 *
 * Returns:
 * - a handle with `restore()` plus writers that bypass the interception
 *
 * Call stack:
 *
 * runVievalCli (../../cli/run)
 *   -> {@link interceptProcessOutput}
 *     -> case code writes to `process.stdout`
 *       -> {@link CaseOutputSink} from {@link runWithCaseOutput}, or `onUnscopedOutput`
 */
export function interceptProcessOutput(options: InterceptProcessOutputOptions = {}): ProcessOutputInterception {
  const storage = getCaseOutputStorage()
  const originalStdoutWrite = process.stdout.write
  const originalStderrWrite = process.stderr.write
  const writeStdout = (value: string): void => {
    originalStdoutWrite.call(process.stdout, value)
  }
  const writeStderr = (value: string): void => {
    originalStderrWrite.call(process.stderr, value)
  }
  const onUnscopedOutput = options.onUnscopedOutput ?? ((stream, content) => {
    if (stream === 'stderr') {
      writeStderr(content)
      return
    }
    writeStdout(content)
  })

  function createWrite(stream: CaseOutputStream): typeof process.stdout.write {
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

  process.stdout.write = createWrite('stdout')
  process.stderr.write = createWrite('stderr')

  let restored = false
  return {
    restore() {
      if (restored) {
        return
      }
      restored = true
      process.stdout.write = originalStdoutWrite
      process.stderr.write = originalStderrWrite
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
 * - output is captured only while {@link interceptProcessOutput} is active
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
