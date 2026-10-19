import type { FSWatcher } from 'node:fs'

import type { RunReadyContext } from 'vieval/cli'

import type { CaseCounts, RunEvent, RunListItem, RunSource, RunState, TaskNode } from '../shared/contract'
import type { RunReducer } from '../shared/reduce'

import { watch } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

import { glob } from 'tinyglobby'
import { hybridAverage } from 'vieval/core/scoring'

import * as v from 'valibot'

import { average, axisValues, buildTaskNodes, countCases, createRunReducer } from '../shared/reduce'
import { createEventTail } from './event-tail'
import { parseJsonText } from './files'

/** Default age of the last event after which a run without a terminal event is reported as `stale`. */
export const DEFAULT_STALE_AFTER_MS = 60 * 60 * 1000

/** Interval of the polling fallback that complements `fs.watch` for tailed runs. */
const TAIL_POLL_MS = 1000

/** Identity fields that both `run-summary.json` and every event envelope carry. */
const reportIdentityEntries = {
  attemptId: v.optional(v.string()),
  experimentId: v.optional(v.string()),
  runId: v.optional(v.string()),
  workspaceId: v.optional(v.string()),
}

/**
 * Fields of `run-summary.json` (vieval's `CliRunOutput`) that the viewer reads.
 *
 * Loose and mostly optional, because the file may come from any vieval version, including event schema version 1
 * reports. Missing case counts read as 0, as in the reports of older versions.
 */
const runSummaryFileSchema = v.looseObject({
  ...reportIdentityEntries,
  interruptSignal: v.optional(v.string()),
  projects: v.optional(v.array(v.looseObject({
    caseSummary: v.nullish(v.looseObject({
      // Reports from before vieval split errored cases out of failed ones have no `errored` count.
      errored: v.optional(v.number(), 0),
      failed: v.optional(v.number(), 0),
      passed: v.optional(v.number(), 0),
      skipped: v.optional(v.number(), 0),
      timeout: v.optional(v.number(), 0),
      total: v.optional(v.number(), 0),
    })),
    result: v.nullish(v.looseObject({
      overall: v.optional(v.looseObject({
        exactAverage: v.nullish(v.number()),
        judgeAverage: v.nullish(v.number()),
        runCount: v.optional(v.number()),
      })),
    })),
    taskCount: v.optional(v.number()),
  })), []),
})

/** One line of a legacy (event schema version 1) `cases.jsonl`. */
const legacyCaseRecordSchema = v.looseObject({
  caseId: v.string(),
  caseName: v.optional(v.string()),
  endedAt: v.optional(v.string()),
  errorMessage: v.nullish(v.string()),
  input: v.optional(v.unknown()),
  metrics: v.optional(v.record(v.string(), v.unknown()), {}),
  projectName: v.optional(v.string()),
  scores: v.optional(v.record(v.string(), v.unknown()), {}),
  startedAt: v.optional(v.string()),
  state: v.optional(v.string()),
  taskId: v.optional(v.string()),
})

/** First line of a legacy `events.jsonl`: only its identity and time are used. */
const legacyEventSchema = v.looseObject({
  ...reportIdentityEntries,
  timestamp: v.optional(v.string()),
})

export interface CreateRunStoreOptions {
  reportRoots: readonly string[]
  staleAfterMs?: number
}

/**
 * One run known to the viewer, whatever its source.
 */
export interface RunHandle {
  /** Root of `artifact.recorded` paths, when known. */
  artifactsRoot: () => string | undefined
  parseErrors: () => number
  projectSegment: string
  reducer: () => RunReducer
  /** Reads new data (tail) or loads the report once (offline). Safe to call often. */
  refresh: () => Promise<void>
  reportDirectory: string | undefined
  /** Report directory relative to its root, `/`-separated. */
  reportPath: string | undefined
  reportRoot: string | undefined
  runKey: string
  source: () => RunSource
  state: (now: number) => RunState
  /** Subscribes to new envelopes. Tailed runs are watched while at least one listener exists. */
  subscribe: (listener: RunListener) => () => void
  summary: () => RunSummaryInfo | undefined
}

/**
 * Listener of new envelopes. `reset` means the reducer was rebuilt (file replaced); refetch the snapshot.
 */
export type RunListener = (update: { envelopes: readonly RunEvent[], reset: boolean }) => void

/**
 * Registry of every run the viewer serves.
 */
export interface RunStore {
  attachLive: (context: RunReadyContext) => { dispose: () => Promise<void>, handle: RunHandle }
  close: () => void
  get: (runKey: string) => Promise<RunHandle | undefined>
  list: () => Promise<RunHandle[]>
  reportRoots: readonly string[]
}

/**
 * Official numbers from `run-summary.json`.
 */
export interface RunSummaryInfo {
  caseSummary?: CaseCounts
  exactAverage: null | number
  hybridAverage: null | number
  interruptSignal?: string
  judgeAverage: null | number
}

/**
 * Creates the run registry.
 *
 * Use when:
 * - the viewer starts; every route reads runs through it
 *
 * Expects:
 * - report roots laid out as `<root>/<workspace>/<project>/<experiment>/<attempt>/<run>/` (`resolveRunReportDirectory`)
 *
 * Returns:
 * - a store that discovers runs lazily (at most once per second), prefers in-process runs over their directory
 *   copies, and stops all watchers on `close()`
 */
export function createRunStore(options: CreateRunStoreOptions): RunStore {
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
  const handles = new Map<string, RunHandle & { close: () => void }>()
  let lastScan = 0
  let scanning: Promise<void> | undefined

  async function scan(): Promise<void> {
    if (Date.now() - lastScan < 1000) {
      return
    }
    scanning ??= (async () => {
      for (const root of options.reportRoots) {
        for (const runDirectory of await findRunDirectories(root)) {
          const runKey = basename(runDirectory)
          if (handles.has(runKey)) {
            continue
          }
          handles.set(runKey, createDirectoryRun({ reportRoot: root, runDirectory, staleAfterMs }))
        }
      }
      lastScan = Date.now()
    })().finally(() => {
      scanning = undefined
    })
    await scanning
  }

  return {
    attachLive(context) {
      const live = createLiveRun(context, staleAfterMs)
      handles.get(live.handle.runKey)?.close()
      handles.set(live.handle.runKey, live.handle)
      return { dispose: live.dispose, handle: live.handle }
    },
    close() {
      for (const handle of handles.values()) {
        handle.close()
      }
    },
    async get(runKey) {
      let handle = handles.get(runKey)
      if (handle == null) {
        lastScan = 0
        await scan()
        handle = handles.get(runKey)
      }
      await handle?.refresh()
      return handle
    },
    async list() {
      await scan()
      const all = [...handles.values()]
      await Promise.all(all.map(async handle => handle.refresh()))
      return all
    },
    reportRoots: options.reportRoots,
  }
}

/**
 * Finds run directories (depth 5 below the root) that hold `events.jsonl` or `run-summary.json`.
 *
 * Dot directories and symlinked directories are skipped: a symlink to another experiment would list its runs twice.
 * A missing or unreadable root has no runs.
 */
export async function findRunDirectories(root: string): Promise<string[]> {
  const files = await glob('*/*/*/*/*/{events.jsonl,run-summary.json}', { absolute: true, cwd: root, followSymbolicLinks: false, onlyFiles: true })
  // `resolve`: tinyglobby returns `/`-separated paths on Windows; the store compares and joins native paths.
  return [...new Set(files.map(file => resolve(dirname(file))))].sort()
}

/**
 * Rebuilds a legacy (event schema version 1) run from `cases.jsonl` and `run-summary.json`.
 *
 * The events of version 1 use other names and payloads; instead of replaying them, every case record is turned
 * into the version 2 events the reducer understands. Rounds, retries, logs, and inference events are not
 * available for such runs.
 */
export async function loadLegacyRun(runDirectory: string): Promise<RunReducer> {
  const reducer = createRunReducer()
  const records = (await readFile(join(runDirectory, 'cases.jsonl'), 'utf-8').catch(() => ''))
    .split('\n')
    .filter(line => line.trim().length > 0)
    .flatMap((line) => {
      const record = parseJsonText(legacyCaseRecordSchema, line)
      return record == null ? [] : [record]
    })
  const summary = parseJsonText(runSummaryFileSchema, await readFile(join(runDirectory, 'run-summary.json'), 'utf-8').catch(() => ''))
  const firstLine = (await readFile(join(runDirectory, 'events.jsonl'), 'utf-8').catch(() => '')).split('\n', 1)[0]
  const first = parseJsonText(legacyEventSchema, firstLine)
  const identity = {
    attemptId: summary?.attemptId ?? first?.attemptId ?? 'unknown-attempt',
    experimentId: summary?.experimentId ?? first?.experimentId ?? 'unknown-experiment',
    runId: summary?.runId ?? first?.runId ?? basename(runDirectory),
    workspaceId: summary?.workspaceId ?? first?.workspaceId ?? 'unknown-workspace',
  }
  let seq = 0
  const startedTimes = records.flatMap(record => record.startedAt ?? []).sort()
  const endedTimes = records.flatMap(record => record.endedAt ?? []).sort()
  const runStartedAt = first?.timestamp ?? startedTimes[0] ?? new Date(0).toISOString()
  const runEndedAt = endedTimes.at(-1) ?? runStartedAt
  const emit = (event: string, data: unknown, time: string, scope: { caseId?: string, projectId?: string, taskId?: string } = {}) => {
    seq += 1
    reducer.apply({ ...identity, ...scope, data, event, schemaVersion: 2, seq, time })
  }
  const projects = summary?.projects ?? []
  emit('run.started', { totalTasks: projects.reduce((sum, project) => sum + (project.taskCount ?? 0), 0) }, runStartedAt)

  const byTask = Map.groupBy(records, record => record.taskId ?? 'unknown-task')
  for (const [taskId, taskRecords] of byTask) {
    const projectId = taskRecords[0].projectName ?? 'unknown-project'
    const scope = { projectId, taskId }
    const taskStartedAt = taskRecords.map(record => record.startedAt ?? runStartedAt).sort()[0]
    emit('task.queued', { displayName: parseTaskDisplayName(taskId) }, runStartedAt, scope)
    emit('task.started', {}, taskStartedAt, scope)
    for (const record of taskRecords) {
      const caseScope = { ...scope, caseId: record.caseId }
      const index = Number.parseInt(record.caseId.split(':')[0], 10) || 0
      const name = record.caseName ?? record.caseId
      const startedAt = record.startedAt ?? runStartedAt
      const endedAt = record.endedAt ?? startedAt
      emit('case.started', { index, input: record.input, name, total: taskRecords.length }, startedAt, caseScope)
      for (const [metricName, value] of Object.entries(record.metrics)) {
        emit('metric.recorded', { name: metricName, value }, endedAt, caseScope)
      }
      for (const [kind, score] of Object.entries(record.scores)) {
        emit('score.recorded', { kind, score }, endedAt, caseScope)
      }
      emit('case.ended', { errorMessage: record.errorMessage ?? undefined, index, name, state: record.state, total: taskRecords.length }, endedAt, caseScope)
    }
    const failed = taskRecords.some(record => record.state !== 'passed' && record.state !== 'skipped')
    emit('task.ended', { state: failed ? 'failed' : 'passed' }, taskRecords.map(record => record.endedAt ?? runEndedAt).sort().at(-1)!, scope)
  }
  emit('run.ended', { failedTasks: 0, passedTasks: 0, skippedTasks: 0, totalTasks: byTask.size }, runEndedAt)
  return reducer
}

/**
 * Reads the official numbers of `run-summary.json`.
 */
export async function readRunSummary(filePath: string): Promise<RunSummaryInfo | undefined> {
  const parsed = parseJsonText(runSummaryFileSchema, await readFile(filePath, 'utf-8').catch(() => ''))
  if (parsed == null) {
    return undefined
  }
  const caseSummary: CaseCounts = { errored: 0, failed: 0, passed: 0, requeued: 0, running: 0, skipped: 0, timeout: 0, total: 0 }
  let hasCaseSummary = false
  const weighted = { exact: [0, 0], judge: [0, 0] }
  for (const project of parsed.projects) {
    const counts = project.caseSummary
    if (counts != null) {
      hasCaseSummary = true
      for (const key of ['errored', 'failed', 'passed', 'skipped', 'timeout', 'total'] as const) {
        caseSummary[key] += counts[key]
      }
    }
    const overall = project.result?.overall
    const weight = overall?.runCount ?? 1
    for (const kind of ['exact', 'judge'] as const) {
      const value = overall?.[`${kind}Average`]
      if (value != null) {
        weighted[kind][0] += value * weight
        weighted[kind][1] += weight
      }
    }
  }
  const exactAverage = weighted.exact[1] === 0 ? null : weighted.exact[0] / weighted.exact[1]
  const judgeAverage = weighted.judge[1] === 0 ? null : weighted.judge[0] / weighted.judge[1]
  return {
    caseSummary: hasCaseSummary ? caseSummary : undefined,
    exactAverage,
    hybridAverage: hybridAverage(exactAverage, judgeAverage),
    interruptSignal: parsed.interruptSignal,
    judgeAverage,
  }
}

/**
 * Builds the list item of one run (hierarchy labels, state, counts, scores).
 *
 * Expects:
 * - `tasks` only when the caller already built the run's task nodes (building them walks every case)
 */
export function toRunListItem(handle: RunHandle, now: number, tasks: readonly TaskNode[] = buildTaskNodes(handle.reducer(), () => 0)): RunListItem {
  const reducer = handle.reducer()
  const identity = reducer.identity() ?? {
    attemptId: handle.reportPath?.split('/')[3] ?? 'unknown-attempt',
    experimentId: handle.reportPath?.split('/')[2] ?? 'unknown-experiment',
    runId: handle.runKey,
    workspaceId: handle.reportPath?.split('/')[0] ?? 'unknown-workspace',
  }
  const counts = countCases(tasks.flatMap(task => task.cases))
  const summary = handle.summary()
  const taskExact = tasks.map(task => task.scores.exact).filter((value): value is number => value != null)
  const taskJudge = tasks.map(task => task.scores.judge).filter((value): value is number => value != null)
  const exactAverage = summary?.exactAverage ?? average(taskExact)
  const judgeAverage = summary?.judgeAverage ?? average(taskJudge)
  const run = reducer.run()
  return {
    ...identity,
    counts,
    endedAt: run.endedAt,
    exactAverage,
    hybridAverage: hybridAverage(exactAverage, judgeAverage),
    judgeAverage,
    lastEventAt: run.lastEvent?.time,
    lastSeq: reducer.seq(),
    matrix: axisValues(tasks.flatMap(task => task.matrix == null ? [] : [task.matrix.run])),
    projectIds: [...reducer.projects.keys()],
    projectSegment: handle.projectSegment,
    reportPath: handle.reportPath ?? null,
    reportRoot: handle.reportRoot ?? null,
    runKey: handle.runKey,
    source: handle.source(),
    startedAt: run.startedAt,
    state: handle.state(now),
  }
}

function createDirectoryRun(args: { reportRoot: string, runDirectory: string, staleAfterMs: number }): RunHandle & { close: () => void } {
  const eventsPath = join(args.runDirectory, 'events.jsonl')
  const summaryPath = join(args.runDirectory, 'run-summary.json')
  const reportPath = relative(args.reportRoot, args.runDirectory).split(sep).join('/')
  const projectSegment = reportPath.split('/')[1] ?? 'unknown-project'
  const listeners = createListeners()
  const tail = createEventTail(eventsPath)
  let reducer = createRunReducer()
  let source: RunSource = 'live-tail'
  let summary: RunSummaryInfo | undefined
  let parseErrors = 0
  let finished = false
  let refreshing: Promise<void> | undefined
  let watcher: FSWatcher | undefined
  let poller: ReturnType<typeof setInterval> | undefined

  async function loadSummary(): Promise<void> {
    summary = await readRunSummary(summaryPath)
  }

  async function doRefresh(): Promise<void> {
    if (finished) {
      return
    }
    const read = await tail.read()
    if (read.legacy && source !== 'legacy') {
      source = 'legacy'
      reducer = await loadLegacyRun(args.runDirectory)
      await loadSummary()
      finished = true
      stopWatching()
      listeners.emit({ envelopes: [], reset: true })
      return
    }
    if (read.reset) {
      reducer = createRunReducer()
      parseErrors = 0
    }
    parseErrors += read.parseErrors
    const applied = read.envelopes.filter(envelope => reducer.apply(envelope) === 'applied')

    const summaryExists = await stat(summaryPath).then(() => true, () => false)
    if (reducer.run().terminated || summaryExists) {
      if (summaryExists) {
        // The summary is written right after the last event; one more read picks up anything left.
        const rest = await tail.read()
        applied.push(...rest.envelopes.filter(envelope => reducer.apply(envelope) === 'applied'))
        await loadSummary()
        finished = true
        stopWatching()
      }
      source = 'offline'
    }
    else {
      source = 'live-tail'
    }
    if (applied.length > 0 || read.reset || finished) {
      listeners.emit({ envelopes: applied, reset: read.reset })
    }
  }

  async function refresh(): Promise<void> {
    refreshing ??= doRefresh().finally(() => {
      refreshing = undefined
    })
    await refreshing
  }

  function startWatching(): void {
    if (finished || poller != null) {
      return
    }
    const trigger = () => {
      void refresh()
    }
    try {
      watcher = watch(eventsPath, trigger)
      watcher.on('error', () => {})
    }
    catch {}
    poller = setInterval(trigger, TAIL_POLL_MS)
    poller.unref?.()
  }

  function stopWatching(): void {
    watcher?.close()
    watcher = undefined
    if (poller != null) {
      clearInterval(poller)
      poller = undefined
    }
  }

  const handle: RunHandle & { close: () => void } = {
    artifactsRoot: () => join(args.runDirectory, 'artifacts'),
    close: stopWatching,
    parseErrors: () => parseErrors,
    projectSegment,
    reducer: () => reducer,
    refresh,
    reportDirectory: args.runDirectory,
    reportPath,
    reportRoot: args.reportRoot,
    runKey: basename(args.runDirectory),
    source: () => source,
    state(now) {
      if (source === 'legacy') {
        return 'legacy'
      }
      const terminal = stateFromReducer(reducer, summary)
      if (terminal != null) {
        return terminal
      }
      const lastTime = reducer.run().lastEvent?.time
      if (lastTime != null && now - Date.parse(lastTime) > args.staleAfterMs) {
        return 'stale'
      }
      return 'running'
    },
    subscribe(listener) {
      listeners.listeners.add(listener)
      startWatching()
      return () => {
        listeners.listeners.delete(listener)
        if (listeners.count() === 0) {
          stopWatching()
        }
      }
    },
    summary: () => summary,
  }

  return handle
}

function createListeners() {
  const listeners = new Set<RunListener>()
  return {
    count: () => listeners.size,
    emit(update: Parameters<RunListener>[0]) {
      for (const listener of listeners) {
        try {
          listener(update)
        }
        catch {}
      }
    },
    listeners,
  }
}

function createLiveRun(context: RunReadyContext, staleAfterMs: number): { dispose: () => Promise<void>, handle: RunHandle & { close: () => void } } {
  const reducer = createRunReducer()
  const listeners = createListeners()
  let summary: RunSummaryInfo | undefined
  let disposed = false
  const reportPath = context.reportDirectory != null && context.reportRoot != null
    ? relative(context.reportRoot, context.reportDirectory).split(sep).join('/')
    : undefined
  const projectSegment = reportPath?.split('/')[1] ?? (context.projectNames.length === 1 ? context.projectNames[0] : 'multi-project')

  const unsubscribe = context.bus.onAny((envelope) => {
    if (reducer.apply(envelope as RunEvent) === 'applied') {
      listeners.emit({ envelopes: [envelope as RunEvent], reset: false })
    }
  })

  const handle: RunHandle & { close: () => void } = {
    artifactsRoot: () => context.artifactsRoot,
    close: () => {},
    parseErrors: () => 0,
    projectSegment,
    reducer: () => reducer,
    async refresh() {},
    reportDirectory: context.reportDirectory ?? undefined,
    reportPath,
    reportRoot: context.reportRoot ?? undefined,
    runKey: context.identity.runId,
    source: () => 'live-bus',
    state(now) {
      const terminal = stateFromReducer(reducer, summary)
      if (terminal != null) {
        return terminal
      }
      if (disposed) {
        return 'ended'
      }
      const lastTime = reducer.run().lastEvent?.time
      return lastTime != null && now - Date.parse(lastTime) > staleAfterMs ? 'stale' : 'running'
    },
    subscribe(listener) {
      listeners.listeners.add(listener)
      return () => listeners.listeners.delete(listener)
    },
    summary: () => summary,
  }

  return {
    async dispose() {
      unsubscribe()
      disposed = true
      if (context.reportDirectory != null) {
        summary = await readRunSummary(join(context.reportDirectory, 'run-summary.json'))
      }
      listeners.emit({ envelopes: [], reset: false })
    },
    handle,
  }
}

function parseTaskDisplayName(taskId: string): string {
  const [entry] = taskId.split('::')
  try {
    return decodeURIComponent(entry).split('/').at(-1) ?? taskId
  }
  catch {
    return taskId
  }
}

function stateFromReducer(reducer: RunReducer, summary: RunSummaryInfo | undefined): RunState | undefined {
  const run = reducer.run()
  if (run.terminated) {
    return run.interruptSignal != null || summary?.interruptSignal != null ? 'interrupted' : 'ended'
  }
  if (summary != null) {
    return summary.interruptSignal != null ? 'interrupted' : 'ended'
  }
  return undefined
}
