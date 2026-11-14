import type { ExternalLogsResponse, JsonlPage, RunListItem } from '../../src/shared/contract'
import type { PublishedCatalog, PublishedComparison, PublishedRun } from '../../src/shared/publishedReport'
import type { CaseRef, FileLocation } from './api'

import { buildMatrix, compareAttempts, compareExperiments, compareRuns, inScope } from '../../src/shared/compare'
import { buildLogs } from '../../src/shared/logs'
import { CATALOG_PATH, fileKey, runDataPath, telemetryPath } from '../../src/shared/publishedReport'
import { ApiError } from './apiError'

/**
 * Reads a static Viewer publication using paths relative to the site.
 *
 * Use when:
 * - the Viewer is served alongside a Nitro-generated catalog and run files
 *
 * Returns:
 * - the read operations used by the Viewer, with data cached for the life of the page
 */
export function openPublishedReport(base: URL) {
  const cache = new Map<string, Promise<unknown>>()
  const runs = new Map<string, PublishedRun>()
  const lines = new Map<string, Promise<{ partialTail: boolean, rows: unknown[] }>>()
  async function read<T>(path: string): Promise<T> {
    let pending = cache.get(path)
    if (pending == null) {
      pending = fetch(new URL(path, base)).then(async (response) => {
        if (!response.ok)
          throw new ApiError(response.status, 'This resource was not included in the published report.')
        return response.json()
      }).catch((error) => {
        cache.delete(path)
        throw error
      })
      cache.set(path, pending)
    }
    return await pending as T
  }

  async function catalog(): Promise<RunListItem[]> {
    const data = await read<PublishedCatalog>(CATALOG_PATH)
    if (data.version !== 1)
      throw new ApiError(422, 'This report needs the Viewer that was published with it.')
    return data.runs
  }

  function indexOf(items: RunListItem[], runKey: string): number {
    const index = items.findIndex(item => item.runKey === runKey)
    if (index < 0)
      throw new ApiError(404, 'This run was not included in the published report.')
    return index
  }

  async function run(runKey: string): Promise<PublishedRun> {
    const data = await read<PublishedRun>(runDataPath(indexOf(await catalog(), runKey), 'run'))
    runs.set(runKey, data)
    return data
  }

  async function task(runKey: string, taskId: string) {
    const data = await run(runKey)
    if (!Object.hasOwn(data.tasks, taskId))
      throw new ApiError(404, 'Task not found.')
    return data.tasks[taskId]
  }

  async function caseData(runKey: string, ref: CaseRef) {
    const { cases } = await task(runKey, ref.taskId)
    if (!Object.hasOwn(cases, ref.caseId))
      throw new ApiError(404, 'Case not found.')
    return cases[ref.caseId]
  }

  async function comparison(item: RunListItem, index: number) {
    const data = await read<PublishedComparison>(runDataPath(index, 'comparison'))
    return { ...data, item }
  }

  async function comparisonsInScope(scope: Parameters<typeof inScope>[1]) {
    return Promise.all((await catalog()).flatMap((item, index) => inScope(item, scope) ? [comparison(item, index)] : []))
  }

  function rawUrl(location: FileLocation): string {
    const path = runs.get(location.runKey)?.files[fileKey(location.path, location.linkId)]
    if (path == null)
      throw new ApiError(404, 'This file was not included in the published report.')
    return new URL(path, base).href
  }

  return {
    async case(runKey: string, ref: CaseRef) {
      return (await caseData(runKey, ref)).detail
    },
    async compare(view: 'attempts' | 'experiments' | 'runs', query: Record<string, string | undefined>) {
      if (view === 'runs') {
        const keys = (query.runs ?? '').split(',').map(key => key.trim()).filter(Boolean)
        if (keys.length < 2)
          throw new ApiError(400, 'Choose at least two runs to compare.')
        const items = await catalog()
        const indexes = keys.map(key => indexOf(items, key))
        return compareRuns(await Promise.all(indexes.map(index => comparison(items[index], index))))
      }
      const scope = { experiment: query.experiment ?? '', project: query.project ?? '', workspace: query.workspace ?? '' }
      const filter = view === 'attempts' ? scope : { project: scope.project, workspace: scope.workspace }
      const data = await comparisonsInScope(filter)
      return view === 'attempts' ? compareAttempts(data, scope) : compareExperiments(data, scope)
    },
    async evidenceTimeline(runKey: string, linkId: string) {
      return (await run(runKey)).evidenceViews[linkId]?.timeline ?? { frames: [] }
    },
    async evidenceTree(runKey: string, linkId: string) {
      const view = (await run(runKey)).evidenceViews[linkId]
      if (view == null)
        throw new ApiError(404, 'This evidence directory was not included in the published report.')
      return view.tree
    },
    async externalLogs(runKey: string, ref: CaseRef, offset: number, limit: number): Promise<ExternalLogsResponse> {
      const data = (await caseData(runKey, ref)).externalLogs ?? { correlation: { keys: [], podNames: [], window: {} }, files: [], lines: [], nextOffset: null, total: 0 }
      const end = offset + limit
      return { ...data, lines: data.lines.slice(offset, end), nextOffset: end < data.lines.length ? end : null }
    },
    async jsonl(location: FileLocation, offset: number, limit: number): Promise<JsonlPage> {
      const url = rawUrl(location)
      let pending = lines.get(url)
      if (pending == null) {
        pending = fetch(url).then(async (response) => {
          if (!response.ok)
            throw new ApiError(response.status, 'Cannot read the published file.')
          const rows = (await response.text()).split('\n')
          const partialTail = rows.pop() !== ''
          return {
            partialTail,
            rows: rows.map((row) => {
              if (row.trim().length === 0)
                return undefined
              try {
                return JSON.parse(row) as unknown
              }
              catch {
                return { $error: 'Invalid JSON', $raw: row }
              }
            }),
          }
        }).catch((error) => {
          lines.delete(url)
          throw error
        })
        lines.set(url, pending)
      }
      const data = await pending
      return { limit, offset, partialTail: data.partialTail, rows: data.rows.slice(offset, offset + limit).filter(row => row !== undefined), totalLines: data.rows.length }
    },
    async logs(runKey: string, query: Parameters<typeof buildLogs>[1]) {
      return buildLogs((await run(runKey)).logs, query)
    },
    async matrix(scope: Parameters<typeof inScope>[1]) {
      return buildMatrix(await comparisonsInScope(scope))
    },
    async metrics(runKey: string, ref: Partial<CaseRef> = {}) {
      return ref.taskId == null ? (await run(runKey)).metrics : (await task(runKey, ref.taskId)).metrics
    },
    async otelLogs(runKey: string) {
      return (await run(runKey)).otel.logs
    },
    async otelMetrics(runKey: string) {
      return (await run(runKey)).otel.metrics
    },
    async otelRaw(runKey: string, signal: 'logs' | 'metrics' | 'traces') {
      return read<unknown>(telemetryPath(indexOf(await catalog(), runKey), signal))
    },
    async otelTraces(runKey: string) {
      return (await run(runKey)).otel.traces
    },
    async progress(runKey: string) {
      return (await run(runKey)).progress
    },
    rawUrl,
    async run(runKey: string) {
      const items = await catalog()
      return items[indexOf(items, runKey)]
    },
    runs: catalog,
    async scores(runKey: string) {
      return (await run(runKey)).scores
    },
    async snapshot(runKey: string) {
      return (await run(runKey)).snapshot
    },
    async timeline(runKey: string, ref: Partial<CaseRef>) {
      if (ref.taskId == null)
        return (await run(runKey)).timeline
      return ref.caseId == null
        ? (await task(runKey, ref.taskId)).timeline
        : (await caseData(runKey, { caseId: ref.caseId, taskId: ref.taskId })).timeline
    },
  }
}
