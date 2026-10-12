import type { StartViewerOptions, ViewerHost } from 'vieval/cli'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { serve } from 'srvx'

import { createViewerApp } from './server/app'
import { createEvidenceService } from './server/evidence'
import { createRunStore } from './server/store'

export type { CreateViewerAppOptions } from './server/app'
export { createViewerApp } from './server/app'
export { createEventTail, parseEventLine } from './server/event-tail'
export type { EvidenceService, EvidenceServiceOptions } from './server/evidence'
export { createEvidenceService, DEFAULT_EVIDENCE_METRIC_PATTERNS } from './server/evidence'
export type { CreateRunStoreOptions, RunHandle, RunStore } from './server/store'
export { createRunStore, DEFAULT_STALE_AFTER_MS } from './server/store'
export * from './shared/contract'

/**
 * Viewer options beyond the host contract of `vieval` (`StartViewerOptions`).
 */
export interface ViewerOptions extends StartViewerOptions {
  /** Directory of the built web UI. Defaults to `client/` next to this module. */
  clientDirectory?: string
  /** Metric name patterns that hold evidence paths. @default ['*.evidence'] */
  evidenceMetricPatterns?: string[]
  /** Extra directories with `*.jsonl` command logs. `<report root>/../logs` is always scanned. */
  logDirectories?: string[]
}

/**
 * Starts the viewer server.
 *
 * Use when:
 * - `vieval run --with-viewer` attaches runs in-process (`mode: 'live'`, via {@link ViewerHost.attachRun})
 * - `vieval viewer <reportRoot>` browses report directories, tailing runs that are still being written
 *   (`mode: 'static'`)
 *
 * Expects:
 * - `host` / `port` free to bind; port `0` picks a free port
 *
 * Returns:
 * - a host whose `url` is ready to open; `close()` stops the server and every file watcher
 */
export async function startViewer(options: ViewerOptions): Promise<ViewerHost> {
  const reportRoots = options.reportRoots.map(root => resolve(root))
  const vievalDirectories = reportRoots.map(root => dirname(root))
  const evidenceRoots = unique([...vievalDirectories, ...(options.evidenceRoots ?? []).map(root => resolve(root))])
  const logDirectories = unique([...vievalDirectories.map(directory => join(directory, 'logs')), ...(options.logDirectories ?? []).map(directory => resolve(directory))])
  const store = createRunStore({ reportRoots, staleAfterMs: options.staleAfterMs })
  const evidence = createEvidenceService({ evidenceRoots, logDirectories, metricPatterns: options.evidenceMetricPatterns })
  const app = createViewerApp({
    allowedHosts: allowedHostsFor(options.host),
    clientDirectory: options.clientDirectory ?? join(dirname(fileURLToPath(import.meta.url)), 'client'),
    evidence,
    mode: options.mode,
    store,
  })

  const server = serve({
    fetch: app.fetch,
    gracefulShutdown: false,
    hostname: options.host,
    port: options.port,
    silent: true,
  })
  await server.ready()
  const url = server.url ?? `http://${options.host}:${options.port}/`

  let resolveClosed!: () => void
  const closed = new Promise<void>((resolvePromise) => {
    resolveClosed = resolvePromise
  })
  let closing: Promise<void> | undefined

  if (options.open) {
    openBrowser(url)
  }

  return {
    async attachRun(context) {
      const { dispose } = store.attachLive(context)
      return dispose
    },
    close() {
      closing ??= (async () => {
        store.close()
        await server.close(true)
        resolveClosed()
      })()
      return closing
    },
    url,
    waitUntilClosed: () => closed,
  }
}

/**
 * Host names accepted in the `Host` header: loopback names when bound to loopback, anything when bound to all
 * interfaces, otherwise the bound name plus loopback names.
 */
function allowedHostsFor(host: string): string[] | undefined {
  if (host === '0.0.0.0' || host === '::' || host === '') {
    return undefined
  }
  return unique(['localhost', '127.0.0.1', '::1', host.toLowerCase()])
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref()
  }
  catch {}
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
