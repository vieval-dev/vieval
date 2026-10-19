import type { TaskCaseState, TaskConcurrencyConfig, TaskExecutionPolicy, TaskRunContext, TaskRunOutput } from '../config'
import type { RunScore, RunScoreKind } from '../core/runner'
import type { Scheduler } from '../core/scheduler/types'
import type { ScoredCaseOutcome } from '../core/scoring'
import type { TelemetryAttributeValue } from '../core/telemetry'
import type { RunEventDefinition, RunEventEmitter } from '../events'
import type { RecordArtifactOptions } from './case-artifacts'
import type { MetricAnnouncements, MetricDefinition, MetricMetadata } from './metrics'

import { errorMessageFrom, errorNameFrom, sleep } from '@moeru/std'

import { defineEval, defineTask } from '../config'
import { runWithCaseOutput } from '../core/runner/case-output'
import { createScheduler } from '../core/scheduler/runtime'
import { scoreCaseOutcomes } from '../core/scoring'
import { createNoopTelemetryRuntime } from '../core/telemetry'
import { artifactRecorded, caseEnded, caseOutput, caseRequeued, caseStarted, metricDefined, metricRecorded, scoreRecorded } from '../events'
import { createCaseArtifacts } from './case-artifacts'
import { createMetricAnnouncements } from './metrics'
import { registerEvalDefinition } from './registry'

/**
 * Per-case registration options for `caseOf`.
 */
export interface CaseRegistrationOptions<TInput> extends TaskExecutionPolicy {
  /**
   * Optional case input payload.
   */
  input: TInput
}

/**
 * Runtime context provided to a task case callback.
 */
export interface CaseRunContext<TInput> extends TaskRunContext {
  /**
   * Absolute directory for this case's files, created when read.
   *
   * Use when:
   * - case code produces logs, screenshots, or other evidence that should live with the run report
   *
   * Expects:
   * - case code may organize files inside it freely; only files passed to `recordArtifact` are announced
   */
  artifactsDirectory: string
  /**
   * Stable ids of the current execution.
   */
  ids: CaseRunIds
  /**
   * Case-scoped matrix payload.
   */
  matrix: TaskRunContext['task']['matrix'] & { inputs: TInput }
  /**
   * Records one artifact of this case and emits an `artifact.recorded` report event.
   *
   * Use when:
   * - a file should be shown and kept with the run report, for example a screenshot or an evaluator log
   *
   * Expects:
   * - exactly one of `options.body` or `options.path`
   * - `name` is the file name used when the content is written or copied into `artifactsDirectory`
   *
   * Returns:
   * - a promise that settles once the file is stored and the event is emitted
   */
  recordArtifact: (name: string, options: RecordArtifactOptions) => Promise<void>
  /**
   * Records one custom case metric into report events.
   *
   * Use when:
   * - tasks need structured benchmark metadata beyond exact/judge score families
   *
   * Expects:
   * - `metric` to be a stable metric name, or a definition from `defineMetric`
   * - `value` to be JSON-serializable
   * - `metadata` (optional) to label, describe, or give a unit to the metric; it overrides the fields of a
   *   definition one by one. Keep one set of metadata per metric name: viewers show the latest announced one.
   *
   * Returns:
   * - nothing; emits `metric.defined` first when the metadata is new or changed for this task, then
   *   `metric.recorded`
   */
  recordMetric: (metric: MetricDefinition | string, value: TelemetryAttributeValue, metadata?: MetricMetadata) => void
  /**
   * Records a custom normalized value for one case score family, replacing an earlier value of the same kind.
   *
   * Use when:
   * - one case computes a benchmark-native score that should flow into run aggregation
   *
   * Expects:
   * - `score` to stay in the `0..1` range
   */
  recordScore: (score: number, kind?: RunScoreKind) => void
  /**
   * Cooperative abort signal for the current case execution.
   */
  signal: AbortSignal
}

/**
 * Stable ids of one case execution.
 */
export interface CaseRunIds {
  /**
   * Attempt id of the run, or `local` outside `vieval run`.
   */
  attemptId: string
  /**
   * Case id within the task, the same id used by report events.
   */
  caseId: string
  /**
   * Run id, or `local` outside `vieval run`.
   */
  runId: string
  /**
   * Scheduled task id.
   */
  taskId: string
}

/**
 * Callback for one task case.
 */
export type CaseRunner<TInput> = (context: CaseRunContext<TInput>) => Promise<unknown> | unknown

/**
 * Per-group options for `casesFromInputs`.
 */
export interface CasesFromInputsOptions extends TaskExecutionPolicy {
  /**
   * Most cases of this group running at once.
   *
   * The pool is shared only by the cases of one `casesFromInputs(...)` call. Cases also need a slot in the task,
   * project, and run pools, so the value can only lower concurrency for this group.
   *
   * @default unlimited
   */
  concurrency?: number
}

/**
 * Builder callbacks passed into `describeTask`.
 */
export interface DescribeTaskBuilder {
  /**
   * Registers one explicit case.
   */
  caseOf: {
    (name: string, run: CaseRunner<undefined>): void
    <TInput>(name: string, run: CaseRunner<TInput>, options: CaseRegistrationOptions<TInput>): void
  }
  /**
   * Registers multiple cases from input list.
   */
  casesFromInputs: <TInput>(
    namePrefix: string,
    inputs: readonly TInput[],
    run: CaseRunner<TInput>,
    options?: CasesFromInputsOptions,
  ) => void
}

/**
 * Options for `describeTask`.
 */
export interface DescribeTaskOptions extends TaskExecutionPolicy {
  /**
   * Pools this task declares for its own cases.
   *
   * Use when:
   * - the cases of one task should stay below the project-wide and run-wide limits
   *
   * @default undefined
   */
  concurrency?: TaskConcurrencyConfig
  /**
   * Optional description override.
   */
  description?: string
}

/**
 * Auto attempt fields stamped on case events while a task runs auto attempts.
 */
interface CaseAutoAttempt {
  attemptIndex: number
  autoAttempt: number
}

interface CaseExecutionOutcome {
  /** The thrown value of a failed or timed-out try, for `autoRetryIf` and `autoRetryDelay`. */
  error?: unknown
  errorMessage?: string
  output?: unknown
  scoresByKind: Map<RunScoreKind, number>
  state: TaskCaseState
}

interface RegisteredCase<TInput> {
  concurrency?: number
  executionPolicy?: TaskExecutionPolicy
  input: TInput
  name: string
  queueKey?: object
  run: CaseRunner<TInput>
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}: ${String(value)}`)
  }
}

function assertNonNegativeNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${label}: ${String(value)}`)
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label}: ${String(value)}`)
  }
}

function assertValidScore(score: number): void {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error(`Case score must be a finite number in range 0..1, got "${score}".`)
  }
}

function autoRetryDelayMs(retryIndex: number): number {
  // Retry index 1 is the first retry after the initial case failure.
  return 500 * 2 ** (retryIndex - 1)
}

function canAttachMetricAsAttribute(value: TelemetryAttributeValue): value is boolean | number | readonly boolean[] | readonly number[] | readonly string[] | string {
  if (isTelemetryAttributeScalar(value)) {
    return true
  }

  return Array.isArray(value) && isTelemetryAttributeArray(value)
}

/**
 * Sorts a thrown error into a wrong result or no result.
 * `@vitest/expect` (behind the `expect` of vieval) throws chai's `AssertionError` for a failed matcher.
 */
function classifyCaseErrorByDefault(error: unknown): 'errored' | 'failed' {
  return errorNameFrom(error) === 'AssertionError' ? 'failed' : 'errored'
}

function cloneCaseMatrix(matrix: TaskRunContext['task']['matrix']): TaskRunContext['task']['matrix'] {
  return {
    eval: {
      ...matrix.eval,
    },
    meta: {
      ...matrix.meta,
    },
    run: {
      ...matrix.run,
    },
  }
}

function createCaseBuilder(registeredCases: RegisteredCase<unknown>[]): DescribeTaskBuilder {
  function registerCase(name: string, run: CaseRunner<undefined>): void
  function registerCase<TInput>(name: string, run: CaseRunner<TInput>, options: CaseRegistrationOptions<TInput>): void
  function registerCase<TInput>(
    name: string,
    run: CaseRunner<TInput> | CaseRunner<undefined>,
    options?: CaseRegistrationOptions<TInput>,
  ): void {
    registeredCases.push({
      executionPolicy: normalizeExecutionPolicy(options, 'task case'),
      input: options?.input,
      name,
      run: run as CaseRunner<unknown>,
    })
  }

  return {
    caseOf: registerCase,
    casesFromInputs(namePrefix, inputs, run, options) {
      const queueKey = options?.concurrency == null ? undefined : {}

      inputs.forEach((input, index) => {
        registeredCases.push({
          concurrency: options?.concurrency,
          executionPolicy: normalizeExecutionPolicy(options, 'casesFromInputs'),
          input,
          name: `${namePrefix} #${index + 1}`,
          queueKey,
          run: run as CaseRunner<unknown>,
        })
      })
    },
  }
}

/**
 * Creates the stable case id carried by every case event; the CLI and reports reuse it as-is.
 */
function createCaseId(index: number, name: string): string {
  return `${index}:${encodeURIComponent(name)}`
}

function createCaseTimeoutError(timeout: number): Error {
  const error = new Error(`Case timed out after ${timeout}ms.`)
  error.name = 'TimeoutError'
  return error
}

function emitCaseOutcome(
  context: TaskRunContext,
  taskCase: RegisteredCase<unknown>,
  outcome: CaseExecutionOutcome,
  index: number,
  totalCases: number,
  autoAttempt: CaseAutoAttempt | undefined,
): void {
  const errorName = outcome.error == null ? undefined : errorNameFrom(outcome.error)
  emitSafely(context.events?.scope({ caseId: createCaseId(index, taskCase.name) }), caseEnded, {
    ...autoAttempt,
    ...(outcome.errorMessage == null ? {} : { errorMessage: outcome.errorMessage }),
    ...(errorName == null ? {} : { errorName }),
    index,
    ...(outcome.output === undefined ? {} : { output: outcome.output }),
    name: taskCase.name,
    state: outcome.state,
    total: totalCases,
  })
}

/**
 * Emits one run event. Subscribers are best-effort observers, so emitter errors are swallowed.
 */
function emitSafely<TData>(events: RunEventEmitter | undefined, definition: RunEventDefinition<TData>, data: TData): void {
  if (events == null) {
    return
  }

  try {
    events.emit(definition, data).catch(() => {
      // Run event subscribers must never affect task scoring.
    })
  }
  catch {
    // Run event subscribers must never affect task scoring.
  }
}

/**
 * Runs one case through its retries and, while it still has no result, requeues it.
 *
 * Use when:
 * - a task schedules one case of one attempt
 *
 * Expects:
 * - `schedule` to admit the work through the case pools; each run is admitted separately, so a requeued case gives
 *   its slot back and waits at the end of the queue behind the cases that were waiting already
 * - `onFinal`, when given, to report the final outcome; it runs while the case still holds its slot, so
 *   `case.ended` comes before the next case of a full pool starts
 *
 * Returns:
 * - the outcome of the last run, or `undefined` when the run was interrupted before the case started
 */
async function executeCaseWithRequeue(
  context: TaskRunContext,
  taskCase: RegisteredCase<unknown>,
  index: number,
  totalCases: number,
  taskExecutionPolicy: TaskExecutionPolicy | undefined,
  autoAttempt: CaseAutoAttempt | undefined,
  schedule: <T>(execute: () => Promise<T>) => Promise<T>,
  onFinal?: (outcome: CaseExecutionOutcome) => void,
): Promise<CaseExecutionOutcome | undefined> {
  const { requeue, requeueDelay } = resolveCaseExecutionPolicy(taskCase, taskExecutionPolicy)
  let lastOutcome: CaseExecutionOutcome | undefined

  for (let requeueIndex = 0; ; requeueIndex += 1) {
    const run = await schedule(async () => {
      const outcome = await executeRegisteredCase(context, taskCase, index, totalCases, taskExecutionPolicy, autoAttempt, requeueIndex)
      // Interrupted before this run started: the previous run, if any, is the case's last word.
      const final = outcome ?? lastOutcome
      if (final == null) {
        return undefined
      }

      const requeues = outcome != null
        && (outcome.state === 'errored' || outcome.state === 'timeout')
        && requeueIndex < requeue
        && context.signal?.aborted !== true
      if (!requeues) {
        onFinal?.(final)
        return { final: true as const, outcome: final }
      }

      const errorName = outcome.error == null ? undefined : errorNameFrom(outcome.error)
      emitSafely(context.events?.scope({ caseId: createCaseId(index, taskCase.name) }), caseRequeued, {
        ...autoAttempt,
        delayMs: requeueDelay,
        ...(outcome.errorMessage == null ? {} : { errorMessage: outcome.errorMessage }),
        ...(errorName == null ? {} : { errorName }),
        index,
        name: taskCase.name,
        requeue,
        requeueIndex: requeueIndex + 1,
        state: outcome.state as 'errored' | 'timeout',
        total: totalCases,
      })
      return { final: false as const, outcome }
    })
    if (run == null || run.final) {
      return run?.outcome
    }
    lastOutcome = run.outcome

    // The wait happens without a slot, so other cases run meanwhile.
    if (requeueDelay > 0 && !(await waitUnlessAborted(requeueDelay, context.signal))) {
      // Interrupted while waiting: the requeued run is the case's last word.
      await schedule(async () => onFinal?.(run.outcome))
      return run.outcome
    }
  }
}

async function executeRegisteredCase(
  context: TaskRunContext,
  taskCase: RegisteredCase<unknown>,
  index: number,
  totalCases: number,
  taskExecutionPolicy: TaskExecutionPolicy | undefined,
  autoAttempt: CaseAutoAttempt | undefined,
  requeueIndex = 0,
): Promise<CaseExecutionOutcome | undefined> {
  const resolvedPolicy = resolveCaseExecutionPolicy(taskCase, taskExecutionPolicy)
  let lastOutcome: CaseExecutionOutcome | undefined

  for (let retryIndex = 0; retryIndex <= resolvedPolicy.autoRetry; retryIndex += 1) {
    // An interrupted run neither starts queued cases nor retries failed ones.
    if (context.signal?.aborted === true) {
      return lastOutcome
    }

    if (retryIndex > 0) {
      const retryDelayMs = resolveAutoRetryDelay(resolvedPolicy, retryIndex, lastOutcome?.error)
      assertNonNegativeNumber(retryDelayMs, 'autoRetryDelay result')

      if (retryDelayMs > 0) {
        await sleep(retryDelayMs)
      }
    }

    emitSafely(context.events?.scope({ caseId: createCaseId(index, taskCase.name) }), caseStarted, {
      ...autoAttempt,
      ...(resolvedPolicy.autoRetry > 0
        ? {
            autoRetry: resolvedPolicy.autoRetry,
            retryIndex,
          }
        : {}),
      index,
      ...(taskCase.input === undefined ? {} : { input: taskCase.input }),
      name: taskCase.name,
      ...(resolvedPolicy.requeue > 0 ? { requeue: resolvedPolicy.requeue, requeueIndex } : {}),
      total: totalCases,
    })
    lastOutcome = await runCaseOnce(context, taskCase, index, resolvedPolicy, autoAttempt)
    if (lastOutcome.state === 'passed') {
      return lastOutcome
    }
    // Asked only when a retry is left, so `retryIndex + 1` is always a retry that can start.
    // Without `autoRetryIf`, a failed assertion is a result and does not run again; use `autoAttempt` to measure flakiness.
    if (retryIndex < resolvedPolicy.autoRetry) {
      const retries = resolvedPolicy.autoRetryIf == null
        ? lastOutcome.state !== 'failed'
        : resolvedPolicy.autoRetryIf(lastOutcome.error, retryIndex + 1)
      if (!retries) {
        return lastOutcome
      }
    }
  }

  return lastOutcome ?? {
    errorMessage: 'Unknown case failure.',
    scoresByKind: new Map(),
    state: 'failed',
  }
}

function isTelemetryAttributeArray(value: readonly TelemetryAttributeValue[]): value is readonly boolean[] | readonly number[] | readonly string[] {
  return value.every(isTelemetryAttributeScalar)
}

function isTelemetryAttributeScalar(value: unknown): value is boolean | number | string {
  return typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string'
}

function normalizeExecutionPolicy(policy: TaskExecutionPolicy | undefined, label: string): TaskExecutionPolicy | undefined {
  if (policy == null) {
    return undefined
  }

  if (policy.autoAttempt != null) {
    assertNonNegativeInteger(policy.autoAttempt, `${label} autoAttempt`)
  }

  if (policy.autoRetry != null) {
    assertNonNegativeInteger(policy.autoRetry, `${label} autoRetry`)
  }

  if (policy.requeue != null) {
    assertNonNegativeInteger(policy.requeue, `${label} requeue`)
  }

  if (policy.requeueDelay != null) {
    assertNonNegativeNumber(policy.requeueDelay, `${label} requeueDelay`)
  }

  if (typeof policy.autoRetryDelay === 'number') {
    assertNonNegativeNumber(policy.autoRetryDelay, `${label} autoRetryDelay`)
  }

  if (policy.timeout != null) {
    assertPositiveInteger(policy.timeout, `${label} timeout`)
  }

  const normalized = {
    autoAttempt: policy.autoAttempt,
    autoRetry: policy.autoRetry,
    autoRetryDelay: policy.autoRetryDelay,
    autoRetryIf: policy.autoRetryIf,
    classifyError: policy.classifyError,
    requeue: policy.requeue,
    requeueDelay: policy.requeueDelay,
    timeout: policy.timeout,
  }

  return Object.values(normalized).some(value => value != null)
    ? normalized
    : undefined
}

function resolveAutoRetryDelay(policy: TaskExecutionPolicy, retryIndex: number, error: unknown): number {
  const delay = policy.autoRetryDelay

  if (delay == null) {
    return autoRetryDelayMs(retryIndex)
  }

  return typeof delay === 'number' ? delay : delay(retryIndex, error)
}

function resolveCaseExecutionPolicy(
  taskCase: RegisteredCase<unknown>,
  taskExecutionPolicy: TaskExecutionPolicy | undefined,
): Pick<TaskExecutionPolicy, 'autoRetryDelay' | 'autoRetryIf' | 'timeout'> & Required<Pick<TaskExecutionPolicy, 'autoAttempt' | 'autoRetry' | 'classifyError' | 'requeue' | 'requeueDelay'>> {
  return {
    autoAttempt: taskCase.executionPolicy?.autoAttempt ?? taskExecutionPolicy?.autoAttempt ?? 0,
    autoRetry: taskCase.executionPolicy?.autoRetry ?? taskExecutionPolicy?.autoRetry ?? 0,
    autoRetryDelay: taskCase.executionPolicy?.autoRetryDelay ?? taskExecutionPolicy?.autoRetryDelay,
    autoRetryIf: taskCase.executionPolicy?.autoRetryIf ?? taskExecutionPolicy?.autoRetryIf,
    classifyError: taskCase.executionPolicy?.classifyError ?? taskExecutionPolicy?.classifyError ?? classifyCaseErrorByDefault,
    requeue: taskCase.executionPolicy?.requeue ?? taskExecutionPolicy?.requeue ?? 0,
    requeueDelay: taskCase.executionPolicy?.requeueDelay ?? taskExecutionPolicy?.requeueDelay ?? 0,
    timeout: taskCase.executionPolicy?.timeout ?? taskExecutionPolicy?.timeout,
  }
}

function toScoredCaseOutcome(outcome: CaseExecutionOutcome): ScoredCaseOutcome {
  return {
    scores: { exact: outcome.scoresByKind.get('exact'), judge: outcome.scoresByKind.get('judge') },
    state: outcome.state,
  }
}

/**
 * Waits `milliseconds`, or until `signal` aborts.
 *
 * Returns:
 * - `true` when the wait ran out, `false` when the signal aborted it
 */
async function waitUnlessAborted(milliseconds: number, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted === true) {
    return false
  }
  return await new Promise<boolean>((resolveWait) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onAbort = () => {
      clearTimeout(timer)
      resolveWait(false)
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolveWait(true)
    }, milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Metric announcements of each running task, keyed by the task's run context.
 *
 * NOTICE:
 * Every case of one task run receives the same `TaskRunContext` object, so it identifies the task run without
 * threading a tracker through the attempt, retry, and case helpers. A `WeakMap` drops the tracker with the context.
 */
const metricAnnouncementsByTask = new WeakMap<TaskRunContext, MetricAnnouncements>()

function metricAnnouncementsOf(context: TaskRunContext): MetricAnnouncements {
  let announcements = metricAnnouncementsByTask.get(context)
  if (announcements == null) {
    announcements = createMetricAnnouncements()
    metricAnnouncementsByTask.set(context, announcements)
  }
  return announcements
}

async function runCaseOnce(
  context: TaskRunContext,
  taskCase: RegisteredCase<unknown>,
  index: number,
  policy: Pick<TaskExecutionPolicy, 'timeout'> & Required<Pick<TaskExecutionPolicy, 'classifyError'>>,
  autoAttempt: CaseAutoAttempt | undefined,
): Promise<CaseExecutionOutcome> {
  const { classifyError, timeout } = policy
  const customScoresByKind = new Map<RunScoreKind, number>()
  const abortController = new AbortController()
  const telemetry = context.telemetry ?? createNoopTelemetryRuntime()
  const caseId = createCaseId(index, taskCase.name)
  const events = context.events?.scope({ caseId })
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let settled = false
  // Interrupting the run aborts the case, so its own cleanup (`finally`, abort listeners) can run before the process exits.
  const abortOnInterrupt = () => abortController.abort(context.signal?.reason)
  context.signal?.addEventListener('abort', abortOnInterrupt, { once: true })
  // A case that swallowed the abort and returned normally still did not finish its work.
  const completedOutcome = (output: unknown): CaseExecutionOutcome => context.signal?.aborted === true
    ? {
        errorMessage: errorMessageFrom(context.signal.reason) ?? 'Run interrupted.',
        scoresByKind: customScoresByKind,
        state: 'errored',
      }
    : {
        output,
        scoresByKind: customScoresByKind,
        state: 'passed',
      }

  try {
    return await telemetry.withSpan('vieval.case', {
      ...(autoAttempt == null ? {} : { 'vieval.case.attempt_index': autoAttempt.attemptIndex }),
      'vieval.case.id': caseId,
      'vieval.case.name': taskCase.name,
      'vieval.task.id': context.task.id,
      'vieval.task.name': context.task.entry.name,
    }, async () => {
      const artifacts = createCaseArtifacts(context.runStorage?.artifactsRoot, context.task.id, caseId)
      const runCase = () => taskCase.run({
        ...context,
        get artifactsDirectory() {
          return artifacts.directory
        },
        events,
        ids: {
          attemptId: context.runStorage?.attemptId ?? 'local',
          caseId,
          runId: context.runStorage?.runId ?? 'local',
          taskId: context.task.id,
        },
        matrix: {
          ...cloneCaseMatrix(context.task.matrix),
          inputs: taskCase.input,
        },
        async recordArtifact(name, options) {
          if (abortController.signal.aborted || settled) {
            return
          }

          emitSafely(events, artifactRecorded, await artifacts.record(name, options))
        },
        recordMetric(metric, value, metadata) {
          if (abortController.signal.aborted || settled) {
            return
          }

          const { defined, name } = metricAnnouncementsOf(context).resolve(metric, metadata)
          // Metadata belongs to the task, not to this case, so it is announced without the case id.
          if (defined != null)
            emitSafely(context.events, metricDefined, defined)
          emitSafely(events, metricRecorded, { name, value })
          telemetry.addEvent('vieval.case.metric', { name, value })
          if (canAttachMetricAsAttribute(value)) {
            telemetry.setAttributes({ [name]: value })
          }
        },
        recordScore(score, kind = 'exact') {
          if (abortController.signal.aborted || settled) {
            return
          }

          assertValidScore(score)
          customScoresByKind.set(kind, score)
          telemetry.addEvent('vieval.case.score', {
            'vieval.score.kind': kind,
            'vieval.score.value': score,
          })
          emitSafely(events, scoreRecorded, { kind, score })
        },
        signal: abortController.signal,
      })
      // Without run events nobody would print captured output, so the case writes to the terminal directly.
      const runPromise = Promise.resolve(events == null
        ? runCase()
        : runWithCaseOutput((stream, content) => emitSafely(events, caseOutput, { content, stream }), runCase))

      if (timeout != null) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            timedOut = true
            abortController.abort(createCaseTimeoutError(timeout))
            reject(createCaseTimeoutError(timeout))
          }, timeout)
        })

        const output = await Promise.race([runPromise, timeoutPromise])
        settled = true
        return completedOutcome(output)
      }

      const output = await runPromise
      settled = true
      return completedOutcome(output)
    })
  }
  catch (error) {
    settled = true
    // Abort errors raised by the interrupt carry generic messages ("The operation was aborted"); the run's reason is clearer.
    const interrupted = context.signal?.aborted === true
    const interruptMessage = interrupted ? errorMessageFrom(context.signal!.reason) : undefined
    let state: TaskCaseState = 'errored'
    if (timedOut) {
      state = 'timeout'
    }
    // An interrupted run measured nothing, whatever the case threw while it stopped.
    else if (!interrupted) {
      state = classifyError(error)
    }
    return {
      error,
      errorMessage: interruptMessage ?? errorMessageFrom(error) ?? (timedOut && timeout != null ? `Case timed out after ${timeout}ms.` : 'Unknown case failure.'),
      scoresByKind: customScoresByKind,
      state,
    }
  }
  finally {
    context.signal?.removeEventListener('abort', abortOnInterrupt)
    if (timeoutHandle != null) {
      clearTimeout(timeoutHandle)
    }
  }
}

let activeCasesStack: RegisteredCase<unknown>[][] = []

/**
 * Registers one case in the currently active task scope.
 */
export function caseOf(
  name: string,
  run: CaseRunner<undefined>,
): void
export function caseOf<TInput>(
  name: string,
  run: CaseRunner<TInput>,
  options: CaseRegistrationOptions<TInput>,
): void
export function caseOf<TInput>(
  name: string,
  run: CaseRunner<TInput> | CaseRunner<undefined>,
  options?: CaseRegistrationOptions<TInput>,
): void {
  getActiveCases().push({
    executionPolicy: normalizeExecutionPolicy(options, 'task case'),
    input: options?.input,
    name,
    run: run as CaseRunner<unknown>,
  })
}

/**
 * Registers multiple cases in the currently active task scope.
 */
export function casesFromInputs<TInput>(
  namePrefix: string,
  inputs: readonly TInput[],
  run: CaseRunner<TInput>,
  options?: CasesFromInputsOptions,
): void {
  const queueKey = options?.concurrency == null ? undefined : {}

  inputs.forEach((input, index) => {
    getActiveCases().push({
      concurrency: options?.concurrency,
      executionPolicy: normalizeExecutionPolicy(options, 'casesFromInputs'),
      input,
      name: `${namePrefix} #${index + 1}`,
      queueKey,
      run: run as CaseRunner<unknown>,
    })
  })
}

/**
 * Defines one eval task with task/case semantics similar to Vitest.
 *
 * Use when:
 * - task behavior should be declared with `caseOf` and `casesFromInputs`
 * - business agent code should be imported and run from eval task files
 */
export function describeTask(
  name: string,
  build: (() => void) | ((builder: DescribeTaskBuilder) => void),
  options: DescribeTaskOptions = {},
) {
  const registeredCases: RegisteredCase<unknown>[] = []
  const builder = createCaseBuilder(registeredCases)
  withActiveCases(registeredCases, () => {
    if (build.length > 0) {
      (build as (builder: DescribeTaskBuilder) => void)(builder)
      return
    }

    ;(build as () => void)()
  })

  const description = options.description ?? name
  const taskExecutionPolicy = normalizeExecutionPolicy(options, 'describeTask')

  const definition = defineEval({
    description,
    name,
    task: defineTask({
      caseNames: registeredCases.map(taskCase => taskCase.name),
      concurrency: options.concurrency,
      executionPolicy: taskExecutionPolicy,
      id: name,
      async run(context): Promise<TaskRunOutput> {
        // `--case` runs a subset; each case keeps the index (and so the case id) it has in the full task.
        const runCases = registeredCases.flatMap((taskCase, index) => context.selectsCase == null || context.selectsCase(taskCase.name) ? [{ index, taskCase }] : [])
        if (runCases.length === 0) {
          return {
            scores: [{ kind: 'exact', score: 1 }],
          }
        }

        const totalCases = runCases.length
        // Every settled outcome of every attempt, scored together at the end.
        const settledOutcomes: ScoredCaseOutcome[] = []
        const hasAutoAttempt = runCases.some(({ taskCase }) => resolveCaseExecutionPolicy(taskCase, taskExecutionPolicy).autoAttempt > 0)
        // Outside `vieval run` there is no project or run scheduler, so the task pool is the broadest one.
        const taskScheduler = (context.scheduler ?? createScheduler()).child({
          concurrency: { case: options.concurrency?.case },
          context: { taskId: context.task.id },
        })
        const groupSchedulers = new Map<object, Scheduler>()
        // Runs one case of one attempt once it holds a slot in its group pool, the task pool, and every broader pool.
        const scheduleCase = <T>(
          taskCase: RegisteredCase<unknown>,
          index: number,
          attemptIndex: number,
          execute: () => Promise<T>,
        ): Promise<T> => {
          let scheduler = taskScheduler
          if (taskCase.queueKey != null) {
            scheduler = groupSchedulers.get(taskCase.queueKey) ?? taskScheduler.child({ concurrency: { case: taskCase.concurrency } })
            groupSchedulers.set(taskCase.queueKey, scheduler)
          }

          return scheduler.run({ attemptIndex, caseId: createCaseId(index, taskCase.name), scope: 'case' }, execute)
        }

        if (!hasAutoAttempt) {
          await Promise.all(
            runCases.map(async ({ index, taskCase }) => {
              await executeCaseWithRequeue(context, taskCase, index, totalCases, taskExecutionPolicy, undefined, async execute => await scheduleCase(taskCase, index, 0, execute), (outcome) => {
                emitCaseOutcome(context, taskCase, outcome, index, totalCases, undefined)
                settledOutcomes.push(toScoredCaseOutcome(outcome))
              })
            }),
          )
        }
        else {
          let attemptIndex = 0

          for (;;) {
            // Attempts run one after another, so they share the task and group pools without competing.
            const autoAttemptOf = (taskCase: RegisteredCase<unknown>): CaseAutoAttempt => ({
              attemptIndex,
              autoAttempt: resolveCaseExecutionPolicy(taskCase, taskExecutionPolicy).autoAttempt,
            })
            const attemptOutcomes = await Promise.all(
              runCases.map(async ({ index, taskCase }) => await executeCaseWithRequeue(
                context,
                taskCase,
                index,
                totalCases,
                taskExecutionPolicy,
                autoAttemptOf(taskCase),
                async execute => await scheduleCase(taskCase, index, attemptIndex, execute),
              )),
            )

            attemptOutcomes.forEach((outcome, position) => {
              const runCase = runCases[position]
              if (runCase == null || outcome == null) {
                return
              }

              const { index, taskCase } = runCase
              emitCaseOutcome(context, taskCase, outcome, index, totalCases, autoAttemptOf(taskCase))
              settledOutcomes.push(toScoredCaseOutcome(outcome))
            })

            const shouldContinue = context.signal?.aborted !== true && attemptOutcomes.some((outcome, position) => {
              if (outcome == null || outcome.state === 'passed') {
                return false
              }

              const taskCase = runCases[position]?.taskCase
              if (taskCase == null) {
                return false
              }

              return attemptIndex < resolveCaseExecutionPolicy(taskCase, taskExecutionPolicy).autoAttempt
            })

            if (!shouldContinue) {
              break
            }

            attemptIndex += 1
          }
        }

        const { coverage, exact, judge } = scoreCaseOutcomes(settledOutcomes)
        const scores: RunScore[] = []
        if (exact != null) {
          scores.push({ kind: 'exact', score: exact })
        }
        if (judge != null) {
          scores.push({ kind: 'judge', score: judge })
        }

        return {
          coverage,
          scores,
        }
      },
    }),
  })

  registerEvalDefinition(definition)

  return definition
}

function getActiveCases(): RegisteredCase<unknown>[] {
  const active = activeCasesStack.at(-1)
  if (active == null) {
    throw new Error('caseOf/casesFromInputs must be called inside describeTask/describeEval.')
  }

  return active
}

function withActiveCases<T>(cases: RegisteredCase<unknown>[], callback: () => T): T {
  activeCasesStack = [...activeCasesStack, cases]

  try {
    return callback()
  }
  finally {
    activeCasesStack = activeCasesStack.slice(0, -1)
  }
}

/**
 * Alias of `describeTask` for eval-centric naming.
 */
export const describeEval = describeTask
