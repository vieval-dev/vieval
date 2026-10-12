import type { EvidenceLink, ExternalLogsResponse, ScreenshotTimeline } from '../shared/contract'
import type { ReducedCase, RunReducer } from '../shared/reduce'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { escapeRegExp, pick } from 'es-toolkit'

import * as v from 'valibot'

import { ViewerError } from './errors'
import { isAllowedPath, parseJsonText } from './files'

/** Metric names treated as evidence links by default: any `<prefix>.evidence`. */
export const DEFAULT_EVIDENCE_METRIC_PATTERNS = ['*.evidence']

/**
 * One `auv-runs/records.jsonl` line of an AUV artifact. Other record types do not match and are skipped.
 */
const auvArtifactLineSchema = v.looseObject({
  record: v.looseObject({
    metadata: v.looseObject({
      content_type: v.string(),
      file_extension: v.optional(v.string()),
      purpose: v.optional(v.string()),
      uri: v.string(),
    }),
    occurred_at: v.optional(v.unknown()),
    type: v.literal('artifact'),
  }),
})

/**
 * OSWorld episode `result.json`. `taskId` and `podName` tell it apart from other `result.json` files.
 */
const osworldResultSchema = v.looseObject({
  agent: v.optional(v.looseObject({
    lastAction: v.optional(v.unknown()),
    runIds: v.optional(v.array(v.unknown())),
    steps: v.optional(v.array(v.unknown())),
  })),
  podName: v.string(),
  taskId: v.string(),
})

/** Metric names that carry the pod of a case, used to narrow log correlation. */
const POD_METRIC_NAMES = ['osworld.pod']

/**
 * Evidence links of a run, plus the files and logs they point to.
 */
export interface EvidenceService {
  /** Number of links per case key, without touching the disk. */
  countByCase: (reducer: RunReducer) => Map<string, number>
  /** Command logs from the log directories that belong to one case. */
  externalLogs: (reducer: RunReducer, reduced: ReducedCase, page: { limit: number, offset: number }) => Promise<ExternalLogsResponse>
  /** Resolves a link id to its link, or throws 404. */
  find: (reducer: RunReducer, linkId: string) => Promise<EvidenceLink & { realPath: string }>
  /** Links of a run (optionally one case), described against the allowed roots. */
  links: (reducer: RunReducer, filter?: { caseId?: string, taskId?: string }) => Promise<EvidenceLink[]>
  logDirectories: readonly string[]
  roots: readonly string[]
  /** OSWorld/AUV screenshot frames of an evidence directory, in recording order. */
  screenshotTimeline: (link: EvidenceLink & { realPath: string }) => Promise<ScreenshotTimeline>
}

export interface EvidenceServiceOptions {
  /** Directories evidence paths must be inside (after symlinks). */
  evidenceRoots: readonly string[]
  /** Directories scanned for `*.jsonl` command logs. */
  logDirectories: readonly string[]
  /** Glob-like patterns (`*` wildcard) of metric names that hold evidence paths. */
  metricPatterns?: readonly string[]
}

interface CachedDescription {
  adapter: EvidenceLink['adapter']
  allowed: boolean
  exists: boolean
  kind: EvidenceLink['kind']
  realPath: string
  reason?: string
  summary?: Record<string, unknown>
}

interface LogFileIndex {
  byCaseId: Map<string, LogMatch[]>
  identity: string
  lineCount: number
  scannedBytes: number
}

interface LogMatch {
  length: number
  line: number
  offset: number
  podName?: string
  time?: string
}

/**
 * Creates the evidence service.
 *
 * Use when:
 * - an eval stores evidence outside vieval's `artifacts/` and records its location with a metric
 *   (`recordMetric('osworld.evidence', '/abs/path')`)
 *
 * Expects:
 * - evidence metric values are absolute paths; anything else is ignored
 *
 * Returns:
 * - a service that never serves a path outside `evidenceRoots` (links outside get `allowed: false`)
 */
export function createEvidenceService(options: EvidenceServiceOptions): EvidenceService {
  const patterns = (options.metricPatterns ?? DEFAULT_EVIDENCE_METRIC_PATTERNS).map(globToRegExp)
  const descriptions = new Map<string, CachedDescription>()
  const logIndexes = new Map<string, LogFileIndex>()
  /** Index builds in progress, so concurrent readers of one log file join one scan instead of scanning it twice. */
  const logIndexBuilds = new Map<string, Promise<LogFileIndex>>()

  function rawLinks(reducer: RunReducer): Array<Omit<EvidenceLink, 'adapter' | 'allowed' | 'exists' | 'kind'>> {
    const seen = new Set<string>()
    const links: Array<Omit<EvidenceLink, 'adapter' | 'allowed' | 'exists' | 'kind'>> = []
    for (const metric of reducer.metrics) {
      if (metric.taskId == null || metric.caseId == null || typeof metric.value !== 'string') {
        continue
      }
      if (!patterns.some(pattern => pattern.test(metric.name)) || !metric.value.startsWith('/')) {
        continue
      }
      const id = createHash('sha1').update(`${metric.taskId}\0${metric.caseId}\0${metric.name}\0${metric.value}`).digest('hex').slice(0, 16)
      if (seen.has(id)) {
        continue
      }
      seen.add(id)
      links.push({ caseId: metric.caseId, id, metricName: metric.name, path: metric.value, roundIndex: metric.roundIndex, taskId: metric.taskId })
    }
    return links
  }

  async function describe(path: string): Promise<CachedDescription> {
    const cached = descriptions.get(path)
    if (cached?.exists === true && cached.adapter === 'osworld') {
      return cached
    }
    const check = await isAllowedPath(options.evidenceRoots, path)
    if (!check.allowed) {
      const description: CachedDescription = { adapter: 'generic', allowed: false, exists: check.exists, kind: check.exists ? 'file' : 'missing', realPath: check.realPath, reason: 'Path is outside the allowed evidence roots.' }
      descriptions.set(path, description)
      return description
    }
    const info = await stat(check.realPath).catch(() => undefined)
    if (info == null) {
      const description: CachedDescription = { adapter: 'generic', allowed: true, exists: false, kind: 'missing', realPath: check.realPath, reason: 'Path does not exist.' }
      descriptions.set(path, description)
      return description
    }
    const description: CachedDescription = { adapter: 'generic', allowed: true, exists: true, kind: info.isDirectory() ? 'directory' : 'file', realPath: check.realPath }
    if (info.isDirectory()) {
      const summary = await readOsworldSummary(check.realPath)
      if (summary != null) {
        description.adapter = 'osworld'
        description.summary = summary
      }
    }
    descriptions.set(path, description)
    return description
  }

  async function links(reducer: RunReducer, filter: { caseId?: string, taskId?: string } = {}): Promise<EvidenceLink[]> {
    const selected = rawLinks(reducer).filter(link => (filter.taskId == null || link.taskId === filter.taskId) && (filter.caseId == null || link.caseId === filter.caseId))
    return Promise.all(selected.map(async (link) => {
      const { realPath: _realPath, ...description } = await describe(link.path)
      return { ...link, ...description }
    }))
  }

  async function indexLogFile(filePath: string): Promise<LogFileIndex> {
    let build = logIndexBuilds.get(filePath)
    if (build == null) {
      build = scanLogFile(filePath).finally(() => logIndexBuilds.delete(filePath))
      logIndexBuilds.set(filePath, build)
    }
    return build
  }

  async function scanLogFile(filePath: string): Promise<LogFileIndex> {
    const info = await stat(filePath)
    const identity = `${info.ino}:${info.birthtimeMs}`
    let index = logIndexes.get(filePath)
    if (index == null || index.identity !== identity || info.size < index.scannedBytes) {
      index = { byCaseId: new Map(), identity, lineCount: 0, scannedBytes: 0 }
      logIndexes.set(filePath, index)
    }
    if (info.size <= index.scannedBytes) {
      return index
    }
    const handle = await open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(info.size - index.scannedBytes)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, index.scannedBytes)
      const chunk = buffer.subarray(0, bytesRead)
      let lineStart = 0
      for (let position = 0; position < chunk.length; position += 1) {
        if (chunk[position] !== 0x0A) {
          continue
        }
        const lineBuffer = chunk.subarray(lineStart, position)
        const offset = index.scannedBytes + lineStart
        index.lineCount += 1
        // Cheap pre-filter: only lines that name a case are parsed.
        if (lineBuffer.includes('"caseId"')) {
          try {
            const record = JSON.parse(lineBuffer.toString('utf-8')) as Record<string, unknown>
            if (typeof record.caseId === 'string') {
              const matches = index.byCaseId.get(record.caseId) ?? []
              matches.push({
                length: lineBuffer.length,
                line: index.lineCount,
                offset,
                podName: typeof record.podName === 'string' ? record.podName : undefined,
                time: typeof record.time === 'string' ? record.time : undefined,
              })
              index.byCaseId.set(record.caseId, matches)
            }
          }
          catch {}
        }
        lineStart = position + 1
      }
      index.scannedBytes += lineStart
    }
    finally {
      await handle.close()
    }
    return index
  }

  async function listLogFiles(): Promise<string[]> {
    const files: string[] = []
    for (const directory of options.logDirectories) {
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          files.push(join(directory, entry.name))
        }
      }
    }
    return files.sort()
  }

  return {
    countByCase(reducer) {
      const counts = new Map<string, number>()
      for (const link of rawLinks(reducer)) {
        const key = `${link.taskId}\u0000${link.caseId}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      return counts
    },
    async externalLogs(reducer, reduced, page) {
      const caseLinks = await links(reducer, { caseId: reduced.caseId, taskId: reduced.taskId })
      const keys = new Set<string>([reduced.caseId, reduced.name])
      const lastSegment = reduced.name.split('/').at(-1)
      if (lastSegment != null && lastSegment.length > 0) {
        keys.add(lastSegment)
      }
      const inputTaskId = (reduced.input as null | { task?: { id?: unknown } })?.task?.id
      if (typeof inputTaskId === 'string') {
        keys.add(inputTaskId)
      }
      const podNames = new Set<string>()
      for (const metric of reduced.metrics) {
        if (POD_METRIC_NAMES.includes(metric.name) && typeof metric.value === 'string') {
          podNames.add(metric.value)
        }
      }
      for (const link of caseLinks) {
        if (typeof link.summary?.taskId === 'string') {
          keys.add(link.summary.taskId)
        }
        if (typeof link.summary?.podName === 'string') {
          podNames.add(link.summary.podName)
        }
      }
      const firstStart = reduced.rounds[0]?.startedAt
      const lastEnd = reduced.rounds.at(-1)?.endedAt ?? reducer.run().endedAt
      // A small margin: pods are created right after the case starts, and cleanup logs follow its end (30 s).
      const from = firstStart == null ? undefined : new Date(Date.parse(firstStart) - 5_000).toISOString()
      const to = lastEnd == null ? undefined : new Date(Date.parse(lastEnd) + 30_000).toISOString()

      const matched: Array<LogMatch & { file: string }> = []
      const files: ExternalLogsResponse['files'] = []
      for (const file of await listLogFiles()) {
        const index = await indexLogFile(file).catch(() => undefined)
        if (index == null) {
          continue
        }
        let count = 0
        for (const key of keys) {
          for (const match of index.byCaseId.get(key) ?? []) {
            if (podNames.size > 0 && match.podName != null && !podNames.has(match.podName)) {
              continue
            }
            if (match.time != null && ((from != null && match.time < from) || (to != null && match.time > to))) {
              continue
            }
            matched.push({ ...match, file })
            count += 1
          }
        }
        if (count > 0) {
          files.push({ matched: count, path: file })
        }
      }
      matched.sort((left, right) => (left.time ?? '').localeCompare(right.time ?? '') || left.file.localeCompare(right.file) || left.line - right.line)

      const slice = matched.slice(page.offset, page.offset + page.limit)
      const lines: ExternalLogsResponse['lines'] = []
      for (const match of slice) {
        const handle = await open(match.file, 'r')
        try {
          const buffer = Buffer.alloc(match.length)
          await handle.read(buffer, 0, match.length, match.offset)
          let record: unknown
          try {
            record = JSON.parse(buffer.toString('utf-8'))
          }
          catch {
            record = { $raw: buffer.toString('utf-8') }
          }
          lines.push({ file: match.file, line: match.line, record })
        }
        finally {
          await handle.close()
        }
      }
      const nextOffset = page.offset + slice.length
      return {
        correlation: { keys: [...keys], podNames: [...podNames], window: { from, to } },
        files,
        lines,
        nextOffset: nextOffset < matched.length ? nextOffset : null,
        total: matched.length,
      }
    },
    async find(reducer, linkId) {
      const link = rawLinks(reducer).find(candidate => candidate.id === linkId)
      if (link == null) {
        throw new ViewerError(404, `Evidence link "${linkId}" not found.`)
      }
      const { realPath, ...description } = await describe(link.path)
      return { ...link, ...description, realPath }
    },
    links,
    logDirectories: options.logDirectories,
    roots: options.evidenceRoots,
    async screenshotTimeline(link) {
      if (!link.allowed || link.kind !== 'directory') {
        throw new ViewerError(403, 'Evidence link is not an allowed directory.')
      }
      const text = await readFile(join(link.realPath, 'auv-runs', 'records.jsonl'), 'utf-8').catch(() => '')
      const runOrder = Array.isArray(link.summary?.agentRunIds) ? link.summary.agentRunIds as string[] : []
      const frames: ScreenshotTimeline['frames'] = []
      for (const line of text.split('\n')) {
        if (!line.includes('"artifact"')) {
          continue
        }
        const record = parseJsonText(auvArtifactLineSchema, line)?.record
        if (record == null) {
          continue
        }
        const { metadata } = record
        const contentType = metadata.content_type
        const match = /^auv:\/\/runs\/([^/]+)\/artifacts\/([^/]+)$/.exec(metadata.uri)
        if (!contentType.startsWith('image/') || match == null) {
          continue
        }
        const [, runId, artifactId] = match
        const extension = metadata.file_extension ?? contentType.split('/')[1] ?? 'bin'
        const path = `auv-runs/artifacts/${runId}/${artifactId}.${extension}`
        const exists = await stat(join(link.realPath, path)).then(() => true, () => false)
        if (!exists) {
          continue
        }
        frames.push({
          artifactId,
          contentType,
          occurredAt: formatOccurredAt(record.occurred_at),
          path,
          purpose: metadata.purpose,
          runId,
        })
      }
      if (runOrder.length > 0) {
        const rank = new Map(runOrder.map((id, index) => [id, index]))
        frames.sort((left, right) => (rank.get(left.runId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.runId) ?? Number.MAX_SAFE_INTEGER))
      }
      return { frames }
    },
  }
}

function formatOccurredAt(value: unknown): string | undefined {
  const seconds = (value as null | { unix_seconds?: unknown })?.unix_seconds
  if (typeof seconds !== 'number') {
    return undefined
  }
  const nanos = Number((value as { nanoseconds?: unknown }).nanoseconds ?? 0)
  return new Date(seconds * 1000 + Math.floor(nanos / 1e6)).toISOString()
}

/**
 * Turns a metric name pattern with `*` wildcards into an anchored regular expression.
 *
 * Before:
 * - "*.evidence"
 *
 * After:
 * - /^.*\.evidence$/
 */
function globToRegExp(pattern: string): RegExp {
  return new RegExp(`^${escapeRegExp(pattern).replaceAll('\\*', '.*')}$`)
}

/**
 * Reads the OSWorld episode summary (`result.json` with `taskId` and `podName`), or `undefined` for other
 * directories.
 */
async function readOsworldSummary(directory: string): Promise<Record<string, unknown> | undefined> {
  const parsed = parseJsonText(osworldResultSchema, await readFile(join(directory, 'result.json'), 'utf-8').catch(() => ''))
  if (parsed == null) {
    return undefined
  }
  const summary: Record<string, unknown> = pick(parsed, ['taskId', 'domain', 'model', 'repeat', 'podName', 'score', 'status', 'startedAt', 'finishedAt', 'api', 'error'])
  if (parsed.agent?.steps != null) {
    summary.agentSteps = parsed.agent.steps.length
  }
  if (parsed.agent?.runIds != null) {
    summary.agentRunIds = parsed.agent.runIds
  }
  if (parsed.agent?.lastAction !== undefined) {
    summary.agentLastAction = parsed.agent.lastAction
  }
  return summary
}
