import type {
  ArtifactDescriptor,
  CaseDetail,
  LogsResponse,
  MetricsResponse,
  ProgressResponse,
  RunSnapshot,
  ScoresResponse,
  TaskNode,
  TimelineResponse,
} from '../shared/contract'
import type { ReducedCase } from '../shared/reduce'
import type { EvidenceService } from './evidence'
import type { RunHandle } from './store'

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { poolScoreSummaries } from 'vieval/core/scoring'

import { sumInference } from '../shared/inference'
import { buildProjectNodes, buildTaskNodes, caseKeyOf, countedScores, countingDefinitions, currentPosition, estimateProgress, pickScoreDefinitions, resolveTaskHeadline, scoreRounds, toCaseNode } from '../shared/reduce'
import { ViewerError } from './errors'
import { classifyPreview, contentTypeFromName } from './files'

/** Most log lines one request returns. */
export const MAX_LOG_LIMIT = 5000

/**
 * Case detail: tree node plus input, output, metrics, score records, artifacts, evidence links, inference events.
 */
export async function buildCaseDetail(handle: RunHandle, evidence: EvidenceService, taskId: string, caseId: string): Promise<CaseDetail> {
  const reducer = handle.reducer()
  const reduced = findCase(handle, taskId, caseId)
  const links = await evidence.links(reducer, { caseId, taskId })
  const node = toCaseNode(reduced, { evidenceLinkCount: links.length, terminated: reducer.run().terminated })
  const lastRound = reduced.rounds.at(-1)
  return {
    ...node,
    artifacts: await listArtifacts(handle, { caseId, taskId }),
    evidence: links,
    inference: reduced.inference.map(entry => ({ ...entry })),
    input: reduced.input,
    metricDefinitions: definitionsOf(reducer, reduced.metrics.map(metric => metric.name)),
    metrics: [...reduced.metrics],
    output: lastRound?.output,
    scoreDefinitions: [...(reducer.tasks.get(taskId)?.scoreDefinitions.values() ?? [])],
    scoreRecords: reduced.scoreRecords.map(entry => ({ ...entry })),
    taskDisplayName: reducer.tasks.get(taskId)?.displayName ?? taskId,
  }
}

/**
 * Console output (`case.output`) of a run, split into lines and paged.
 */
export function buildLogs(handle: RunHandle, query: { caseId?: string, limit: number, offset: number, round?: number, stream?: string, taskId?: string }): LogsResponse {
  const lines = handle.reducer().logs.filter(line =>
    (query.taskId == null || line.taskId === query.taskId)
    && (query.caseId == null || line.caseId === query.caseId)
    && (query.stream == null || line.stream === query.stream)
    && (query.round == null || line.roundIndex === query.round))
  const slice = lines.slice(query.offset, query.offset + query.limit)
  const nextOffset = query.offset + slice.length
  return { lines: slice, nextOffset: nextOffset < lines.length ? nextOffset : null, total: lines.length }
}

/**
 * Metrics of a run grouped by name: numeric series with summaries, other values as lists, and the scores beside them.
 *
 * Scores are one point per case: the value its last round counts with (the rule of `scoreCases`), so a failed case
 * shows 0 and an unscored one shows nothing. Each score's summary pools the selected cases of every task.
 */
export function buildMetrics(handle: RunHandle, filter: { caseId?: string, taskId?: string }): MetricsResponse {
  const reducer = handle.reducer()
  const numeric = new Map<string, MetricsResponse['numeric'][number]['points']>()
  const nonNumeric = new Map<string, MetricsResponse['nonNumeric'][number]['values']>()
  for (const metric of reducer.metrics) {
    if ((filter.taskId != null && metric.taskId !== filter.taskId) || (filter.caseId != null && metric.caseId !== filter.caseId)) {
      continue
    }
    const target = typeof metric.value === 'number' && Number.isFinite(metric.value) ? numeric : nonNumeric
    const list = target.get(metric.name) ?? []
    list.push(metric)
    target.set(metric.name, list)
  }
  const cases = [...reducer.cases.values()].filter(reduced => (filter.taskId == null || reduced.taskId === filter.taskId) && (filter.caseId == null || reduced.caseId === filter.caseId))
  const inference = sumInference(cases.flatMap(reduced => reduced.inference))

  const terminated = reducer.run().terminated
  const scorePoints = new Map<string, MetricsResponse['scores'][number]['points']>()
  const scoreSummaries: MetricsResponse['scores'][number]['summary'][] = []
  for (const [taskId, taskCases] of Map.groupBy(cases, reduced => reduced.taskId)) {
    const task = reducer.tasks.get(taskId)
    const taskDefinitions = task?.scoreDefinitions ?? new Map()
    // Every score of the task, also those only unselected cases recorded, so the selection counts like the task does.
    const taskRounds = (task?.caseKeys ?? []).flatMap(key => toCaseNode(reducer.cases.get(key)!, { evidenceLinkCount: 0, terminated }).rounds)
    const definitions = countingDefinitions(scoreRounds(taskRounds, [...taskDefinitions.values()]), taskDefinitions)
    const lastRounds = taskCases.flatMap((reduced) => {
      const round = toCaseNode(reduced, { evidenceLinkCount: 0, terminated }).rounds.at(-1)
      return round == null ? [] : [{ reduced, round }]
    })
    scoreSummaries.push(...scoreRounds(lastRounds.map(({ round }) => round), definitions).scores)
    for (const { reduced, round } of lastRounds) {
      for (const [name, value] of Object.entries(countedScores(round, definitions))) {
        const points = scorePoints.get(name) ?? []
        points.push({ caseId: reduced.caseId, roundIndex: round.roundIndex, taskId, value })
        scorePoints.set(name, points)
      }
    }
  }
  const scores = poolScoreSummaries(scoreSummaries).map(summary => ({ name: summary.name, points: scorePoints.get(summary.name) ?? [], summary }))

  return {
    definitions: definitionsOf(reducer, [...numeric.keys(), ...nonNumeric.keys()]),
    inference,
    nonNumeric: [...nonNumeric].map(([name, values]) => ({ name, values })).sort((left, right) => left.name.localeCompare(right.name)),
    numeric: [...numeric].map(([name, points]) => {
      // One loop instead of `Math.max(...values)`: a long series exceeds the engine's argument limit.
      let max = -Infinity
      let min = Infinity
      let sum = 0
      for (const point of points) {
        const value = point.value as number
        max = Math.max(max, value)
        min = Math.min(min, value)
        sum += value
      }
      return {
        name,
        points,
        summary: { avg: sum / points.length, count: points.length, max, min, sum },
      }
    }).sort((left, right) => left.name.localeCompare(right.name)),
    scoreDefinitions: pickScoreDefinitions(reducer.scoreDefinitions, scores.map(score => score.name)),
    scores,
  }
}

/**
 * Lightweight progress view, for frequent polling.
 */
export function buildProgress(handle: RunHandle, now: number): ProgressResponse {
  const reducer = handle.reducer()
  return {
    current: currentPosition(reducer, now),
    progress: estimateProgress(reducer, now),
    runKey: handle.runKey,
    seq: reducer.seq(),
    state: handle.state(now),
  }
}

/**
 * Scores per task, per round, per case, and overall.
 *
 * Overall scores pool the cases of every task (`poolScoreSummaries`); they are not a mean of task means, so a large
 * task weighs more than a small one.
 */
export function buildScores(handle: RunHandle): ScoresResponse {
  const reducer = handle.reducer()
  const tasks = buildTaskNodes(reducer, () => 0)
  const byRound: ScoresResponse['byRound'] = []
  for (const task of tasks) {
    const definitions = countingDefinitions(task.scoring, reducer.tasks.get(task.id)?.scoreDefinitions ?? new Map())
    const rounds = Map.groupBy(task.cases.flatMap(node => node.rounds), round => round.roundIndex)
    for (const [roundIndex, list] of [...rounds].sort((left, right) => left[0] - right[0])) {
      byRound.push({ roundIndex, scoring: scoreRounds(list, definitions), taskId: task.id })
    }
  }
  return {
    byRound,
    byTask: tasks.map(task => ({ displayName: task.displayName, matrix: task.matrix, scoring: task.scoring, taskId: task.id })),
    cases: tasks.flatMap(task => task.cases.map(node => ({ caseId: node.caseId, name: node.name, scores: node.scores, state: node.state, taskId: node.taskId }))),
    definitions: [...reducer.scoreDefinitions.values()],
    overall: {
      headline: resolveTaskHeadline(tasks),
      scores: poolScoreSummaries(tasks.flatMap(task => task.scoring.scores)),
    },
    summary: handle.summary()?.headline,
  }
}

/**
 * Full snapshot of a run: hierarchy, execution tree, progress, current position.
 */
export function buildSnapshot(handle: RunHandle, evidence: EvidenceService, now: number): RunSnapshot {
  const reducer = handle.reducer()
  const counts = evidence.countByCase(reducer)
  const run = reducer.run()
  const summary = handle.summary()
  const tasks = buildTaskNodes(reducer, key => counts.get(key) ?? 0)
  return {
    current: currentPosition(reducer, now),
    endedAt: run.endedAt,
    eventCounts: { ...reducer.eventCounts },
    headline: resolveTaskHeadline(tasks),
    identity: reducer.identity() ?? { attemptId: 'unknown-attempt', experimentId: 'unknown-experiment', runId: handle.runKey, workspaceId: 'unknown-workspace' },
    interruptSignal: run.interruptSignal ?? summary?.interruptSignal,
    parseErrors: handle.parseErrors(),
    progress: estimateProgress(reducer, now),
    projects: buildProjectNodes(reducer),
    runKey: handle.runKey,
    scoreDefinitions: [...reducer.scoreDefinitions.values()],
    seq: reducer.seq(),
    seqGaps: reducer.seqGaps(),
    source: handle.source(),
    startedAt: run.startedAt,
    state: handle.state(now),
    summary: summary == null
      ? undefined
      : {
          caseSummary: summary.caseSummary,
          headline: summary.headline,
        },
    tasks,
  }
}

/**
 * One task node, or 404.
 */
export function buildTask(handle: RunHandle, evidence: EvidenceService, taskId: string): TaskNode {
  const reducer = handle.reducer()
  const counts = evidence.countByCase(reducer)
  const task = buildTaskNodes(reducer, key => counts.get(key) ?? 0).find(node => node.id === taskId)
  if (task == null) {
    throw new ViewerError(404, `Task "${taskId}" not found in run "${handle.runKey}".`)
  }
  return task
}

/**
 * Auto attempt (round) and retry timeline of a run, optionally of one task or case.
 */
export function buildTimeline(handle: RunHandle, filter: { caseId?: string, taskId?: string }): TimelineResponse {
  const reducer = handle.reducer()
  const terminated = reducer.run().terminated
  const entries: TimelineResponse['entries'] = []
  const roundsByTask = new Map<string, Map<number, TimelineResponse['rounds'][number]['rounds'][number]>>()
  for (const reduced of reducer.cases.values()) {
    if ((filter.taskId != null && reduced.taskId !== filter.taskId) || (filter.caseId != null && reduced.caseId !== filter.caseId)) {
      continue
    }
    const node = toCaseNode(reduced, { evidenceLinkCount: 0, terminated })
    for (const round of node.rounds) {
      for (const entry of round.tries) {
        entries.push({
          caseId: node.caseId,
          durationMs: entry.endedAt == null ? undefined : Date.parse(entry.endedAt) - Date.parse(entry.startedAt),
          endedAt: entry.endedAt,
          // A requeued try keeps its own error; the round's error belongs to its last try.
          errorMessage: entry.errorMessage ?? (entry === round.tries.at(-1) ? round.errorMessage : undefined),
          name: node.name,
          requeueIndex: entry.requeueIndex,
          retryIndex: entry.retryIndex,
          roundIndex: round.roundIndex,
          roundIndexInferred: round.roundIndexInferred,
          startedAt: entry.startedAt,
          state: entry.state,
          taskId: node.taskId,
        })
      }
      const taskRounds = roundsByTask.get(node.taskId) ?? new Map()
      roundsByTask.set(node.taskId, taskRounds)
      const summary = taskRounds.get(round.roundIndex) ?? { errored: 0, failed: 0, passed: 0, roundIndex: round.roundIndex, running: 0, startedAt: round.startedAt }
      if (round.startedAt < summary.startedAt) {
        summary.startedAt = round.startedAt
      }
      if (round.endedAt != null && (summary.endedAt == null || round.endedAt > summary.endedAt)) {
        summary.endedAt = round.endedAt
      }
      if (round.state === 'passed') {
        summary.passed += 1
      }
      // A requeued round waits to run again, so it has not ended either.
      else if (round.state === 'running' || round.state === 'requeued') {
        summary.running += 1
      }
      else if (round.state === 'failed') {
        summary.failed += 1
      }
      else {
        summary.errored += 1
      }
      taskRounds.set(round.roundIndex, summary)
    }
  }
  entries.sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.name.localeCompare(right.name))
  return {
    entries,
    rounds: [...roundsByTask].map(([taskId, rounds]) => ({
      rounds: [...rounds.values()].sort((left, right) => left.roundIndex - right.roundIndex),
      taskId,
    })),
  }
}

/**
 * The reduced case, or 404.
 */
export function findCase(handle: RunHandle, taskId: string, caseId: string): ReducedCase {
  const reduced = handle.reducer().cases.get(caseKeyOf(taskId, caseId))
  if (reduced == null) {
    throw new ViewerError(404, `Case "${caseId}" of task "${taskId}" not found in run "${handle.runKey}".`)
  }
  return reduced
}

/**
 * Artifacts of a run: every `artifact.recorded` event, plus files found in `artifacts/<task>/<case>/` that no
 * event announced (for example files a case wrote into `artifactsDirectory` itself).
 */
export async function listArtifacts(handle: RunHandle, filter: { caseId?: string, taskId?: string }): Promise<ArtifactDescriptor[]> {
  const reducer = handle.reducer()
  const descriptors: ArtifactDescriptor[] = []
  const known = new Set<string>()
  const directories = new Set<string>()
  for (const reduced of reducer.cases.values()) {
    if ((filter.taskId != null && reduced.taskId !== filter.taskId) || (filter.caseId != null && reduced.caseId !== filter.caseId)) {
      continue
    }
    directories.add(`${normalizePathSegment(reduced.taskId)}/${normalizePathSegment(reduced.caseId)}\0${reduced.taskId}\0${reduced.caseId}`)
    for (const artifact of reduced.artifacts) {
      known.add(artifact.path)
      descriptors.push({
        caseId: artifact.caseId,
        contentType: artifact.contentType,
        description: artifact.description,
        label: artifact.label,
        name: artifact.name,
        path: artifact.path,
        previewKind: classifyPreview(artifact.contentType, artifact.path),
        purpose: artifact.purpose,
        roundIndex: artifact.roundIndex,
        size: artifact.size,
        source: 'event',
        taskId: artifact.taskId,
      })
    }
  }
  const root = handle.artifactsRoot()
  if (root != null) {
    for (const entry of directories) {
      const [relativeDirectory, taskId, caseId] = entry.split('\0')
      const files = await readdir(join(root, relativeDirectory), { withFileTypes: true }).catch(() => [])
      for (const file of files) {
        const path = `${relativeDirectory}/${file.name}`
        if (!file.isFile() || known.has(path)) {
          continue
        }
        const info = await stat(join(root, path)).catch(() => undefined)
        const contentType = contentTypeFromName(file.name)
        descriptors.push({ caseId, contentType, name: file.name, path, previewKind: classifyPreview(contentType, file.name), size: info?.size ?? 0, source: 'directory', taskId })
      }
    }
  }
  return descriptors
}

/**
 * The segment normalization of `createCaseArtifacts` (`dsl/case-artifacts.ts`).
 */
export function normalizePathSegment(value: string): string {
  const segment = value.replace(/[^\w.-]+/g, '-')
  return /^\.*$/.test(segment) ? '-' : segment
}

/** Latest `metric.defined` of each named metric that has one, in name order. */
function definitionsOf(reducer: ReturnType<RunHandle['reducer']>, names: Iterable<string>): MetricsResponse['definitions'] {
  return [...new Set(names)].sort().flatMap((name) => {
    const definition = reducer.metricDefinitions.get(name)
    return definition == null ? [] : [{ ...definition }]
  })
}
