import type { CaseOutcomeState, HeadlineResult } from 'vieval/core/scoring'
import type { Grader, LocalizedText, ScoreRecordedData } from 'vieval/events'

import type {
  CaseCounts,
  CaseNode,
  CaseRound,
  CaseScores,
  CaseScoring,
  CaseState,
  CurrentPosition,
  LogLine,
  MetricDefinition,
  MetricEntry,
  ProjectNode,
  RunEvent,
  RunIdentity,
  RunProgress,
  ScoreDefinition,
  ScoreGraders,
  TaskMatrix,
  TaskNode,
  TryNode,
} from './contract'

import { resolveHeadline, scoreCases } from 'vieval/core/scoring'
import { scoreDefinedDataSchema, scoreRecordedDataSchema } from 'vieval/events'

import * as v from 'valibot'

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
  /** Every `score.recorded` of the case, in event order, with the round it was recorded in. */
  scoreRecords: ReducedScoreRecord[]
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
 * One `score.recorded` event, attached to its case.
 */
export interface ReducedScoreRecord {
  record: ScoreRecordedData
  roundIndex?: number
  seq: number
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
  /** Latest `score.defined` of the task per score name, in the order the task first announced them. */
  scoreDefinitions: Map<string, ScoreDefinition>
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
  /** Latest `score.defined` per score name over every task of the run. */
  readonly scoreDefinitions: ReadonlyMap<string, ScoreDefinition>
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
  errorName?: string
  output?: unknown
  requeue?: number
  requeuedAt?: string
  requeueDelayMs?: number
  roundIndex: number
  roundIndexInferred: boolean
  /** Scores of the round's current (last) try; a new try of the round starts empty. */
  scores: CaseScores
  startedAt: string
  state: CaseState
  tries: MutableTry[]
}

interface MutableTry {
  autoRetry: number
  endedAt?: string
  /** Why a requeued try went back to the queue; the round keeps only the error of its latest run. */
  errorMessage?: string
  requeueIndex: number
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
 * Adds one grader of a score to `into`, unless a grader of the same kind, model, and version is there already.
 *
 * Use when:
 * - graders of several task nodes are merged into one group, for example a comparison column
 */
export function addScoreGrader(into: ScoreGraders, name: string, grader: Grader): void {
  const graders = into[name] ?? []
  if (!graders.some(known => known.kind === grader.kind && known.model === grader.model && known.version === grader.version)) {
    graders.push(grader)
  }
  into[name] = graders
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
    const allRounds = cases.flatMap(node => node.rounds.map(round => ({ ...round, caseId: node.caseId })))
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
      scoreGraders: collectScoreGraders(task.caseKeys.flatMap(key => reducer.cases.get(key)!.scoreRecords.map(({ record }) => record)), task.scoreDefinitions),
      scoring: scoreRounds(allRounds, [...task.scoreDefinitions.values()]),
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
 * Adds the graders of score records to `into`, by score name, each distinct grader once.
 *
 * Use when:
 * - a task node or a comparison column says what produced its scores, so a comparison can tell when two columns
 *   measured one score with different graders
 *
 * Expects:
 * - `definitions` of the task the records belong to; a record without its own grader uses the definition's
 *
 * Returns:
 * - `into`, with graders told apart by kind, model, and version (the fields that change what a value means);
 *   derived records are skipped, because a derived score has no grader of its own
 */
export function collectScoreGraders(
  records: Iterable<ScoreRecordedData>,
  definitions: ReadonlyMap<string, ScoreDefinition>,
  into: ScoreGraders = {},
): ScoreGraders {
  for (const record of records) {
    const grader = record.derived === true ? undefined : record.grader ?? definitions.get(record.name)?.grader
    if (grader != null) {
      addScoreGrader(into, record.name, grader)
    }
  }
  return into
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
  const counts: CaseCounts = { errored: 0, failed: 0, passed: 0, requeued: 0, running: 0, skipped: 0, timeout: 0, total: nodes.length }
  for (const node of nodes) {
    switch (node.state) {
      case 'errored':
      case 'failed':
      case 'passed':
      case 'requeued':
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
 * Values one round counts with in each score of its task, by the rule of {@link scoreRounds}.
 *
 * Use when:
 * - a per-case value must agree with the task's means, for example the spread under a matrix cell or a metric panel
 *
 * Expects:
 * - `definitions` from {@link countingDefinitions}, so the round counts in the scores other rounds recorded
 *
 * Returns:
 * - by score name: the recorded value of a passed round, 0 for a failed round (and for an errored one with
 *   `errors: 'zero'`); a name the round does not count in (unscored, missing, excluded, still running) is absent
 */
export function countedScores(round: Pick<CaseRound, 'scores' | 'state'>, definitions: readonly ScoreDefinition[] = []): Record<string, number> {
  // Scoring a group of one round reuses the one rule instead of restating the state table here.
  return Object.fromEntries(scoreRounds([round], definitions).scores.flatMap(summary => summary.mean == null ? [] : [[summary.name, summary.mean]]))
}

/**
 * Definitions that count a part of a task's rounds in every score of the task.
 *
 * Use when:
 * - one round or a subset of rounds is scored apart from its task ({@link countedScores}, one auto attempt, one
 *   selection of cases): a failed round counts 0 even in a score only other rounds of the task recorded
 *
 * Returns:
 * - one definition per score of `scoring`, in its order: the task's `score.defined`, or a bare `{ name }`
 */
export function countingDefinitions(scoring: Pick<CaseScoring, 'scores'>, definitions: ReadonlyMap<string, ScoreDefinition>): ScoreDefinition[] {
  return scoring.scores.map(summary => definitions.get(summary.name) ?? { name: summary.name })
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
  const scoreDefinitions = new Map<string, ScoreDefinition>()
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
        scoreDefinitions: new Map(),
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
        scoreRecords: [],
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
    const requeueIndex = asNumber(data.requeueIndex) ?? 0
    const autoRetry = asNumber(data.autoRetry) ?? 0
    const attemptIndex = asNumber(data.attemptIndex)
    const lastRound = reduced.rounds.at(-1)
    let round: MutableRound | undefined
    if (attemptIndex != null) {
      round = reduced.rounds.find(candidate => candidate.roundIndex === attemptIndex)
    }
    else if (retryIndex > 0 || requeueIndex > 0) {
      // A retry, and the run after a requeue, stay in the round of the failed try.
      round = lastRound
    }

    if (round == null) {
      round = {
        roundIndex: attemptIndex ?? reduced.rounds.length,
        roundIndexInferred: attemptIndex == null,
        scores: emptyCaseScores(),
        startedAt: envelope.time,
        state: 'running',
        tries: [],
      }
      reduced.rounds.push(round)
    }

    if (round.state !== 'running' && round.state !== 'requeued') {
      // A settled round runs again (the same `attemptIndex` started twice): it no longer counts as completed.
      // A requeued round never counted as completed, so it is not taken back.
      recordSettlement(-1, envelope.time)
    }
    const previousTry = round.tries.at(-1)
    if (previousTry != null && previousTry.state === 'running') {
      // The failed try has no `case.ended`; the next start ends it.
      previousTry.state = 'retried'
      previousTry.endedAt = envelope.time
    }
    const requeue = asNumber(data.requeue)
    if (requeue != null) {
      round.requeue = requeue
    }
    if (requeueIndex > 0 && retryIndex === 0) {
      // A run after a requeue starts clean: the error that requeued it stays on its try, not on the round.
      round.errorMessage = undefined
      round.errorName = undefined
    }
    round.requeuedAt = undefined
    round.requeueDelayMs = undefined
    // Scores belong to one try: a retry, or the run after a requeue, records its own.
    round.scores = emptyCaseScores()
    round.state = 'running'
    round.tries.push({ autoRetry, requeueIndex, retryIndex, startedAt: envelope.time, state: 'running' })
  }

  /** A run ended without a result and the case went back to the queue: it waits, and has not ended. */
  function applyCaseRequeued(envelope: RunEvent): void {
    const data = asRecord(envelope.data)
    const reduced = ensureCase(envelope, asString(data.name), asNumber(data.index))
    const attemptIndex = asNumber(data.attemptIndex)
    const round = attemptIndex == null
      ? reduced?.rounds.at(-1)
      : reduced?.rounds.find(candidate => candidate.roundIndex === attemptIndex)
    if (round == null) {
      return
    }
    const lastTry = round.tries.at(-1)
    if (lastTry != null && lastTry.state === 'running') {
      lastTry.state = 'requeued'
      lastTry.endedAt = envelope.time
      lastTry.errorMessage = asString(data.errorMessage)
    }
    round.state = 'requeued'
    round.requeuedAt = envelope.time
    round.requeueDelayMs = asNumber(data.delayMs) ?? 0
    round.requeue = asNumber(data.requeue) ?? round.requeue
    round.errorMessage = asString(data.errorMessage) ?? round.errorMessage
    round.errorName = asString(data.errorName) ?? round.errorName
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
        scores: emptyCaseScores(),
        startedAt: envelope.time,
        state: 'running',
        tries: [{ autoRetry: 0, requeueIndex: 0, retryIndex: 0, startedAt: envelope.time, state: 'running' }],
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
    const errorName = asString(data.errorName)
    if (errorName != null) {
      round.errorName = errorName
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
      case 'case.requeued':
        applyCaseRequeued(envelope)
        break
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
      case 'score.defined': {
        const parsed = v.safeParse(scoreDefinedDataSchema, envelope.data)
        if (!parsed.success) {
          break
        }
        scoreDefinitions.set(parsed.output.name, parsed.output)
        if (envelope.taskId != null) {
          ensureTask(envelope.taskId, envelope.projectId).scoreDefinitions.set(parsed.output.name, parsed.output)
        }
        break
      }
      case 'score.recorded': {
        const parsed = v.safeParse(scoreRecordedDataSchema, envelope.data)
        const reduced = ensureCase(envelope)
        if (!parsed.success || reduced == null) {
          break
        }
        const record = parsed.output
        const round = reduced.rounds.at(-1)
        reduced.scoreRecords.push({ record, roundIndex: round?.roundIndex, seq: envelope.seq })
        if (round == null) {
          break
        }
        // The last record of a name in a try wins, whether it is a value or an unscored record.
        delete round.scores.values[record.name]
        delete round.scores.unscored[record.name]
        if ('value' in record) {
          round.scores.values[record.name] = record.value
        }
        else {
          round.scores.unscored[record.name] = record.unscored.reason
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
    scoreDefinitions,
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

  const waiting: CurrentPosition['waiting'] = []
  if (!run.terminated) {
    for (const reduced of reducer.cases.values()) {
      const round = reduced.rounds.at(-1)
      if (round == null || round.state !== 'requeued' || round.requeuedAt == null) {
        continue
      }
      waiting.push({
        caseId: reduced.caseId,
        delayMs: round.requeueDelayMs ?? 0,
        name: reduced.name,
        projectId: reduced.projectId,
        requeue: round.requeue ?? 0,
        requeuedAt: round.requeuedAt,
        requeueIndex: (round.tries.at(-1)?.requeueIndex ?? 0) + 1,
        taskDisplayName: reducer.tasks.get(reduced.taskId)?.displayName ?? reduced.taskId,
        taskId: reduced.taskId,
      })
    }
  }
  waiting.sort((left, right) => left.requeuedAt.localeCompare(right.requeuedAt))
  return { lastEvent: run.lastEvent, running, waiting }
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
  let waiting = 0
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
      // A requeued round waits to run again: it has not completed, and it is not running either.
      else if (round.state === 'requeued') {
        waiting += 1
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

  const { knownTasks, knownTotal, unknownTasks } = taskTotals(reducer)

  if (run.terminated) {
    return {
      basis: 'ended',
      cases: { completed, estimatedTotal: completed + running + waiting, knownTotal, running: 0, waiting: 0 },
      elapsedMs,
      history,
      lowerBound,
      ratio: 1,
      tasks: { completed: completedTasks, total: totalTasks },
    }
  }

  if (knownTasks === 0 || completed === 0) {
    return {
      basis: 'unknown',
      cases: { completed, knownTotal, running, waiting },
      elapsedMs,
      history,
      lowerBound,
      tasks: { completed: completedTasks, total: totalTasks },
    }
  }

  const estimatedTotal = expectedCases(reducer)! + extraRounds
  const throughputEtaMs = Math.max(0, Math.round(elapsedMs / completed * estimatedTotal) - elapsedMs)
  const etaMs = running > 0 ? Math.max(throughputEtaMs, longestRunningMs) : throughputEtaMs
  return {
    basis: unknownTasks === 0 ? 'cases' : 'cases+task-extrapolation',
    cases: { completed, estimatedTotal, knownTotal, running, waiting },
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
 * Cases a run is expected to settle once: the case totals of its started tasks, plus the tasks that did not start
 * yet at the mean of the known totals (rounds of auto attempts are not counted).
 *
 * Use when:
 * - telling a finished run that covered every case from one that was interrupted or ran only some tasks
 *
 * Returns:
 * - `undefined` until a task announced its case total
 */
export function expectedCases(reducer: RunReducer): number | undefined {
  const { knownTasks, knownTotal, unknownTasks } = taskTotals(reducer)
  if (knownTasks === 0)
    return undefined
  return Math.round(knownTotal + unknownTasks * (knownTotal / knownTasks))
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
 * Definitions of the named scores that have one, in the order of `names`, each name once.
 *
 * Use when:
 * - a response carries the definitions of the scores it shows (labels, descriptions, combinations, graders)
 */
export function pickScoreDefinitions(definitions: ReadonlyMap<string, ScoreDefinition>, names: Iterable<string>): ScoreDefinition[] {
  return [...new Set(names)].flatMap((name) => {
    const definition = definitions.get(name)
    return definition == null ? [] : [definition]
  })
}

/**
 * Headline of a group of tasks (a run), resolved with `resolveHeadline` of `vieval/core/scoring`.
 *
 * Use when:
 * - a run's headline is shown before, or without, the one `run-summary.json` holds
 *
 * Expects:
 * - task nodes from {@link buildTaskNodes}; tasks of one eval entry (matrix rows, executors) share their entry id, so
 *   a run whose entries use different primary scores lists one headline per entry
 *
 * Returns:
 * - `null` while no case settled, else the headline and the pooled completion rate
 */
export function resolveTaskHeadline(tasks: readonly Pick<TaskNode, 'entryId' | 'id' | 'scoring'>[]): HeadlineResult | null {
  if (tasks.every(task => task.scoring.completion.total === 0)) {
    return null
  }
  return resolveHeadline(tasks.map(task => ({ ...task.scoring, taskId: task.entryId ?? task.id })))
}

/**
 * Scores of a group of rounds with the rule of `describeTask` (`scoreCases` of `vieval/core/scoring`), so the viewer
 * and the run summary agree.
 *
 * Use when:
 * - a task, a round of a task, or a selection of cases is shown with its scores
 *
 * Expects:
 * - `definitions` of the task the rounds belong to, in declaration order
 *
 * Returns:
 * - one summary per score, plus completion and passed; every settled round counts in the scores, an unfinished round
 *   counts as errored, and running or requeued rounds are left out because they have not ended
 * - completion and passed count the last round of each case once, when rounds carry their `caseId`
 */
export function scoreRounds(rounds: readonly (Pick<CaseRound, 'scores' | 'state'> & { caseId?: string })[], definitions: readonly ScoreDefinition[] = []): CaseScoring {
  return scoreCases(rounds.flatMap(round => round.state === 'running' || round.state === 'requeued'
    ? []
    : [{ ...(round.caseId == null ? {} : { caseId: round.caseId }), scores: round.scores.values, state: toOutcomeState(round.state), unscored: round.scores.unscored }]), definitions)
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
    errorName: lastRound?.errorName,
    evidenceLinkCount: options.evidenceLinkCount,
    identity: identityOf(reduced),
    index: reduced.index,
    key: reduced.key,
    logLineCount: reduced.logLineCount,
    metricCount: reduced.metrics.length,
    name: reduced.name,
    projectId: reduced.projectId,
    rounds,
    scores: lastRound?.scores ?? emptyCaseScores(),
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

function emptyCaseScores(): CaseScores {
  return { unscored: {}, values: {} }
}

/**
 * Identity of a case across runs (see `CaseNode.identity`), resolved in the order of `vieval report compare`.
 *
 * Before:
 * - metrics `benchmark.case.id = "lim-sinx|en|none"`, name `case #2`
 * - no id metric, name `case #2`
 *
 * After:
 * - "lim-sinx|en|none"
 * - "case #2"
 */
function identityOf(reduced: ReducedCase): string {
  for (const name of ['benchmark.case.id', 'vieval.case.id']) {
    const value = reduced.metrics.findLast(metric => metric.name === name)?.value
    if (typeof value === 'string' || typeof value === 'number')
      return String(value)
  }
  return reduced.name
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

/** Case totals of a run's tasks: how many tasks announced one, their sum, and how many tasks are still unknown. */
function taskTotals(reducer: RunReducer): { knownTasks: number, knownTotal: number, unknownTasks: number } {
  const taskList = [...reducer.tasks.values()]
  const totalTasks = reducer.run().totalTasks ?? taskList.length
  const known = taskList.filter(task => task.caseTotal != null)
  // Skipped tasks never start cases; they count as known with zero cases.
  const skippedWithoutCases = taskList.filter(task => task.caseTotal == null && task.state === 'skipped').length
  return {
    knownTasks: known.length,
    knownTotal: known.reduce((sum, task) => sum + task.caseTotal!, 0),
    unknownTasks: Math.max(0, totalTasks - known.length - skippedWithoutCases),
  }
}

/** A round the run ended while it ran (`unfinished`) produced no result, like an errored one. */
function toOutcomeState(state: Exclude<CaseState, 'requeued' | 'running'>): CaseOutcomeState {
  return state === 'unfinished' ? 'errored' : state
}

function toRound(round: MutableRound, terminated: boolean): CaseRound {
  // A run that ended while the case ran, or while it waited to run again, left the case without a result.
  const unfinished = terminated && (round.state === 'running' || round.state === 'requeued')
  return {
    endedAt: round.endedAt,
    errorMessage: round.errorMessage,
    errorName: round.errorName,
    ...(round.requeue == null ? {} : { requeue: round.requeue }),
    ...(unfinished || round.requeueDelayMs == null ? {} : { requeueDelayMs: round.requeueDelayMs }),
    ...(unfinished || round.requeuedAt == null ? {} : { requeuedAt: round.requeuedAt }),
    roundIndex: round.roundIndex,
    roundIndexInferred: round.roundIndexInferred,
    scores: { unscored: { ...round.scores.unscored }, values: { ...round.scores.values } },
    startedAt: round.startedAt,
    state: unfinished ? 'unfinished' : round.state,
    tries: round.tries.map(entry => ({
      ...entry,
      state: unfinished && entry.state === 'running' ? 'unfinished' : entry.state,
    })),
  }
}
