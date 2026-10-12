import type {
  ArtifactDescriptor,
  CaseDetail,
  ComparisonResponse,
  EvidenceLink,
  ExternalLogsResponse,
  FileTreeResponse,
  ImagePreview,
  JsonlPage,
  LogsResponse,
  MatrixResponse,
  MetricsResponse,
  OtelLogsResponse,
  OtelMetricsResponse,
  OtelTracesResponse,
  ProgressResponse,
  RunListItem,
  RunSnapshot,
  ScoresResponse,
  ScreenshotTimeline,
  TaskNode,
  TimelineResponse,
  TreeResponse,
} from '../../src/shared/contract'

/**
 * Error of one viewer API request.
 *
 * `status` is the HTTP status, or `0` when the server could not be reached at all.
 */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Base of every API route; the UI is served by the same server, so it is relative to the page. */
const base = new URL('api/', document.baseURI)

/** Ids of one case inside a run, passed as query parameters (they contain encoded characters). */
export interface CaseRef { caseId: string, taskId: string }

async function get<T>(path: string, query?: Record<string, number | string | undefined>, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url(path, query), init)
  }
  catch {
    throw new ApiError(0, 'Cannot reach the viewer server. Is `vieval viewer` (or `vieval run --with-viewer`) still running?')
  }
  if (!response.ok) {
    // The server answers `{ status, message }` for every handled error.
    const body = await response.json().catch(() => undefined) as undefined | { message?: string }
    throw new ApiError(response.status, body?.message ?? `${response.status} ${response.statusText}`)
  }
  return await response.json() as T
}

function runPath(runKey: string, rest = ''): string {
  return `runs/${encodeURIComponent(runKey)}${rest}`
}

function url(path: string, query: Record<string, number | string | undefined> = {}): string {
  const target = new URL(path.replace(/^\//, ''), base)
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== '')
      target.searchParams.set(key, String(value))
  }
  return target.toString()
}

/**
 * Typed client of the `@vieval/ui` HTTP API (contract in `API.md` and `src/shared/contract.ts`).
 */
export const api = {
  artifacts: (runKey: string, ref: Partial<CaseRef>) => get<ArtifactDescriptor[]>(runPath(runKey, '/artifacts'), ref),
  case: (runKey: string, ref: CaseRef) => get<CaseDetail>(runPath(runKey, '/case'), { ...ref }),
  compare: (view: 'attempts' | 'experiments' | 'runs', query: Record<string, string | undefined>) => get<ComparisonResponse>(`compare/${view}`, query),
  evidence: (runKey: string, ref: Partial<CaseRef>) => get<EvidenceLink[]>(runPath(runKey, '/evidence'), ref),
  evidenceTimeline: (runKey: string, linkId: string) => get<ScreenshotTimeline>(runPath(runKey, `/evidence/${encodeURIComponent(linkId)}/timeline`)),
  evidenceTree: (runKey: string, linkId: string) => get<FileTreeResponse>(runPath(runKey, `/evidence/${encodeURIComponent(linkId)}/tree`)),
  externalLogs: (runKey: string, ref: CaseRef, offset: number, limit: number) => get<ExternalLogsResponse>(runPath(runKey, '/case/external-logs'), { ...ref, limit, offset }),
  logs: (runKey: string, query: Partial<CaseRef> & { limit: number, offset: number, stream?: string }) => get<LogsResponse>(runPath(runKey, '/logs'), query),
  /** Matrix of every run in a scope (`GET /api/matrix`). */
  matrix: (scope: { experiment?: string, project?: string, workspace?: string }) => get<MatrixResponse>('matrix', scope),
  metrics: (runKey: string, ref: Partial<CaseRef> = {}) => get<MetricsResponse>(runPath(runKey, '/metrics'), ref),
  otelLogs: (runKey: string) => get<OtelLogsResponse>(runPath(runKey, '/otel/logs')),
  otelMetrics: (runKey: string) => get<OtelMetricsResponse>(runPath(runKey, '/otel/metrics')),
  otelRaw: (runKey: string, signal: 'logs' | 'metrics' | 'traces') => get<unknown>(runPath(runKey, `/otel/raw/${signal}`)),
  otelTraces: (runKey: string) => get<OtelTracesResponse>(runPath(runKey, '/otel/traces')),
  /** Progress and ETA of a run (`GET /api/runs/:runKey/progress`), the numbers of the run page's progress panel. */
  progress: (runKey: string) => get<ProgressResponse>(runPath(runKey, '/progress')),
  run: (runKey: string) => get<RunListItem>(runPath(runKey)),
  runs: () => get<RunListItem[]>('runs'),
  scores: (runKey: string) => get<ScoresResponse>(runPath(runKey, '/scores')),
  snapshot: (runKey: string) => get<RunSnapshot>(runPath(runKey, '/snapshot')),
  task: (runKey: string, taskId: string) => get<TaskNode>(runPath(runKey, '/task'), { taskId }),
  timeline: (runKey: string, ref: Partial<CaseRef>) => get<TimelineResponse>(runPath(runKey, '/timeline'), ref),
  tree: () => get<TreeResponse>('tree'),
}

/**
 * Where one previewable file is read from: a run artifact or a file of an evidence directory.
 *
 * Both are served by routes with the same rules (`raw` with Range, `jsonl` paging), so viewers only need this.
 */
export interface FileLocation {
  linkId?: string
  path: string
  runKey: string
}

/**
 * Reads the size and ThumbHash of an image file, for a blurred placeholder while the image loads.
 *
 * Rejects with {@link ApiError} for files that are not decodable images (`415`); callers show the image without a
 * placeholder then.
 */
export function imagePreview(location: FileLocation): Promise<ImagePreview> {
  const route = location.linkId == null
    ? runPath(location.runKey, '/artifacts/preview')
    : runPath(location.runKey, `/evidence/${encodeURIComponent(location.linkId)}/preview`)
  return get<ImagePreview>(route, { path: location.path })
}

/** Reads `limit` complete lines of a JSONL file from line `offset`. */
export function jsonlPage(location: FileLocation, offset: number, limit: number): Promise<JsonlPage> {
  const route = location.linkId == null
    ? runPath(location.runKey, '/artifacts/jsonl')
    : runPath(location.runKey, `/evidence/${encodeURIComponent(location.linkId)}/jsonl`)
  return get<JsonlPage>(route, { limit, offset, path: location.path })
}

/** Opens the live event stream of a run after `seq`. */
export function openRunStream(runKey: string, after: number): EventSource {
  return new EventSource(url(runPath(runKey, '/stream'), { after }))
}

/** URL of the file's bytes; `download` adds `Content-Disposition: attachment`. */
export function rawUrl(location: FileLocation, download = false): string {
  const route = location.linkId == null
    ? runPath(location.runKey, '/artifacts/raw')
    : runPath(location.runKey, `/evidence/${encodeURIComponent(location.linkId)}/raw`)
  return url(route, { download: download ? 1 : undefined, path: location.path })
}

/**
 * Reads the first `maxBytes` of a file as text with a `Range` request.
 *
 * Returns the text and whether the file is longer than what was read.
 */
export async function readText(location: FileLocation, maxBytes: number): Promise<{ text: string, total: number, truncated: boolean }> {
  let response: Response
  try {
    response = await fetch(rawUrl(location), { headers: { Range: `bytes=0-${maxBytes - 1}` } })
  }
  catch {
    throw new ApiError(0, 'Cannot reach the viewer server.')
  }
  // `416`: the file is empty, so even byte 0 is not satisfiable.
  if (response.status === 416)
    return { text: '', total: 0, truncated: false }
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as undefined | { message?: string }
    throw new ApiError(response.status, body?.message ?? `${response.status} ${response.statusText}`)
  }
  const text = await response.text()
  // `Content-Range: bytes 0-1023/52341` carries the full size of a partial response.
  const total = Number(response.headers.get('content-range')?.split('/')[1] ?? Number.NaN)
  const size = Number.isFinite(total) ? total : text.length
  return { text, total: size, truncated: response.status === 206 && size > maxBytes }
}
