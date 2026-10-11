import type { WriteStream } from 'node:fs'

import type { RunEventEnvelope } from '../events'

import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import * as v from 'valibot'

import { RUN_EVENT_SCHEMA_VERSION, runEventEnvelopeSchema } from '../events'

/**
 * Append-only `events.jsonl` writer for one run.
 */
export interface ReportEventLog {
  /**
   * Appends one envelope as one JSON line. Appends after `close()` are ignored.
   */
  append: (envelope: RunEventEnvelope) => void
  /**
   * Flushes pending writes and closes the file. Safe to call more than once.
   */
  close: () => Promise<void>
  /**
   * Absolute path of the log file.
   */
  filePath: string
}

/**
 * Creates the live event log of one run.
 *
 * Use when:
 * - run events must reach disk while the run is in progress, so a crash keeps what already happened
 *
 * Expects:
 * - one log per run, fed by the run event bus, which already assigned each envelope its `seq`
 * - `close()` runs before anything reads the file back
 *
 * Returns:
 * - a writer that appends one JSON line per envelope, in append order
 */
export function createReportEventLog(filePath: string): ReportEventLog {
  mkdirSync(dirname(filePath), { recursive: true })
  // A write stream keeps lines in append order without blocking the run on every event.
  const stream: WriteStream = createWriteStream(filePath, { encoding: 'utf-8', flags: 'a' })
  let closing: Promise<void> | undefined
  let streamError: unknown
  // Without a listener, a write error (for example a full disk) would crash the process; it is reported by `close()`.
  stream.on('error', (error) => {
    streamError ??= error
  })

  return {
    append(envelope) {
      if (closing != null || streamError != null) {
        return
      }
      stream.write(`${JSON.stringify(envelope)}\n`)
    },
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        const settle = () => streamError == null ? resolve() : reject(streamError)
        if (stream.destroyed) {
          settle()
          return
        }
        // `close` follows both a normal finish and a destroy after an error.
        stream.once('close', settle)
        stream.end()
      })
      return closing
    },
    filePath,
  }
}

/**
 * Reads every envelope from an `events.jsonl` file.
 *
 * Use when:
 * - report summaries or analysis commands need the events of a finished run
 *
 * Expects:
 * - one JSON envelope of the current report schema per non-empty line
 *
 * Returns:
 * - envelopes in file order, or an empty list when the file does not exist
 * - throws when a line belongs to another report schema version
 */
export function readReportEvents(filePath: string): RunEventEnvelope[] {
  if (!existsSync(filePath)) {
    return []
  }

  return readFileSync(filePath, 'utf-8')
    .split('\n')
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, lineNumber }) => {
      const result = v.safeParse(runEventEnvelopeSchema, JSON.parse(line))
      if (!result.success) {
        throw new Error(`Unsupported event record at ${filePath}:${lineNumber}: expected report schema version ${RUN_EVENT_SCHEMA_VERSION}. Reports written by older vieval versions cannot be read; re-run the eval to regenerate them.`)
      }
      return result.output
    })
}
