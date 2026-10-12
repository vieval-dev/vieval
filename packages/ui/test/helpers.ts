import type { RunEvent } from '../src/shared/contract'

import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createViewerApp } from '../src/server/app'
import { createEvidenceService } from '../src/server/evidence'
import { createRunStore } from '../src/server/store'

export const fixturesDirectory = fileURLToPath(new URL('./fixtures/', import.meta.url))

/** Run directories of the OSWorld fixture (copied from a real `.vieval`, see `fixtures/README.md`). */
export const OSWORLD_RUNS = {
  /** Interrupted by SIGINT after 18 cases; has `run-summary.json`, `cases.jsonl`, `otlp/`. */
  archived: 'default-workspace/osworld-kubernetes/matrix-run-model-gpt-5.5-repeat-1/attempt-2026-10-11T19-14-05-991Z/run-1791746045991-a77ba0a4',
  /** Event schema version 1. */
  legacy: 'default-workspace/osworld-kubernetes/matrix-run-model-gpt-5.5-repeat-1/attempt-2026-10-10T18-20-50-009Z/run-1791656450009-5299b70e',
  /** Still running when copied: `events.jsonl` only, seq 1..150 of 360 cases. */
  running: 'default-workspace/osworld-kubernetes/matrix-run-model-gpt-5.5-repeat-1/attempt-2026-10-11T19-31-43-580Z/run-1791747103580-dd3a8517',
} as const

export const OSWORLD_TASK_ID = 'evals%2Fosworld%2Feval%2Fosworld::default::run=model%3Dgpt-5.5%26repeat%3D1::eval=default'

const temporaryDirectories: string[] = []

export interface SseMessage {
  data: string
  event: string
  id?: string
}

export async function cleanupTemporaryDirectories(): Promise<void> {
  await Promise.all(temporaryDirectories.splice(0).map(async directory => rm(directory, { force: true, recursive: true })))
}

/**
 * Copies the OSWorld fixture into a temporary `.vieval` directory and points evidence paths at it.
 */
export async function copyOsworldFixture(): Promise<{ reportRoot: string, vievalDirectory: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'vieval-viewer-test-'))
  temporaryDirectories.push(directory)
  const vievalDirectory = join(directory, '.vieval')
  await cp(join(fixturesDirectory, 'osworld', '.vieval'), vievalDirectory, { recursive: true })
  await replaceInTree(vievalDirectory, '__VIEVAL_DIR__', vievalDirectory)
  return { reportRoot: join(vievalDirectory, 'reports'), vievalDirectory }
}

/**
 * Builds envelopes of one synthetic run for reducer tests.
 */
export function createEnvelopeFactory(runId = 'run-test') {
  let seq = 0
  return (event: string, data: unknown, scope: { caseId?: string, projectId?: string, taskId?: string } = {}, time = new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString()): RunEvent => {
    seq += 1
    return {
      attemptId: 'attempt-a',
      data,
      event,
      experimentId: 'exp-a',
      runId,
      schemaVersion: 2,
      seq,
      time,
      workspaceId: 'ws-a',
      ...scope,
    }
  }
}

/**
 * Creates an empty temporary directory removed by {@link cleanupTemporaryDirectories}.
 */
export async function createTemporaryDirectory(prefix = 'vieval-viewer-test-'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

/**
 * The viewer app over report roots, as `startViewer` builds it, without a network server.
 */
export function createTestApp(options: { clientDirectory?: string, now?: () => number, reportRoots: string[], vievalDirectory?: string }) {
  const store = createRunStore({ reportRoots: options.reportRoots })
  const evidenceRoots = options.vievalDirectory == null ? [] : [options.vievalDirectory]
  const logDirectories = options.vievalDirectory == null ? [] : [join(options.vievalDirectory, 'logs')]
  const evidence = createEvidenceService({ evidenceRoots, logDirectories })
  const app = createViewerApp({ allowedHosts: ['localhost', '127.0.0.1'], clientDirectory: options.clientDirectory, evidence, mode: 'static', now: options.now, store })
  return {
    app,
    async get(path: string, init?: RequestInit) {
      return app.fetch(new Request(`http://localhost${path}`, init))
    },
    async json<T = any>(path: string): Promise<T> {
      const response = await app.fetch(new Request(`http://localhost${path}`))
      if (!response.ok) {
        throw new Error(`${path} -> ${response.status} ${await response.text()}`)
      }
      return await response.json() as T
    },
    store,
  }
}

/**
 * Lines of the running run's real continuation (seq 151..250), with the placeholder replaced.
 */
export async function readRunningContinuation(vievalDirectory: string): Promise<string[]> {
  const text = await readFile(join(fixturesDirectory, 'osworld-running-continuation.jsonl'), 'utf-8')
  return text.replaceAll('__VIEVAL_DIR__', vievalDirectory).split('\n').filter(line => line.length > 0)
}

/**
 * Reads a server-sent events response until `until` returns true or the timeout passes.
 */
export async function readSse(response: Response, until: (messages: SseMessage[]) => boolean, timeoutMs = 10_000): Promise<SseMessage[]> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const messages: SseMessage[] = []
  let buffer = ''
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      const result = await Promise.race([
        reader.read(),
        new Promise<'timeout'>(resolve => setTimeout(resolve, Math.max(1, deadline - Date.now()), 'timeout')),
      ])
      if (result === 'timeout' || result.done) {
        break
      }
      buffer += decoder.decode(result.value, { stream: true })
      let separator = buffer.indexOf('\n\n')
      while (separator !== -1) {
        const block = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        const message: SseMessage = { data: '', event: 'message' }
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) {
            message.event = line.slice(7)
          }
          else if (line.startsWith('id: ')) {
            message.id = line.slice(4)
          }
          else if (line.startsWith('data: ')) {
            message.data += line.slice(6)
          }
        }
        if (block.length > 0 && !block.startsWith(':') && !block.startsWith('retry:')) {
          messages.push(message)
        }
        separator = buffer.indexOf('\n\n')
      }
      if (until(messages)) {
        break
      }
    }
  }
  finally {
    await reader.cancel().catch(() => {})
  }
  return messages
}

async function replaceInTree(directory: string, search: string, replacement: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await replaceInTree(path, search, replacement)
    }
    else if (['.json', '.jsonl', '.log'].includes(extname(entry.name))) {
      const text = await readFile(path, 'utf-8')
      if (text.includes(search)) {
        await writeFile(path, text.replaceAll(search, replacement))
      }
    }
  }
}
