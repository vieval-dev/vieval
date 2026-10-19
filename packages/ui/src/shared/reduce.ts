import type { CaseOutcomeScores, CaseOutcomeState } from 'vieval/core/scoring'
import type { LocalizedText } from 'vieval/events'

import type {
  CaseCounts,
  CaseNode,
  CaseRound,
  CaseState,
  CurrentPosition,
  LogLine,
  MetricDefinition,
  MetricEntry,
  ProjectNode,
  RunEvent,
  RunIdentity,
  RunProgress,
  TaskMatrix,
  TaskNode,
  TryNode,
} from './contract'

import { scoreCaseOutcomes } from 'vieval/core/scoring'

/**
 * Result of {@link RunReducer.apply}.
 *
 * - `applied`: the envelope changed the state
 * - `duplicate`: `seq` was already applied (dropped)
 * - `foreign`: the envelope belongs to another run (dropped)
 */
export type ApplyResult = 'applied' | 'duplicate' | 'foreign'

/**
 * One `artifact.recorded` event, attached to its case.
 */
export interface ReducedArtifact {
  caseId?: string
  contentType: string
  description?: LocalizedText
  label?: LocalizedText
  name: string
  path: string
  purpose?: string
  roundIndex?: number
  seq: number
  size: number
  taskId?: string
}

/**
 * Reduced state of one case: every round and try, plus what the case recorded.
 */
export interface ReducedCase {
  artifacts: ReducedArtifact[]
  autoAttempt?: number
  caseId: string
  index: number
  inference: ReducedInferenceEvent[]
  input?: unknown
  key: string
  logLineCount: number
  metrics: MetricEntry[]
  name: string
  projectId?: string
  rounds: MutableRound[]
  taskId: string
}

/**
 * One inference or tool-call event, attached to its case.
 */
export interface ReducedInferenceEvent {
  data: unknown
  event: string
  roundIndex?: number
  seq: number
  time: string
}

/**
 * Reduced state of one task.
 */
export interface ReducedTask {
  autoAttemptMax?: number
  caseKeys: string[]
  caseTotal?: number
  displayName: string
  endedAt?: string
  id: string
  projectId: string
  startedAt?: string
  state: TaskNode['state']
}

/**
 * Incremental reducer of one run's events.
 *
 * Every data source (in-process bus, tail of `events.jsonl`, finished report) feeds the same reducer, so the
 * API returns the same shapes for running and finished runs.
 */
export interface RunReducer {
  apply: (envelope: RunEvent) => ApplyResult
  readonly cases: ReadonlyMap<string, ReducedCase>
  readonly eventCounts: Readonly<Record<string, number>>
  readonly events: readonly RunEvent[]
  identity: () => RunIdentity | undefined
  readonly logs: readonly LogLine[]
  /** Latest `metric.defined` per metric name. */
  readonly metricDefinitions: ReadonlyMap<string, MetricDefinition>
  readonly metrics: readonly MetricEntry[]
  readonly projects: ReadonlyMap<string, ReducedProject>
  run: () => {
    endedAt?: string
    interruptSignal?: string
    lastEvent?: { event: string, seq: number, time: string }
    startedAt?: string
    terminated: boolean
    totalTasks?: number
  }
  readonly seq: () => number
  readonly seqGaps: () => number
  /**
   * Completed rounds after each change, in event order: one entry whenever a round settles (or a settled round is
   * started again). `time` is the event time in epoch ms. Feeds {@link estimateProgress}'s `history`.
   */
  readonly settlements: readonly Settlement[]
  readonly tasks: ReadonlyMap<string, ReducedTask>
}

/**
 * Number of settled rounds of a run right after one event.
 */
export interface Settlement {
  completed: number
  time: number
}

/** Most points of `RunProgress.history`; enough for a chart several hundred pixels wide. */
const MAX_HISTORY_POINTS = 240

interface MutableRound {
  endedAt?: string
  errorMessage?: string
  output?: unknown
  roundIndex: number
  roundIndexInferred: boolean
  scores: { exact?: number, judge?: number }
  startedAt: string
  state: CaseState
  tries: MutableTry[]
}

interface MutableTry {
  autoRetry: number
  endedAt?: string
  retryIndex: number
  startedAt: string
  state: TryNode['state']
}

interface ReducedProject {
  endedAt?: string
  failed?: boolean
  id: string
  startedAt?: string
  taskCount?: number
  taskIds: string[]
}

/**
 * Arithmetic mean, or `null` for no values (a score that was never recorded is not 0).
 */
export function average(values: readonly number[]): null | number {
  if (values.length === 0) {
    return null
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Distinct values of every matrix axis in `rows`, each list in natural order.
 *
 * Before:
 * - `[{ model: 'gpt-5.5', repeat: '10' }, { model: 'gpt-5.5', repeat: '2' }]`
 *
 * After:
 * - `{ model: ['gpt-5.5'], repeat: ['2', '10'] }`
 */
export function axisValues(rows: Iterable<Readonly<Record<string, string>>>): Record<string, string[]> {
  const axes = new Map<string, Set<string>>()
  for (const row of rows) {
    for (const [name, value] of Object.entries(row)) {
      let values = axes.get(name)
      if (values == null) {
        values = new Set()
        axes.set(name, values)
      }
      values.add(value)
    }
  }
  return Object.fromEntries([...axes].map(([name, values]) => [name, [...values].sort(compareNatural)]))
}

/**
 * Builds project nodes.
 */
export function buildProjectNodes(reducer: RunReducer): ProjectNode[] {
  return [...reducer.projects.values()].map(project => ({
    endedAt: project.endedAt,
    failed: project.failed,
    id: project.id,
    startedAt: project.startedAt,
    state: project.endedAt != null ? 'ended' : project.startedAt != null ? 'running' : 'queued',
    taskCount: project.taskCount,
    taskIds: [...project.taskIds],
  }))
}

/**
 * Builds task nodes (with cases) in queue order.
 */
export function buildTaskNodes(reducer: RunReducer, evidenceCount: (caseKey: string) => number): TaskNode[] {
  const terminated = reducer.run().terminated
  return [...reducer.tasks.values()].map((task) => {
    const cases = task.caseKeys
      .map(key => reducer.cases.get(key)!)
      .map(reduced => toCaseNode(reduced, { evidenceLinkCount: evidenceCount(reduced.key), terminated }))
      .sort((left, right) => left.index - right.index)
    const allRounds = cases.flatMap(node => node.rounds)
    // A loop instead of `Math.max(...rounds)`: a task with many cases exceeds the engine's argument limit.
    let roundCount = 0
    for (const round of allRounds) {
      roundCount = Math.max(roundCount, round.roundIndex + 1)
    }
    const caseCounts = countCases(cases)
    // vieval's `task.ended` state only says whether the task threw; a task whose cases failed is still `passed` there.
    const settledState = task.state === 'passed' && caseCounts.failed + caseCounts.timeout > 0 ? 'failed' : task.state
    const state = terminated && (task.state === 'running' || task.state === 'queued') ? 'unfinished' : settledState
    return {
      autoAttemptMax: task.autoAttemptMax,
      caseCounts,
      cases,
      caseTotal: task.caseTotal,
      displayName: task.displayName,
      endedAt: task.endedAt,
      id: task.id,
      projectId: task.projectId,
      roundCount,
      scores: scoreRounds(allRounds),
      startedAt: task.startedAt,
      state,
      ...parseTaskId(task.id),
    }
  })
}

/**
 * Key of one case in one task, the same as `report-records.ts` `createCaseKey`.
 */
export function caseKeyOf(taskId: string, caseId: string): string {
  return `${taskId}\u0000${caseId}`
}

/**
 * Orders strings with digit runs compared as numbers, so `repeat=2` sorts before `repeat=10`.
 */
export function compareNatural(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true })
}

/**
 * Counts final case states.
 */
export function countCases(nodes: readonly Pick<CaseNode, 'state'>[]): CaseCounts {
  const counts: CaseCounts = { errored: 0, failed: 0, passed: 0, running: 0, skipped: 0, timeout: 0, total: nodes.length }
  for (const node of nodes) {
    switch (node.state) {
      case 'errored':
      case 'failed':
      case 'passed':
      case 'running':
      case 'skipped':
      case 'timeout':
        counts[node.state] += 1
        break
      // The run ended while the case ran, so it produced no result.
      case 'unfinished':
        counts.errored += 1
        break
    }
  }
  return counts
}

/**
 * Creates an empty reducer.
 *
 * Use when:
 * - a new run is attached, discovered, or replayed
 *
 * Expects:
 * - envelopes of one run, in `seq` order; duplicates (same or lower `seq`) are dropped, so re-reading a file
 *   from the start or replaying bus events after a tail read is safe
 */
export function createRunReducer(): RunReducer {
  const events: RunEvent[] = []
  // No prototype: event names are free-form, and `constructor` or `toString` must count from 0.
  const eventCounts: Record<string, number> = Object.create(null)
  const projects = new Map<string, ReducedProject>()
  const tasks = new Map<string, ReducedTask>()
  const cases = new Map<string, ReducedCase>()
  const logs: LogLine[] = []
  const metrics: MetricEntry[] = []
  const metricDefinitions = new Map<string, MetricDefinition>()
  let identity: RunIdentity | undefined
  let lastSeq = 0
  let seqGaps = 0
  let startedAt: string | undefined
  let endedAt: string | undefined
  let interruptSignal: string | undefined
  let totalTasks: number | undefined
  let terminated = false
  let lastEvent: undefined | { event: string, seq: number, time: string }
  // Settled rounds, kept here so progress does not rescan every case to draw its history.
  let completedRounds = 0
  const settlements: Settlement[] = []

  function recordSettlement(delta: number, time: string): void {
    completedRounds += delta
    settlements.push({ completed: completedRounds, time: Date.parse(time) })
  }

  function ensureProject(projectId: string): ReducedProject {
    let project = projects.get(projectId)
    if (project == null) {
      project = { id: projectId, taskIds: [] }
      projects.set(projectId, project)
    }
    return project
  }

  function ensureTask(taskId: string, projectId: string | undefined): ReducedTask {
    let task = tasks.get(taskId)
    if (task == null) {
      task = {
        caseKeys: [],
        displayName: taskId,
        id: taskId,
        projectId: projectId ?? 'unknown-project',
        state: 'queued',
      }
      tasks.set(taskId, task)
      const project = ensureProject(task.projectId)
      if (!project.taskIds.includes(taskId)) {
        project.taskIds.push(taskId)
      }
    }
    return task
  }

  function ensureCase(envelope: RunEvent, name?: string, index?: number): ReducedCase | undefined {
    if (envelope.taskId == null || envelope.caseId == null) {
      return undefined
    }
    const key = caseKeyOf(envelope.taskId, envelope.caseId)
    let reduced = cases.get(key)
    if (reduced == null) {
      reduced = {
        artifacts: [],
        caseId: envelope.caseId,
        index: index ?? parseCaseIndex(envelope.caseId),
        inference: [],
        key,
        logLineCount: 0,
        metrics: [],
        name: name ?? parseCaseName(envelope.caseId),
        projectId: envelope.projectId,
        rounds: [],
        taskId: envelope.taskId,
      }
      cases.set(key, reduced)
      const task = ensureTask(envelope.taskId, envelope.projectId)
      task.caseKeys.push(key)
    }
    return reduced
  }

  function currentRoundIndex(envelope: RunEvent): number | undefined {
    if (envelope.taskId == null || envelope.caseId == null) {
      return undefined
    }
    const reduced = cases.get(caseKeyOf(envelope.taskId, envelope.caseId))
    return reduced?.rounds.at(-1)?.roundIndex
  }

  function applyCaseStarted(envelope: RunEvent): void {
    const data = asRecord(envelope.data)
    const reduced = ensureCase(envelope, asString(data.name), asNumber(data.index))
    if (reduced == null) {
      return
    }
    if (data.input !== undefined) {
      reduced.input = data.input
    }
    const task = ensureTask(reduced.taskId, envelope.projectId)
    const total = asNumber(data.total)
    if (total != null && task.caseTotal == null) {
      task.caseTotal = total
    }
    const autoAttempt = asNumber(data.autoAttempt)
    if (autoAttempt != null) {
      reduced.autoAttempt = autoAttempt
      task.autoAttemptMax = Math.max(task.autoAttemptMax ?? 0, autoAttempt)
    }
    if (task.state === 'queued') {
      task.state = 'running'
      task.startedAt ??= envelope.time
    }

    const retryIndex = asNumber(data.retryIndex) ?? 0
    const autoRetry = asNumber(data.autoRetry) ?? 0
    const attemptIndex = asNumber(data.attemptIndex)
    const lastRound = reduced.rounds.at(-1)
    let round: MutableRound | undefined
    if (attemptIndex != null) {
      round = reduced.rounds.find(candidate => candidate.roundIndex === attemptIndex)
    }
    else if (retryIndex > 0) {
      // A retry stays in the round of the failed try.
      round = lastRound
    }

    if (round == null) {
      round = {
        roundIndex: attemptIndex ?? reduced.rounds.length,
        roundIndexInferred: attemptIndex == null,
        scores: {},
        startedAt: envelope.time,
        state: 'running',
        tries: [],
      }
      reduced.rounds.push(round)
    }

    if (round.state !== 'running') {
      // A settled round runs again (the same `attemptIndex` started twice): it no longer counts as completed.
      recordSettlement(-1, envelope.time)
    }
    const previousTry = round.tries.at(-1)
    if (previousTry != null && previousTry.state === 'running') {
      // The failed try has no `case.ended`; the next start ends it.
      previousTry.state = 'retried'
      previousTry.endedAt = envelope.time
    }
    round.state = 'running'
    round.tries.push({ autoRetry, retryIndex, startedAt: envelope.time, state: 'running' })
  }

  function applyCaseEnded(envelope: RunEvent): void {
    const data = asRecord(envelope.data)
    const reduced = ensureCase(envelope, asString(data.name), asNumber(data.index))
    if (reduced == null) {
      return
    }
    const attemptIndex = asNumber(data.attemptIndex)
    let round = attemptIndex == null
      ? reduced.rounds.at(-1)
      : reduced.rounds.find(candidate => candidate.roundIndex === attemptIndex)
    if (round == null) {
      round = {
        roundIndex: attemptIndex ?? reduced.rounds.length,
        roundIndexInferred: attemptIndex == null,
        scores: {},
        startedAt: envelope.time,
        state: 'running',
        tries: [{ autoRetry: 0, retryIndex: 0, startedAt: envelope.time, state: 'running' }],
      }
      reduced.rounds.push(round)
    }
    const state = asCaseState(data.state)
    if (round.state === 'running') {
      recordSettlement(1, envelope.time)
    }
    round.state = state
    round.endedAt = envelope.time
    const errorMessage = asString(data.errorMessage)
    if (errorMessage != null) {
      round.errorMessage = errorMessage
    }
    if (data.output !== undefined) {
      round.output = data.output
    }
    const lastTry = round.tries.at(-1)
    if (lastTry != null) {
      lastTry.state = state
      lastTry.endedAt = envelope.time
    }
    const total = asNumber(data.total)
    const task = ensureTask(reduced.taskId, envelope.projectId)
    if (total != null && task.caseTotal == null) {
      task.caseTotal = total
    }
  }

  function apply(envelope: RunEvent): ApplyResult {
    if (identity != null && envelope.runId !== identity.runId) {
      return 'foreign'
    }
    if (envelope.seq <= lastSeq) {
      return 'duplicate'
    }
    if (lastSeq > 0 && envelope.seq > lastSeq + 1) {
      seqGaps += envelope.seq - lastSeq - 1
    }
    lastSeq = envelope.seq
    identity ??= {
      attemptId: envelope.attemptId,
      experimentId: envelope.experimentId,
      runId: envelope.runId,
      workspaceId: envelope.workspaceId,
    }
    events.push(envelope)
    eventCounts[envelope.event] = (eventCounts[envelope.event] ?? 0) + 1
    lastEvent = { event: envelope.event, seq: envelope.seq, time: envelope.time }
    const data = asRecord(envelope.data)

    switch (envelope.event) {
      case 'artifact.recorded': {
        const reduced = ensureCase(envelope)
        const path = asString(data.path)
        if (path == null) {
          break
        }
        const artifact: ReducedArtifact = {
          caseId: envelope.caseId,
          contentType: asString(data.contentType) ?? 'application/octet-stream',
          description: asLocalizedText(data.description),
          label: asLocalizedText(data.label),
          name: asString(data.name) ?? path,
          path,
          purpose: asString(data.purpose),
          roundIndex: currentRoundIndex(envelope),
          seq: envelope.seq,
          size: asNumber(data.size) ?? 0,
          taskId: envelope.taskId,
        }
        if (reduced != null) {
          reduced.artifacts.push(artifact)
        }
        break
      }
      case 'case.ended':
        applyCaseEnded(envelope)
        break
      case 'case.output': {
        const content = asString(data.content) ?? ''
        const stream = data.stream === 'stderr' ? 'stderr' : 'stdout'
        const roundIndex = currentRoundIndex(envelope)
        const reduced = ensureCase(envelope)
        for (const text of splitOutputLines(content)) {
          logs.push({
            caseId: envelope.caseId,
            roundIndex,
            seq: envelope.seq,
            stream,
            taskId: envelope.taskId,
            text,
            time: envelope.time,
          })
          if (reduced != null) {
            reduced.logLineCount += 1
          }
        }
        break
      }
      case 'case.started':
        applyCaseStarted(envelope)
        break
      case 'inference.failed':
      case 'inference.requested':
      case 'inference.responded':
      case 'tool-call.ended':
      case 'tool-call.started':
        ensureCase(envelope)?.inference.push({
          data: envelope.data,
          event: envelope.event,
          roundIndex: currentRoundIndex(envelope),
          seq: envelope.seq,
          time: envelope.time,
        })
        break
      case 'metric.defined': {
        const name = asString(data.name)
        if (name == null) {
          break
        }
        const better = data.better === 'higher' || data.better === 'lower' ? data.better : undefined
        const definition: MetricDefinition = { name }
        const label = asLocalizedText(data.label)
        const description = asLocalizedText(data.description)
        const unit = asString(data.unit)
        if (better != null)
          definition.better = better
        if (description != null)
          definition.description = description
        if (label != null)
          definition.label = label
        if (unit != null)
          definition.unit = unit
        metricDefinitions.set(name, definition)
        break
      }
      case 'metric.recorded': {
        const name = asString(data.name)
        if (name == null) {
          break
        }
        const entry: MetricEntry = {
          caseId: envelope.caseId,
          name,
          roundIndex: currentRoundIndex(envelope),
          seq: envelope.seq,
          taskId: envelope.taskId,
          time: envelope.time,
          value: data.value,
        }
        metrics.push(entry)
        ensureCase(envelope)?.metrics.push(entry)
        break
      }
      case 'project.ended': {
        if (envelope.projectId == null) {
          break
        }
        const project = ensureProject(envelope.projectId)
        project.endedAt = envelope.time
        project.failed = data.failed === true
        break
      }
      case 'project.started': {
        if (envelope.projectId == null) {
          break
        }
        const project = ensureProject(envelope.projectId)
        project.startedAt ??= envelope.time
        project.taskCount = asNumber(data.taskCount) ?? project.taskCount
        break
      }
      case 'run.ended':
        terminated = true
        endedAt = envelope.time
        totalTasks = asNumber(data.totalTasks) ?? totalTasks
        break
      case 'run.interrupted':
        interruptSignal = asString(data.signal) ?? 'unknown'
        terminated = true
        endedAt = envelope.time
        break
      case 'run.started':
        startedAt ??= envelope.time
        totalTasks = asNumber(data.totalTasks) ?? totalTasks
        break
      case 'score.recorded': {
        const reduced = ensureCase(envelope)
        const round = reduced?.rounds.at(-1)
        const score = asNumber(data.score)
        if (round != null && score != null && (data.kind === 'exact' || data.kind === 'judge')) {
          round.scores[data.kind] = score
        }
        break
      }
      case 'task.ended': {
        if (envelope.taskId == null) {
          break
        }
        const task = ensureTask(envelope.taskId, envelope.projectId)
        const state = asString(data.state)
        task.state = state === 'passed' || state === 'failed' || state === 'skipped' ? state : 'failed'
        task.endedAt = envelope.time
        break
      }
      case 'task.queued': {
        if (envelope.taskId == null) {
          break
        }
        const task = ensureTask(envelope.taskId, envelope.projectId)
        task.displayName = asString(data.displayName) ?? task.displayName
        break
      }
      case 'task.started': {
        if (envelope.taskId == null) {
          break
        }
        const task = ensureTask(envelope.taskId, envelope.projectId)
        task.state = 'running'
        task.startedAt ??= envelope.time
        break
      }
      default:
        // Unknown events (plugins, newer vieval versions) are kept in the event list only.
        break
    }

    return 'applied'
  }

  return {
    apply,
    cases,
    eventCounts,
    events,
    identity: () => identity,
    logs,
    metricDefinitions,
    metrics,
    projects,
    run: () => ({ endedAt, interruptSignal, lastEvent, startedAt, terminated, totalTasks }),
    seq: () => lastSeq,
    seqGaps: () => seqGaps,
    settlements,
    tasks,
  }
}

/**
 * Cases running right now (the "current position" of the run).
 */
export function currentPosition(reducer: RunReducer, now: number): CurrentPosition {
  const run = reducer.run()
  const running: CurrentPosition['running'] = []
  if (!run.terminated) {
    for (const reduced of reducer.cases.values()) {
      const round = reduced.rounds.at(-1)
      const lastTry = round?.tries.at(-1)
      if (round == null || lastTry == null || round.state !== 'running') {
        continue
      }
      running.push({
        caseId: reduced.caseId,
        elapsedMs: Math.max(0, now - Date.parse(lastTry.startedAt)),
        name: reduced.name,
        projectId: reduced.projectId,
        retryIndex: lastTry.retryIndex,
        roundIndex: round.roundIndex,
        startedAt: lastTry.startedAt,
        taskDisplayName: reducer.tasks.get(reduced.taskId)?.displayName ?? reduced.taskId,
        taskId: reduced.taskId,
      })
    }
  }
  running.sort((left, right) => left.startedAt.localeCompare(right.startedAt))
  return { lastEvent: run.lastEvent, running }
}

/**
 * Progress and ETA of a run.
 *
 * Throughput rule shared with the terminal summary reporter (`estimateTotalDurationMs`):
 * `estimatedTotalMs = elapsed / completed × estimatedTotal`. Case totals of tasks that did not start yet are
 * extrapolated from the mean of known task totals.
 *
 * The ETA is never shorter than the time the longest running case has run so far: a case that has run for `t` is
 * expected to need about `t` more. Without this, one slow case after many fast ones gives an ETA near zero.
 */
export function estimateProgress(reducer: RunReducer, now: number): RunProgress {
  const run = reducer.run()
  const taskList = [...reducer.tasks.values()]
  const totalTasks = run.totalTasks ?? taskList.length
  const completedTasks = taskList.filter(task => task.state === 'passed' || task.state === 'failed' || task.state === 'skipped').length
  let completed = 0
  let running = 0
  let extraRounds = 0
  let longestRunningMs = 0
  for (const reduced of reducer.cases.values()) {
    for (const round of reduced.rounds) {
      if (round.roundIndex > 0) {
        extraRounds += 1
      }
      if (round.state === 'running') {
        running += 1
        const startedAt = round.tries[0]?.startedAt
        if (startedAt != null) {
          longestRunningMs = Math.max(longestRunningMs, now - Date.parse(startedAt))
        }
      }
      else {
        completed += 1
      }
    }
  }
  const lowerBound = extraRounds > 0
  const startedAtMs = run.startedAt == null ? undefined : Date.parse(run.startedAt)
  const endMs = run.endedAt == null ? now : Date.parse(run.endedAt)
  const elapsedMs = startedAtMs == null ? 0 : Math.max(0, endMs - startedAtMs)
  const history = progressHistory(reducer.settlements, startedAtMs, elapsedMs, completed)

  const knownTasks = taskList.filter(task => task.caseTotal != null)
  // Skipped tasks never start cases; they count as known with zero cases.
  const skippedWithoutCases = taskList.filter(task => task.caseTotal == null && task.state === 'skipped').length
  const knownTotal = knownTasks.reduce((sum, task) => sum + task.caseTotal!, 0)
  const unknownTasks = Math.max(0, totalTasks - knownTasks.length - skippedWithoutCases)

  if (run.terminated) {
    return {
      basis: 'ended',
      cases: { completed, estimatedTotal: completed + running, knownTotal, running: 0 },
      elapsedMs,
      history,
      lowerBound,
      ratio: 1,
      tasks: { completed: completedTasks, total: totalTasks },
    }
  }

  if (knownTasks.length === 0 || completed === 0) {
    return {
      basis: 'unknown',
      cases: { completed, knownTotal, running },
      elapsedMs,
      history,
      lowerBound,
      tasks: { completed: completedTasks, total: totalTasks },
    }
  }

  const meanTotal = knownTotal / knownTasks.length
  const estimatedTotal = Math.round(knownTotal + unknownTasks * meanTotal) + extraRounds
  const throughputEtaMs = Math.max(0, Math.round(elapsedMs / completed * estimatedTotal) - elapsedMs)
  const etaMs = running > 0 ? Math.max(throughputEtaMs, longestRunningMs) : throughputEtaMs
  return {
    basis: unknownTasks === 0 ? 'cases' : 'cases+task-extrapolation',
    cases: { completed, estimatedTotal, knownTotal, running },
    elapsedMs,
    estimatedTotalMs: elapsedMs + etaMs,
    etaMs,
    history,
    lowerBound,
    ratio: estimatedTotal === 0 ? 0 : Math.min(1, completed / estimatedTotal),
    tasks: { completed: completedTasks, total: totalTasks },
  }
}

/**
 * Parses `<entryId>::<inferenceExecutorId>::run=<runRowId>::eval=<evalRowId>` (segments URI-encoded).
 */
export function parseTaskId(taskId: string): { entryId?: string, inferenceExecutorId?: string, matrix?: TaskMatrix } {
  const segments = taskId.split('::')
  if (segments.length !== 4 || !segments[2].startsWith('run=') || !segments[3].startsWith('eval=')) {
    return {}
  }
  const runRowId = safeDecode(segments[2].slice('run='.length))
  const evalRowId = safeDecode(segments[3].slice('eval='.length))
  return {
    entryId: safeDecode(segments[0]),
    inferenceExecutorId: safeDecode(segments[1]),
    matrix: {
      eval: parseRowId(evalRowId),
      evalRowId,
      run: parseRowId(runRowId),
      runRowId,
    },
  }
}

/**
 * Task score with the rule of `describeTask` (`scoreCaseOutcomes` of `vieval/core/scoring`), so the viewer and the
 * run summary agree: every settled round of every case contributes; errored, timed-out, and unfinished rounds stay out
 * of `exact` and lower `coverage`.
 */
export function scoreRounds(rounds: readonly Pick<CaseRound, 'scores' | 'state'>[]): CaseOutcomeScores {
  return scoreCaseOutcomes(rounds.flatMap(round => round.state === 'running'
    ? []
    : [{ scores: round.scores, state: toOutcomeState(round.state) }]))
}

/**
 * Builds the API case node from a reduced case.
 */
export function toCaseNode(reduced: ReducedCase, options: { evidenceLinkCount: number, terminated: boolean }): CaseNode {
  const rounds = reduced.rounds.map(round => toRound(round, options.terminated))
  const lastRound = rounds.at(-1)
  const firstStartedAt = rounds[0]?.startedAt ?? ''
  const endedAt = lastRound?.state === 'running' || lastRound?.state === 'unfinished' ? undefined : lastRound?.endedAt
  return {
    artifactCount: reduced.artifacts.length,
    caseId: reduced.caseId,
    durationMs: endedAt == null ? undefined : Date.parse(endedAt) - Date.parse(firstStartedAt),
    endedAt,
    errorMessage: lastRound?.errorMessage,
    evidenceLinkCount: options.evidenceLinkCount,
    index: reduced.index,
    key: reduced.key,
    logLineCount: reduced.logLineCount,
    metricCount: reduced.metrics.length,
    name: reduced.name,
    projectId: reduced.projectId,
    rounds,
    scores: lastRound?.scores ?? {},
    startedAt: firstStartedAt,
    state: lastRound?.state ?? (options.terminated ? 'unfinished' : 'running'),
    taskId: reduced.taskId,
  }
}

function asCaseState(value: unknown): CaseState {
  return value === 'passed' || value === 'failed' || value === 'errored' || value === 'skipped' || value === 'timeout' ? value : 'errored'
}

/**
 * Normalizes a label or description: a string, or an object of string translations; anything else is dropped.
 *
 * Before:
 * - { en: 'Steps', 'zh-Hans': '步数', bad: 1 }
 *
 * After:
 * - { en: 'Steps', 'zh-Hans': '步数' }
 */
function asLocalizedText(value: unknown): LocalizedText | undefined {
  if (typeof value === 'string')
    return value
  const entries = Object.entries(asRecord(value)).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function parseCaseIndex(caseId: string): number {
  const index = Number.parseInt(caseId.split(':')[0] ?? '', 10)
  return Number.isNaN(index) ? 0 : index
}

function parseCaseName(caseId: string): string {
  const separator = caseId.indexOf(':')
  return safeDecode(separator === -1 ? caseId : caseId.slice(separator + 1))
}

function parseRowId(rowId: string): Record<string, string> {
  if (rowId === 'default' || !rowId.includes('=')) {
    return {}
  }
  return Object.fromEntries(new URLSearchParams(rowId))
}

/**
 * Completed rounds over time for the progress chart, at most {@link MAX_HISTORY_POINTS} points.
 *
 * The series starts at `{ completed: 0, elapsedMs: 0 }` and ends at `{ completed, elapsedMs }` (now, or the end of
 * the run), so the solid line reaches the present even while nothing settles. Longer series are downsampled by time:
 * the span is cut into equal buckets and the last point of each bucket is kept, so every bucket ends on its exact
 * count.
 *
 * Expects:
 * - `settlements` in event order (see {@link RunReducer.settlements})
 * - `startedAtMs` undefined when the run has no `run.started` yet; the series is then a single point
 */
function progressHistory(settlements: readonly Settlement[], startedAtMs: number | undefined, elapsedMs: number, completed: number): RunProgress['history'] {
  const first = { completed: 0, elapsedMs: 0 }
  const last = { completed, elapsedMs }
  if (startedAtMs == null) {
    return [last]
  }
  const points = settlements.map(settlement => ({
    completed: settlement.completed,
    // Clamped: an event stamped slightly before `run.started` (clock skew of the writer) must not go negative.
    elapsedMs: Math.min(elapsedMs, Math.max(0, settlement.time - startedAtMs)),
  }))
  // Room for the first and the last point.
  const budget = MAX_HISTORY_POINTS - 2
  if (points.length <= budget) {
    return [first, ...points, last]
  }
  // `budget - 1` wide buckets give bucket indices 0 … budget - 1 (a point at `elapsedMs` falls into the last one).
  const bucketMs = Math.max(1, elapsedMs / (budget - 1))
  const sampled: RunProgress['history'] = [first]
  for (let index = 0; index < points.length; index += 1) {
    const next = points[index + 1]
    // Keep a point when the next one falls into a later bucket (or there is none): the last point per bucket.
    if (next == null || Math.floor(next.elapsedMs / bucketMs) !== Math.floor(points[index].elapsedMs / bucketMs)) {
      sampled.push(points[index])
    }
  }
  sampled.push(last)
  return sampled
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  }
  catch {
    return value
  }
}

function splitOutputLines(content: string): string[] {
  const lines = content.split(/\r?\n/)
  if (lines.at(-1) === '') {
    lines.pop()
  }
  return lines
}

/** A round the run ended while it ran (`unfinished`) produced no result, like an errored one. */
function toOutcomeState(state: Exclude<CaseState, 'running'>): CaseOutcomeState {
  return state === 'unfinished' ? 'errored' : state
}

function toRound(round: MutableRound, terminated: boolean): CaseRound {
  const unfinished = terminated && round.state === 'running'
  return {
    endedAt: round.endedAt,
    errorMessage: round.errorMessage,
    roundIndex: round.roundIndex,
    roundIndexInferred: round.roundIndexInferred,
    scores: { ...round.scores },
    startedAt: round.startedAt,
    state: unfinished ? 'unfinished' : round.state,
    tries: round.tries.map(entry => ({
      ...entry,
      state: unfinished && entry.state === 'running' ? 'unfinished' : entry.state,
    })),
  }
}
