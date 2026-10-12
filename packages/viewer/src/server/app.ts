import type { H3Event } from 'h3'

import type { EventsResponse, RunEvent, RunListItem, TreeResponse } from '../shared/contract'
import type { EvidenceService } from './evidence'
import type { RunHandle, RunStore } from './store'

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { getQuery, getRouterParam, H3 } from 'h3'

import { VIEWER_API_VERSION } from '../shared/contract'
import { buildTaskNodes } from '../shared/reduce'
import { buildMatrix, compareAttempts, compareExperiments, compareRuns } from './compare'
import { ViewerError } from './errors'
import { contentTypeFromName, listTree, readJsonlPage, resolveInsideRoot, serveFile } from './files'
import { buildOtelLogs, buildOtelMetrics, buildOtelTraces } from './otel'
import { createImagePreviews } from './preview'
import { toRunListItem } from './store'
import { buildCaseDetail, buildLogs, buildMetrics, buildProgress, buildScores, buildSnapshot, buildTask, buildTimeline, findCase, listArtifacts, MAX_LOG_LIMIT } from './views'

/** Most events one `/events` page returns. */
const MAX_EVENTS_LIMIT = 5000
/** Interval of SSE keep-alive comments. */
const SSE_HEARTBEAT_MS = 15_000
/** Minimum interval between two SSE `progress` messages. */
const SSE_PROGRESS_THROTTLE_MS = 500

const PLACEHOLDER_HTML = `<!doctype html><meta charset="utf-8"><title>vieval viewer</title>
<body style="font-family:system-ui;margin:2rem;max-width:48rem">
<h1>vieval viewer</h1>
<p>The API is running. The web UI is not bundled in this build.</p>
<ul><li><a href="/api/health">/api/health</a></li><li><a href="/api/tree">/api/tree</a></li><li><a href="/api/runs">/api/runs</a></li></ul>
<p>See <code>packages/viewer/API.md</code> for the contract.</p></body>`

export interface CreateViewerAppOptions {
  /**
   * Host names accepted in the `Host` header (DNS rebinding protection). `undefined` accepts any host, which
   * is what a server bound to all interfaces needs.
   */
  allowedHosts?: readonly string[]
  /** Built frontend (`index.html` + assets), served at `/` when present. */
  clientDirectory?: string
  evidence: EvidenceService
  mode: 'live' | 'static'
  /** Clock, replaceable in tests. */
  now?: () => number
  store: RunStore
}

/**
 * Creates the H3 app of the viewer: the `/api/*` contract (see `API.md`) and the frontend.
 *
 * Use when:
 * - `startViewer` serves it with srvx, or tests call `app.fetch(new Request(...))` directly
 */
export function createViewerApp(options: CreateViewerAppOptions): H3 {
  const now = options.now ?? Date.now
  const { evidence, store } = options
  const previews = createImagePreviews()

  const app = new H3({
    onError(error) {
      // Errors thrown in handlers reach this hook wrapped in an HTTPError, with the original as `cause`.
      const original: unknown = error.cause ?? error
      const status = original instanceof ViewerError ? original.status : error.unhandled ? 500 : error.status
      const message = original instanceof ViewerError
        ? original.message
        : status === 500 ? `Internal error: ${errorMessageFrom(original) ?? 'unknown error'}` : error.message
      return Response.json({ message, status }, { headers: { 'x-content-type-options': 'nosniff' }, status })
    },
  })

  app.use((event) => {
    if (options.allowedHosts == null) {
      return
    }
    const host = hostnameOf(event.req.headers.get('host'))
    if (host != null && !options.allowedHosts.includes(host)) {
      throw new ViewerError(403, `Host "${host}" is not allowed. Start the viewer with --host to serve other names.`)
    }
  })

  async function runFrom(event: H3Event): Promise<RunHandle> {
    const runKey = param(event, 'runKey')
    const handle = await store.get(runKey)
    if (handle == null) {
      throw new ViewerError(404, `Run "${runKey}" not found.`)
    }
    return handle
  }

  /**
   * Validates `taskId` / `caseId` filters of list routes: an unknown id is a 404, not an empty list.
   */
  function scopeFrom(event: H3Event, handle: RunHandle): { caseId?: string, taskId?: string } {
    const query = getQuery(event) as Record<string, string | undefined>
    const reducer = handle.reducer()
    if (query.taskId != null && !reducer.tasks.has(query.taskId)) {
      throw new ViewerError(404, `Task "${query.taskId}" not found in run "${handle.runKey}".`)
    }
    if (query.caseId != null && ![...reducer.cases.values()].some(reduced => reduced.caseId === query.caseId && (query.taskId == null || reduced.taskId === query.taskId))) {
      throw new ViewerError(404, `Case "${query.caseId}" not found in run "${handle.runKey}".`)
    }
    return { caseId: query.caseId, taskId: query.taskId }
  }

  app.get('/api/health', () => ({
    apiVersion: VIEWER_API_VERSION,
    evidenceRoots: evidence.roots,
    logDirectories: evidence.logDirectories,
    mode: options.mode,
    ok: true,
    reportRoots: store.reportRoots,
  }))

  app.get('/api/tree', async (): Promise<TreeResponse> => {
    const items = (await store.list()).map(handle => toRunListItem(handle, now()))
    const workspaces = new Map<string, Map<string, Map<string, Map<string, typeof items>>>>()
    for (const item of items) {
      const projects = getOrCreate(workspaces, item.workspaceId, () => new Map())
      const experiments = getOrCreate(projects, item.projectSegment, () => new Map())
      const attempts = getOrCreate(experiments, item.experimentId, () => new Map())
      getOrCreate(attempts, item.attemptId, () => []).push(item)
    }
    const sorted = <T>(map: Map<string, T>) => [...map].sort((left, right) => left[0].localeCompare(right[0]))
    return {
      reportRoots: [...store.reportRoots],
      workspaces: sorted(workspaces).map(([id, projects]) => ({
        id,
        projects: sorted(projects).map(([projectId, experiments]) => ({
          experiments: sorted(experiments).map(([experimentId, attempts]) => ({
            attempts: sorted(attempts).map(([attemptId, runs]) => ({
              id: attemptId,
              runs: runs.sort((left, right) => (left.startedAt ?? '').localeCompare(right.startedAt ?? '')),
            })),
            id: experimentId,
          })),
          id: projectId,
        })),
      })),
    }
  })

  app.get('/api/runs', async (event) => {
    const query = getQuery(event) as Record<string, string | undefined>
    return (await store.list())
      .map(handle => toRunListItem(handle, now()))
      .filter(item =>
        inScope(item, query)
        && (query.attempt == null || item.attemptId === query.attempt)
        && (query.state == null || item.state === query.state)
        && (query.source == null || item.source === query.source))
      .sort((left, right) => (right.startedAt ?? '').localeCompare(left.startedAt ?? ''))
  })

  app.get('/api/runs/:runKey', async event => toRunListItem(await runFrom(event), now()))
  app.get('/api/runs/:runKey/snapshot', async event => buildSnapshot(await runFrom(event), evidence, now()))
  app.get('/api/runs/:runKey/progress', async event => buildProgress(await runFrom(event), now()))

  app.get('/api/runs/:runKey/events', async (event): Promise<EventsResponse> => {
    const handle = await runFrom(event)
    const query = getQuery(event) as Record<string, string | undefined>
    const after = intParam(query.after, 'after', 0, 0)
    const limit = intParam(query.limit, 'limit', 1000, 1, MAX_EVENTS_LIMIT)
    const reducer = handle.reducer()
    const events = reducer.events.filter(envelope => envelope.seq > after).slice(0, limit)
    return { events, nextAfter: events.at(-1)?.seq ?? after, seq: reducer.seq() }
  })

  app.get('/api/runs/:runKey/stream', async (event) => {
    const handle = await runFrom(event)
    const query = getQuery(event) as Record<string, string | undefined>
    const lastEventId = event.req.headers.get('last-event-id')
    const after = intParam(query.after ?? lastEventId ?? undefined, 'after', 0, 0)
    return streamRun(event.req, handle, after, now)
  })

  // Task and case ids are passed as query parameters: they already contain URI-encoded characters (`%2F`),
  // which path routing would decode inconsistently.
  app.get('/api/runs/:runKey/task', async (event) => {
    const query = getQuery(event) as Record<string, string | undefined>
    return buildTask(await runFrom(event), evidence, required(query.taskId, 'taskId'))
  })

  app.get('/api/runs/:runKey/case', async (event) => {
    const handle = await runFrom(event)
    const query = getQuery(event) as Record<string, string | undefined>
    return buildCaseDetail(handle, evidence, required(query.taskId, 'taskId'), required(query.caseId, 'caseId'))
  })

  app.get('/api/runs/:runKey/case/external-logs', async (event) => {
    const handle = await runFrom(event)
    const query = getQuery(event) as Record<string, string | undefined>
    const reduced = findCase(handle, required(query.taskId, 'taskId'), required(query.caseId, 'caseId'))
    return evidence.externalLogs(handle.reducer(), reduced, {
      limit: intParam(query.limit, 'limit', 200, 1, 2000),
      offset: intParam(query.offset, 'offset', 0, 0),
    })
  })

  app.get('/api/runs/:runKey/timeline', async (event) => {
    const handle = await runFrom(event)
    return buildTimeline(handle, scopeFrom(event, handle))
  })

  app.get('/api/runs/:runKey/logs', async (event) => {
    const query = getQuery(event) as Record<string, string | undefined>
    if (query.stream != null && query.stream !== 'stdout' && query.stream !== 'stderr') {
      throw new ViewerError(400, '"stream" must be "stdout" or "stderr".')
    }
    const handle = await runFrom(event)
    scopeFrom(event, handle)
    return buildLogs(handle, {
      caseId: query.caseId,
      limit: intParam(query.limit, 'limit', 500, 1, MAX_LOG_LIMIT),
      offset: intParam(query.offset, 'offset', 0, 0),
      round: query.round == null ? undefined : intParam(query.round, 'round', 0, 0),
      stream: query.stream,
      taskId: query.taskId,
    })
  })

  app.get('/api/runs/:runKey/metrics', async (event) => {
    const handle = await runFrom(event)
    return buildMetrics(handle, scopeFrom(event, handle))
  })

  app.get('/api/runs/:runKey/scores', async event => buildScores(await runFrom(event)))

  app.get('/api/runs/:runKey/artifacts', async (event) => {
    const handle = await runFrom(event)
    return listArtifacts(handle, scopeFrom(event, handle))
  })

  app.get('/api/runs/:runKey/artifacts/raw', async (event) => {
    const handle = await runFrom(event)
    const filePath = await resolveInsideRoot(artifactsRootOf(handle), String(getQuery(event).path ?? ''))
    const artifact = [...handle.reducer().cases.values()].flatMap(reduced => reduced.artifacts).find(candidate => filePath.endsWith(candidate.path))
    return serveFile(event.req, filePath, { contentType: artifact?.contentType, download: getQuery(event).download === '1' })
  })

  app.get('/api/runs/:runKey/artifacts/preview', async (event) => {
    const handle = await runFrom(event)
    const filePath = await resolveInsideRoot(artifactsRootOf(handle), String(getQuery(event).path ?? ''))
    const artifact = [...handle.reducer().cases.values()].flatMap(reduced => reduced.artifacts).find(candidate => filePath.endsWith(candidate.path))
    return previews.preview(filePath, artifact?.contentType ?? contentTypeFromName(filePath))
  })

  app.get('/api/runs/:runKey/artifacts/jsonl', async (event) => {
    const handle = await runFrom(event)
    const query = getQuery(event) as Record<string, string | undefined>
    const filePath = await resolveInsideRoot(artifactsRootOf(handle), query.path ?? '')
    return readJsonlPage(filePath, intParam(query.offset, 'offset', 0, 0), intParam(query.limit, 'limit', 100, 1))
  })

  app.get('/api/runs/:runKey/evidence', async (event) => {
    const handle = await runFrom(event)
    return evidence.links(handle.reducer(), scopeFrom(event, handle))
  })

  async function evidenceDirectory(event: H3Event): Promise<{ link: Awaited<ReturnType<EvidenceService['find']>>, root: string }> {
    const handle = await runFrom(event)
    const link = await evidence.find(handle.reducer(), param(event, 'linkId'))
    if (!link.allowed) {
      throw new ViewerError(403, link.reason ?? 'Evidence path is not allowed.')
    }
    if (!link.exists) {
      throw new ViewerError(404, 'Evidence path does not exist.')
    }
    return { link, root: link.realPath }
  }

  app.get('/api/runs/:runKey/evidence/:linkId', async (event) => {
    const { link } = await evidenceDirectory(event)
    const { realPath: _realPath, ...rest } = link
    return rest
  })

  app.get('/api/runs/:runKey/evidence/:linkId/tree', async (event) => {
    const { link, root } = await evidenceDirectory(event)
    if (link.kind !== 'directory') {
      throw new ViewerError(400, 'Evidence link is a file; read it with /raw.')
    }
    return listTree(root)
  })

  app.get('/api/runs/:runKey/evidence/:linkId/raw', async (event) => {
    const { link, root } = await evidenceDirectory(event)
    const query = getQuery(event) as Record<string, string | undefined>
    const filePath = link.kind === 'file' ? root : await resolveInsideRoot(root, query.path ?? '')
    return serveFile(event.req, filePath, { contentType: contentTypeFromName(filePath), download: query.download === '1' })
  })

  app.get('/api/runs/:runKey/evidence/:linkId/jsonl', async (event) => {
    const { link, root } = await evidenceDirectory(event)
    const query = getQuery(event) as Record<string, string | undefined>
    const filePath = link.kind === 'file' ? root : await resolveInsideRoot(root, query.path ?? '')
    return readJsonlPage(filePath, intParam(query.offset, 'offset', 0, 0), intParam(query.limit, 'limit', 100, 1))
  })

  app.get('/api/runs/:runKey/evidence/:linkId/preview', async (event) => {
    const { link, root } = await evidenceDirectory(event)
    const filePath = link.kind === 'file' ? root : await resolveInsideRoot(root, String(getQuery(event).path ?? ''))
    return previews.preview(filePath, contentTypeFromName(filePath))
  })

  app.get('/api/runs/:runKey/evidence/:linkId/timeline', async (event) => {
    const { link } = await evidenceDirectory(event)
    return evidence.screenshotTimeline(link)
  })

  app.get('/api/runs/:runKey/otel/traces', async event => buildOtelTraces(await runFrom(event)))
  app.get('/api/runs/:runKey/otel/logs', async event => buildOtelLogs(await runFrom(event)))
  app.get('/api/runs/:runKey/otel/metrics', async event => buildOtelMetrics(await runFrom(event)))
  app.get('/api/runs/:runKey/otel/raw/:signal', async (event) => {
    const handle = await runFrom(event)
    const signal = param(event, 'signal')
    if (signal !== 'traces' && signal !== 'logs' && signal !== 'metrics') {
      throw new ViewerError(400, '"signal" must be traces, logs, or metrics.')
    }
    if (handle.reportDirectory == null) {
      throw new ViewerError(404, 'Run has no report directory.')
    }
    const filePath = join(handle.reportDirectory, 'otlp', `${signal}.json`)
    if (!existsSync(filePath)) {
      throw new ViewerError(404, `otlp/${signal}.json is written when the run ends.`)
    }
    return serveFile(event.req, filePath, { contentType: 'application/json' })
  })

  app.get('/api/matrix', async (event) => {
    const query = getQuery(event) as Record<string, string | undefined>
    const at = now()
    const runs = (await store.list()).map((handle) => {
      // Built once and shared by the list item and the matrix: building task nodes walks every case.
      const tasks = buildTaskNodes(handle.reducer(), () => 0)
      return { item: toRunListItem(handle, at, tasks), tasks }
    })
    return buildMatrix(runs.filter(run => inScope(run.item, query)))
  })
  app.get('/api/compare/experiments', async (event) => {
    const query = getQuery(event) as Record<string, string | undefined>
    return compareExperiments(await store.list(), { project: required(query.project, 'project'), workspace: required(query.workspace, 'workspace') }, now())
  })

  app.get('/api/compare/attempts', async (event) => {
    const query = getQuery(event) as Record<string, string | undefined>
    return compareAttempts(await store.list(), {
      experiment: required(query.experiment, 'experiment'),
      project: required(query.project, 'project'),
      workspace: required(query.workspace, 'workspace'),
    }, now())
  })

  app.get('/api/compare/runs', async (event) => {
    const keys = required((getQuery(event) as Record<string, string | undefined>).runs, 'runs').split(',').map(key => key.trim()).filter(Boolean)
    if (keys.length < 2) {
      throw new ViewerError(400, '"runs" needs at least two comma-separated run keys.')
    }
    const handles = await Promise.all(keys.map(async (key) => {
      const handle = await store.get(key)
      if (handle == null) {
        throw new ViewerError(404, `Run "${key}" not found.`)
      }
      return handle
    }))
    return compareRuns(handles, now())
  })

  app.all('/api/**', () => {
    throw new ViewerError(404, 'Unknown API route.')
  })

  app.get('/**', async (event) => {
    const directory = options.clientDirectory
    if (directory != null && existsSync(join(directory, 'index.html'))) {
      const pathname = event.url.pathname.replace(/^\/+/, '')
      if (pathname.length > 0) {
        try {
          return await serveFile(event.req, await resolveInsideRoot(directory, decodeURIComponent(pathname)), { trusted: true })
        }
        catch (error) {
          if (!(error instanceof ViewerError) || error.status !== 404) {
            throw error
          }
        }
      }
      // SPA fallback.
      return serveFile(event.req, join(directory, 'index.html'), { contentType: 'text/html; charset=utf-8', trusted: true })
    }
    return new Response(PLACEHOLDER_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  })

  return app
}

function artifactsRootOf(handle: RunHandle): string {
  const root = handle.artifactsRoot()
  if (root == null) {
    throw new ViewerError(404, 'Run has no artifacts directory.')
  }
  return root
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key)
  if (value === undefined) {
    value = create()
    map.set(key, value)
  }
  return value
}

function hostnameOf(header: null | string): string | undefined {
  if (header == null || header.length === 0) {
    return undefined
  }
  if (header.startsWith('[')) {
    return header.slice(1, header.indexOf(']'))
  }
  return header.split(':')[0].toLowerCase()
}

/**
 * Whether a run belongs to the hierarchy scope of the optional `workspace`, `project`, and `experiment` filters.
 * A project matches the report path segment or any project the run executed (multi-project runs).
 */
function inScope(item: RunListItem, query: Record<string, string | undefined>): boolean {
  return (query.workspace == null || item.workspaceId === query.workspace)
    && (query.project == null || item.projectSegment === query.project || item.projectIds.includes(query.project))
    && (query.experiment == null || item.experimentId === query.experiment)
}

function intParam(value: string | undefined, name: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (value == null || value === '') {
    return fallback
  }
  if (!/^-?\d+$/.test(value)) {
    throw new ViewerError(400, `"${name}" must be an integer.`)
  }
  const parsed = Number(value)
  if (parsed < min || parsed > max) {
    throw new ViewerError(400, `"${name}" must be between ${min} and ${max}.`)
  }
  return parsed
}

function param(event: H3Event, name: string): string {
  const value = getRouterParam(event, name)
  if (value == null || value.length === 0) {
    throw new ViewerError(400, `Missing "${name}".`)
  }
  return value
}

function required(value: string | undefined, name: string): string {
  if (value == null || value.length === 0) {
    throw new ViewerError(400, `Missing query parameter "${name}".`)
  }
  return value
}

/**
 * Server-sent events of one run.
 *
 * Messages:
 * - `run-event` (`id: <seq>`): one envelope, in `seq` order, starting after `after` / `Last-Event-ID`
 * - `progress`: `{ progress, current, state, seq }`, throttled
 * - `reset`: the run was rebuilt from scratch (file replaced); refetch the snapshot
 * - `end`: the run reached a terminal state; the server closes the stream after it
 */
function streamRun(request: Request, handle: RunHandle, after: number, now: () => number): Response {
  const encoder = new TextEncoder()
  let cleanup = () => {}
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cleanup()
    },
    start(controller) {
      let closed = false
      let lastSent = after
      let progressTimer: ReturnType<typeof setTimeout> | undefined
      let lastProgressAt = 0
      const send = (text: string) => {
        if (!closed) {
          controller.enqueue(encoder.encode(text))
        }
      }
      const sendEnvelope = (envelope: RunEvent) => {
        if (envelope.seq <= lastSent) {
          return
        }
        lastSent = envelope.seq
        send(`id: ${envelope.seq}\nevent: run-event\ndata: ${JSON.stringify(envelope)}\n\n`)
      }
      const sendProgress = () => {
        progressTimer = undefined
        lastProgressAt = Date.now()
        send(`event: progress\ndata: ${JSON.stringify(buildProgress(handle, now()))}\n\n`)
      }
      const scheduleProgress = () => {
        if (progressTimer != null) {
          return
        }
        const wait = Math.max(0, SSE_PROGRESS_THROTTLE_MS - (Date.now() - lastProgressAt))
        progressTimer = setTimeout(sendProgress, wait)
      }
      const isTerminal = () => {
        const state = handle.state(now())
        return state !== 'running' && state !== 'stale'
      }
      const finish = () => {
        if (closed) {
          return
        }
        sendProgress()
        send(`event: end\ndata: ${JSON.stringify({ seq: handle.reducer().seq(), state: handle.state(now()) })}\n\n`)
        cleanup()
        try {
          controller.close()
        }
        catch {}
      }

      send('retry: 2000\n\n')
      for (const envelope of handle.reducer().events) {
        sendEnvelope(envelope)
      }
      if (isTerminal()) {
        finish()
        return
      }
      sendProgress()

      const unsubscribe = handle.subscribe((update) => {
        if (update.reset) {
          lastSent = 0
          send(`event: reset\ndata: {}\n\n`)
          for (const envelope of handle.reducer().events) {
            sendEnvelope(envelope)
          }
        }
        for (const envelope of update.envelopes) {
          sendEnvelope(envelope)
        }
        if (isTerminal()) {
          finish()
          return
        }
        scheduleProgress()
      })
      const heartbeat = setInterval(() => {
        send(': ping\n\n')
        // Elapsed time and the current position change without events.
        scheduleProgress()
      }, SSE_HEARTBEAT_MS)
      const onAbort = () => {
        cleanup()
        try {
          controller.close()
        }
        catch {}
      }
      request.signal?.addEventListener('abort', onAbort)
      cleanup = () => {
        closed = true
        unsubscribe()
        clearInterval(heartbeat)
        if (progressTimer != null) {
          clearTimeout(progressTimer)
        }
        request.signal?.removeEventListener('abort', onAbort)
      }
    },
  })
  return new Response(stream, {
    headers: {
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
      'x-accel-buffering': 'no',
    },
  })
}
