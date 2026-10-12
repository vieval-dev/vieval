import type { RunEvent } from '../shared/contract'

import { Buffer } from 'node:buffer'
import { open, stat } from 'node:fs/promises'

import { RUN_EVENT_SCHEMA_VERSION } from 'vieval/events'

import * as v from 'valibot'

import { runEventSchema } from '../shared/contract'

/**
 * Incremental reader of an `events.jsonl` that another process may still be appending to.
 */
export interface EventTail {
  /** Byte offset up to which complete lines were consumed. */
  offset: () => number
  read: () => Promise<EventTailRead>
}

/**
 * Result of one {@link EventTail.read}.
 */
export interface EventTailRead {
  /** Valid envelopes of the current schema version, in file order. */
  envelopes: RunEvent[]
  /** A line of event schema version 1 was seen: the file is a legacy report. */
  legacy: boolean
  /** Complete lines that were not valid envelopes. */
  parseErrors: number
  /** Bytes after the last newline, kept for the next read (a line still being written). */
  partialBytes: number
  /** The file shrank or was replaced: the caller must discard state built from earlier reads. */
  reset: boolean
}

/**
 * Creates a byte-offset tail of one `events.jsonl`.
 *
 * Use when:
 * - a run is still being written by another process (only `events.jsonl` exists), or a finished run is loaded
 *
 * Expects:
 * - the writer appends one JSON envelope plus `\n` per event (`createReportEventLog`)
 *
 * Returns:
 * - a reader that returns only complete lines, keeps a trailing half line for the next read, and restarts from
 *   byte 0 when the file shrank or its inode changed
 *
 * NOTICE:
 * `readReportEvents` from vieval reads the whole file and throws on the first invalid line, which is correct for
 * finished runs but fails on a half-written last line. This reader never throws for content; it counts bad lines.
 */
export function createEventTail(filePath: string): EventTail {
  let offset = 0
  let pending: Buffer = Buffer.alloc(0)
  let identity: string | undefined

  return {
    offset: () => offset,
    async read() {
      const result: EventTailRead = { envelopes: [], legacy: false, parseErrors: 0, partialBytes: 0, reset: false }
      const info = await stat(filePath).catch(() => undefined)
      if (info == null) {
        return result
      }
      const currentIdentity = `${info.ino}:${info.birthtimeMs}`
      if ((identity != null && identity !== currentIdentity) || info.size < offset) {
        offset = 0
        pending = Buffer.alloc(0)
        result.reset = true
      }
      identity = currentIdentity
      if (info.size === offset) {
        result.partialBytes = pending.length
        return result
      }

      const handle = await open(filePath, 'r')
      let chunk: Buffer
      try {
        chunk = Buffer.alloc(info.size - offset)
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset)
        chunk = chunk.subarray(0, bytesRead)
      }
      finally {
        await handle.close()
      }
      offset += chunk.length

      const combined = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
      const lastNewline = combined.lastIndexOf(0x0A)
      if (lastNewline === -1) {
        pending = combined
        result.partialBytes = pending.length
        return result
      }
      // Bytes, not characters: a multi-byte UTF-8 character split across reads stays intact in `pending`.
      const complete = combined.subarray(0, lastNewline).toString('utf-8')
      pending = Buffer.from(combined.subarray(lastNewline + 1))
      result.partialBytes = pending.length

      for (const line of complete.split('\n')) {
        if (line.trim().length === 0) {
          continue
        }
        const parsed = parseEventLine(line)
        if (parsed === 'legacy') {
          result.legacy = true
        }
        else if (parsed == null) {
          result.parseErrors += 1
        }
        else {
          result.envelopes.push(parsed)
        }
      }
      return result
    },
  }
}

/**
 * Parses one `events.jsonl` line without throwing.
 *
 * Returns:
 * - the envelope for the current schema version
 * - `'legacy'` for schema version 1 lines
 * - `undefined` for anything else
 */
export function parseEventLine(line: string): 'legacy' | RunEvent | undefined {
  let value: unknown
  try {
    value = JSON.parse(line)
  }
  catch {
    return undefined
  }
  const version = (value as null | { schemaVersion?: unknown })?.schemaVersion
  if (version === 1) {
    return 'legacy'
  }
  if (version !== RUN_EVENT_SCHEMA_VERSION) {
    return undefined
  }
  const result = v.safeParse(runEventSchema, value)
  return result.success ? result.output : undefined
}
