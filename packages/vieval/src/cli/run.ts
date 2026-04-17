import type { EvalDefinition, EvalModuleMap, TaskCaseReporterEndPayload, TaskCaseReporterPayload, TaskReporterEventPayload, TaskReporterHooks } from '../config'
import type { AggregatedRunResults, ScheduledTask, ScheduledTaskExecutor, TaskExecutionContext } from '../core/runner'
import type { CliProjectExecutorContext, LoadVievalCliConfigOptions, NormalizedCliProjectConfig } from './config'
import type { CliReporter, SummaryReporter, SummaryReporterCaseStartPayload, SummaryReporterTaskQueuedPayload } from './reporters'
import type { WindowRendererTimer } from './reporters/renderers/windowed-renderer'

import process from 'node:process'

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import c from 'tinyrainbow'

import { errorMessageFrom } from '@moeru/std'

import { collectEvalEntries, createFilesystemTaskCacheRuntime, createRunnerRuntimeContext, createRunnerSchedule, createTaskExecutionContext, RunnerExecutionError, runScheduledTasks } from '../core/runner'
import { beginModuleRegistration, consumeModuleRegistrations, endModuleRegistration } from '../dsl/registry'
import { loadVievalCliConfig } from './config'
import { discoverEvalFiles } from './discovery'
import { createCliReporter } from './reporters'
import { WindowRenderer } from './reporters/renderers/windowed-renderer'

interface PreparedCliProjectExecution {
  discoveredEvalFileCount: number
  entryCount: number
  name: string
  project: NormalizedCliProjectConfig
  startedAt: number
  tasks: ScheduledTask[]
}

type PreparedCliProjectResult
  = {
    kind: 'prepared'
    prepared: PreparedCliProjectExecution
  }
  | {
    kind: 'summary'
    summary: CliProjectSummary
  }

interface RunCliReporterCounters {
  failedTasks: number
  passedTasks: number
  skippedTasks: number
}

interface RunCliProjectCaseCounters {
  failed: number
  passed: number
  seenCaseIds: Set<string>
  skipped: number
}

type CliRunReporter = Omit<CliReporter, 'onCaseStart' | 'onTaskQueued'> & {
  onCaseStart: (payload: SummaryReporterCaseStartPayload) => void
  onTaskQueued: (payload: SummaryReporterTaskQueuedPayload) => void
}

type CliTaskExecutionContext = CliProjectExecutorContext

/**
 * Reporter runtime options for `runVievalCli`.
 */
export interface RunVievalCliReporterOptions {
  clearInterval?: (timer: WindowRendererTimer) => void
  createInterval?: (callback: () => void, intervalMs: number) => WindowRendererTimer
  getColumns?: () => number
  getNow?: () => number
  getWallClockNow?: () => number
  isTTY?: boolean
  queueRenderReset?: (callback: () => void) => void
  slowThresholdMs?: number
  supportsAnsiWindowing?: boolean
  writeError?: (value: string) => void
  writeOutput?: (value: string) => void
}

/**
 * Runtime options for `runVievalCli`.
 */
export interface RunVievalCliOptions extends LoadVievalCliConfigOptions {
  /**
   * Attempt id attached to report artifacts.
   */
  attempt?: string
  /**
   * Experiment id attached to report artifacts.
   */
  experiment?: string
  /**
   * Restrict run to project names.
   *
   * @default []
   */
  project?: string[]
  /**
   * Optional report output root directory.
   */
  reportOut?: string
  /**
   * Optional reporter overrides used by CLI integration tests or custom hosts.
   */
  reporter?: RunVievalCliReporterOptions
  /**
   * Workspace id attached to report artifacts.
   */
  workspace?: string
  /**
   * Cache project identifier override used to share benchmark cache across multiple method runs.
   */
  cacheProjectName?: string
}

/**
 * Summary of one processed project.
 */
export interface CliProjectSummary {
  caseSummary?: CliProjectCaseSummary | null
  discoveredEvalFileCount: number
  durationMs?: number
  entryCount: number
  errorMessage: string | null
  executed: boolean
  matrixSummary: CliProjectMatrixSummary | null
  name: string
  result: AggregatedRunResults | null
  taskCount: number
}

/**
 * Captures case-level summary counts for one project.
 */
export interface CliProjectCaseSummary {
  failed: number
  passed: number
  skipped: number
  total: number
}

/**
 * Captures matrix-row and axis coverage for one project schedule.
 */
export interface CliProjectMatrixSummary {
  evalAxes: string[]
  evalRows: number
  runAxes: string[]
  runRows: number
}

/**
 * Final CLI output model.
 */
export interface CliRunOutput {
  attemptId?: string
  configFilePath: string | null
  experimentId?: string
  projects: CliProjectSummary[]
  reportDirectory?: string | null
  runId?: string
  workspaceId?: string
}

interface CliRunReportEvent {
  attemptId: string
  caseId?: string
  data: unknown
  event: string
  experimentId: string
  projectId?: string
  runId: string
  schemaVersion: 1
  taskId?: string
  timestamp: string
  version: 1
  workspaceId: string
}

interface CliRunIdentity {
  attemptId: string
  experimentId: string
  runId: string
  workspaceId: string
}

interface CliRunRecordedEventMetadata {
  caseId?: string
  projectName?: string
  taskId?: string
}

interface CliColorPalette {
  black: (value: string) => string
  bgCyan: (value: string) => string
  bgGreen: (value: string) => string
  bgMagenta: (value: string) => string
  bgYellow: (value: string) => string
  dim: (value: string) => string
  gray: (value: string) => string
  green: (value: string) => string
  red: (value: string) => string
  yellow: (value: string) => string
}

function shouldUseColor(): boolean {
  if (process.env.NO_COLOR != null) {
    return false
  }

  const forceColor = process.env.FORCE_COLOR
  if (forceColor != null) {
    return forceColor !== '0'
  }

  return process.stdout.isTTY === true
}

function createColorPalette(enabled: boolean): CliColorPalette {
  if (!enabled) {
    return {
      black: value => value,
      bgCyan: value => value,
      bgGreen: value => value,
      bgMagenta: value => value,
      bgYellow: value => value,
      dim: value => value,
      gray: value => value,
      green: value => value,
      red: value => value,
      yellow: value => value,
    }
  }

  return {
    black: value => c.black(value),
    bgCyan: value => c.bgCyan(value),
    bgGreen: value => c.bgGreen(value),
    bgMagenta: value => c.bgMagenta(value),
    bgYellow: value => c.bgYellow(value),
    dim: value => c.dim(value),
    gray: value => c.gray(value),
    green: value => c.green(value),
    red: value => c.red(value),
    yellow: value => c.yellow(value),
  }
}

function createProjectBadge(name: string, colors: CliColorPalette, colorEnabled: boolean): string {
  if (!colorEnabled || !c.isColorSupported) {
    return `|${name}| `
  }

  const labelColorPool = [colors.bgYellow, colors.bgCyan, colors.bgGreen, colors.bgMagenta] as const
  const seed = name
    .split('')
    .reduce((accumulator, char, index) => accumulator + char.charCodeAt(0) + index, 0)
  const background = labelColorPool[seed % labelColorPool.length]
  return `${colors.black(background(` ${name} `))} `
}

function formatDuration(durationMs: number | undefined, colors: CliColorPalette): string {
  if (durationMs == null) {
    return ''
  }

  const rounded = Math.round(durationMs)
  const color = rounded > 1_000 ? colors.yellow : colors.green
  return color(` ${rounded}${colors.dim('ms')}`)
}

async function loadEvalModules(evalFilePaths: readonly string[]): Promise<EvalModuleMap> {
  const loadedModules: EvalModuleMap = {}

  for (const [moduleIndex, evalFilePath] of evalFilePaths.entries()) {
    const moduleHref = pathToFileURL(evalFilePath).href
    const importHref = `${moduleHref}?vieval_load=${Date.now()}_${moduleIndex}`
    beginModuleRegistration(importHref)
    try {
      const moduleValue = await import(importHref)
      const registeredDefinitions = consumeModuleRegistrations(importHref)
      const defaultDefinition = (moduleValue as { default?: EvalDefinition }).default

      const definitions = [
        ...registeredDefinitions,
        ...(defaultDefinition == null ? [] : [defaultDefinition]),
      ]
      const deduplicatedDefinitions = definitions.filter((definition, index) => {
        const key = `${definition.name}::${definition.description}::${definition.task?.id ?? ''}`
        return definitions.findIndex(candidate => `${candidate.name}::${candidate.description}::${candidate.task?.id ?? ''}` === key) === index
      })

      if (deduplicatedDefinitions.length === 0) {
        continue
      }

      for (const [definitionIndex, definition] of deduplicatedDefinitions.entries()) {
        const moduleKey = definitionIndex === 0
          ? moduleHref
          : `${moduleHref}#registration-${definitionIndex + 1}`

        loadedModules[moduleKey] = {
          default: definition,
        }
      }
    }
    finally {
      endModuleRegistration()
    }
  }

  return loadedModules
}

function filterProjectsByName(projects: readonly NormalizedCliProjectConfig[], names: readonly string[]): NormalizedCliProjectConfig[] {
  if (names.length === 0) {
    return [...projects]
  }

  const nameSet = new Set(names)
  return projects.filter(project => nameSet.has(project.name))
}

function sanitizeIdentitySegment(value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) {
    return 'default'
  }

  return normalized.replace(/[^\w.-]+/g, '-')
}

function createRunIdentity(options: RunVievalCliOptions): CliRunIdentity {
  const workspaceId = sanitizeIdentitySegment(options.workspace ?? 'default-workspace')
  const experimentId = sanitizeIdentitySegment(options.experiment ?? 'default-experiment')
  const attemptId = sanitizeIdentitySegment(options.attempt ?? `attempt-${new Date().toISOString().replace(/[:.]/g, '-')}`)

  return {
    attemptId,
    experimentId,
    runId: `run-${Date.now()}-${randomUUID().slice(0, 8)}`,
    workspaceId,
  }
}

function deriveReportProjectId(output: CliRunOutput): string {
  const uniqueProjectNames = [...new Set(output.projects.map(project => project.name))]
  if (uniqueProjectNames.length === 1) {
    return sanitizeIdentitySegment(uniqueProjectNames[0] ?? 'default-project')
  }

  return 'multi-project'
}

function createEventRecorder(identity: CliRunIdentity): {
  events: CliRunReportEvent[]
  record: (event: string, payload: unknown, metadata?: CliRunRecordedEventMetadata) => void
} {
  const events: CliRunReportEvent[] = []
  const taskProjectMap = new Map<string, string>()

  return {
    events,
    record(event, payload, metadata): void {
      const maybeTaskPayload = payload as { taskId?: string, projectName?: string }
      const taskId = metadata?.taskId ?? maybeTaskPayload?.taskId
      const caseId = metadata?.caseId ?? (payload as { caseId?: string })?.caseId
      const projectName = metadata?.projectName ?? maybeTaskPayload?.projectName

      if (taskId != null && projectName != null) {
        taskProjectMap.set(taskId, projectName)
      }

      events.push({
        attemptId: identity.attemptId,
        caseId,
        data: payload,
        event,
        experimentId: identity.experimentId,
        projectId: taskId == null ? undefined : taskProjectMap.get(taskId),
        runId: identity.runId,
        schemaVersion: 1,
        taskId,
        timestamp: new Date().toISOString(),
        version: 1,
        workspaceId: identity.workspaceId,
      })
    },
  }
}

function createReporterWithEventCapture(
  reporter: CliRunReporter,
  recordEvent: (event: string, payload: unknown, metadata?: CliRunRecordedEventMetadata) => void,
): CliRunReporter {
  return {
    dispose() {
      reporter.dispose()
    },
    onCaseEnd(payload) {
      recordEvent('CaseEnded', payload)
      reporter.onCaseEnd(payload)
    },
    onCaseStart(payload) {
      recordEvent('CaseStarted', payload)
      reporter.onCaseStart(payload)
    },
    onRunEnd(payload) {
      recordEvent('RunEnded', payload)
      reporter.onRunEnd(payload)
    },
    onRunStart(payload) {
      recordEvent('RunStarted', payload)
      reporter.onRunStart(payload)
    },
    onTaskEnd(payload) {
      recordEvent('TaskEnded', payload)
      reporter.onTaskEnd(payload)
    },
    onTaskQueued(payload) {
      recordEvent('TaskQueued', payload)
      reporter.onTaskQueued(payload)
    },
    onTaskStart(payload) {
      recordEvent('TaskStarted', payload)
      reporter.onTaskStart(payload)
    },
  }
}

interface ProcessEnvSnapshotValue {
  existed: boolean
  value: string | undefined
}

function applyRunEnvironment(env: NodeJS.ProcessEnv): () => void {
  const envEntries = Object.entries(env)
  if (envEntries.length === 0) {
    return () => {}
  }

  const snapshot = new Map<string, ProcessEnvSnapshotValue>()

  for (const [key, value] of envEntries) {
    snapshot.set(key, {
      existed: Object.hasOwn(process.env, key),
      value: process.env[key],
    })

    if (value == null) {
      delete process.env[key]
      continue
    }
    process.env[key] = value
  }

  return () => {
    for (const [key, previous] of snapshot.entries()) {
      if (previous.existed) {
        if (previous.value == null) {
          delete process.env[key]
          continue
        }
        process.env[key] = previous.value
        continue
      }
      delete process.env[key]
    }
  }
}

function isSummaryReporter(reporter: CliReporter): reporter is SummaryReporter {
  return 'getWindowRows' in reporter
}

function createRunReporter(options: RunVievalCliReporterOptions | undefined): CliRunReporter {
  const reporter = createCliReporter({
    getColumns: options?.getColumns ?? (() => process.stdout.columns ?? 80),
    getNow: options?.getNow ?? (() => Date.now()),
    getWallClockNow: options?.getWallClockNow ?? (() => Date.now()),
    isTTY: options?.isTTY ?? (process.stdout.isTTY === true),
    slowThresholdMs: options?.slowThresholdMs ?? 300,
    writeError: options?.writeError ?? (value => process.stderr.write(value)),
    writeOutput: options?.writeOutput ?? (value => process.stdout.write(value)),
  })

  if (!isSummaryReporter(reporter)) {
    return {
      ...reporter,
      onCaseStart(payload) {
        reporter.onCaseStart(payload)
      },
      onTaskQueued(payload) {
        reporter.onTaskQueued(payload)
      },
    }
  }

  const rendererBaseOptions = {
    getColumns: options?.getColumns ?? (() => process.stdout.columns ?? 80),
    getWindow: () => reporter.getWindowRows(),
    queueRenderReset: options?.queueRenderReset,
    supportsAnsiWindowing: options?.supportsAnsiWindowing,
    writeOutput: options?.writeOutput ?? (value => process.stdout.write(value)),
  }
  const renderer = options?.clearInterval != null && options.createInterval != null
    ? new WindowRenderer({
        ...rendererBaseOptions,
        clearInterval: options.clearInterval,
        createInterval: options.createInterval,
      })
    : new WindowRenderer(rendererBaseOptions)

  renderer.start()

  function scheduleRender(): void {
    renderer.schedule()
  }

  return {
    dispose() {
      reporter.dispose()
      renderer.dispose()
    },
    onCaseEnd(payload) {
      reporter.onCaseEnd(payload)
      scheduleRender()
    },
    onCaseStart(payload) {
      reporter.onCaseStart(payload)
      scheduleRender()
    },
    onRunEnd(payload) {
      reporter.onRunEnd(payload)
      scheduleRender()
    },
    onRunStart(payload) {
      reporter.onRunStart(payload)
      scheduleRender()
    },
    onTaskEnd(payload) {
      reporter.onTaskEnd(payload)
      scheduleRender()
    },
    onTaskQueued(payload) {
      reporter.onTaskQueued(payload)
      scheduleRender()
    },
    onTaskStart(payload) {
      reporter.onTaskStart(payload)
      scheduleRender()
    },
  }
}

function createTaskQueuePayload(task: ScheduledTask, projectName: string): SummaryReporterTaskQueuedPayload {
  return {
    displayName: task.entry.name,
    projectName,
    taskId: task.id,
  }
}

function createTaskCaseReporterId(payload: TaskCaseReporterPayload | TaskCaseReporterEndPayload): string {
  return `${payload.index}:${encodeURIComponent(payload.name)}`
}

function createTaskReporterHooks(
  task: ScheduledTask,
  reporter: CliRunReporter,
  projectName: string,
  recordEvent: (event: string, payload: unknown, metadata?: CliRunRecordedEventMetadata) => void,
  projectCaseCounters?: RunCliProjectCaseCounters,
): TaskReporterHooks {
  function syncCaseTotal(total: number): void {
    reporter.onTaskQueued({
      taskId: task.id,
      totalCases: total,
    })
  }

  return {
    onCaseEnd(payload) {
      const caseId = createTaskCaseReporterId(payload)
      if (projectCaseCounters != null) {
        const projectCaseId = `${task.id}:${caseId}`
        if (!projectCaseCounters.seenCaseIds.has(projectCaseId)) {
          projectCaseCounters.seenCaseIds.add(projectCaseId)
          if (payload.state === 'passed') {
            projectCaseCounters.passed += 1
          }
          else if (payload.state === 'failed') {
            projectCaseCounters.failed += 1
          }
          else {
            projectCaseCounters.skipped += 1
          }
        }
      }

      syncCaseTotal(payload.total)
      reporter.onCaseEnd({
        caseId,
        state: payload.state,
        taskId: task.id,
      })
    },
    onCaseStart(payload) {
      const caseId = createTaskCaseReporterId(payload)
      syncCaseTotal(payload.total)
      reporter.onCaseStart({
        caseId,
        caseName: payload.name,
        taskId: task.id,
      })
    },
    onEvent(payload: TaskReporterEventPayload) {
      recordEvent(payload.event, payload.data, {
        caseId: payload.caseId,
        projectName,
        taskId: task.id,
      })
    },
  }
}

function createCliTaskExecutionContext(
  task: ScheduledTask,
  models: NormalizedCliProjectConfig['models'],
  cacheRootDirectory: string,
  cacheProjectName: string,
  workspaceId: string,
  reporter: CliRunReporter,
  projectName: string,
  recordEvent: (event: string, payload: unknown, metadata?: CliRunRecordedEventMetadata) => void,
  projectCaseCounters: RunCliProjectCaseCounters,
): CliTaskExecutionContext {
  return {
    ...createTaskExecutionContext({
      cache: createFilesystemTaskCacheRuntime({
        cacheRootDirectory,
        projectName: cacheProjectName,
        workspaceId,
      }),
      models,
      task,
    }),
    reporterHooks: createTaskReporterHooks(task, reporter, projectName, recordEvent, projectCaseCounters),
  }
}

function resolveTaskReporterHooks(
  task: ScheduledTask,
  context: CliProjectExecutorContext,
  reporter: CliRunReporter,
  projectName: string,
  recordEvent: (event: string, payload: unknown, metadata?: CliRunRecordedEventMetadata) => void,
  projectCaseCounters: RunCliProjectCaseCounters,
): TaskReporterHooks {
  return context.reporterHooks ?? createTaskReporterHooks(task, reporter, projectName, recordEvent, projectCaseCounters)
}

function getFailedTaskId(error: unknown): string | null {
  if (error instanceof RunnerExecutionError) {
    return error.taskId
  }

  return null
}

function createAutoTaskExecutor(
  reporter: CliRunReporter,
  projectName: string,
  recordEvent: (event: string, payload: unknown, metadata?: CliRunRecordedEventMetadata) => void,
  projectCaseCounters: RunCliProjectCaseCounters,
): ScheduledTaskExecutor {
  return async (task, context) => {
    const taskDefinition = task.entry.task
    if (taskDefinition == null) {
      throw new Error(`Missing eval task definition for entry "${task.entry.id}".`)
    }

    const output = await taskDefinition.run({
      cache: context.cache,
      model: context.model,
      reporterHooks: resolveTaskReporterHooks(task, context, reporter, projectName, recordEvent, projectCaseCounters),
      task,
    })

    return {
      entryId: task.entry.id,
      id: task.id,
      matrix: task.matrix,
      inferenceExecutorId: task.inferenceExecutor.id,
      scores: [...output.scores],
    }
  }
}

function cloneScheduledTaskMatrix(task: ScheduledTask): ScheduledTask['matrix'] {
  return {
    eval: {
      ...task.matrix.eval,
    },
    meta: {
      ...task.matrix.meta,
    },
    run: {
      ...task.matrix.run,
    },
  }
}

function createProjectMatrixSummary(tasks: readonly ScheduledTask[]): CliProjectMatrixSummary | null {
  if (tasks.length === 0) {
    return null
  }

  const runAxes = new Set<string>()
  const evalAxes = new Set<string>()
  const runRows = new Set<string>()
  const evalRows = new Set<string>()

  for (const task of tasks) {
    Object.keys(task.matrix.run).forEach(axis => runAxes.add(axis))
    Object.keys(task.matrix.eval).forEach(axis => evalAxes.add(axis))
    runRows.add(task.matrix.meta.runRowId)
    evalRows.add(task.matrix.meta.evalRowId)
  }

  return {
    evalAxes: [...evalAxes].sort(),
    evalRows: evalRows.size,
    runAxes: [...runAxes].sort(),
    runRows: runRows.size,
  }
}

async function prepareProject(project: NormalizedCliProjectConfig): Promise<PreparedCliProjectResult> {
  const startedAt = Date.now()

  try {
    const runtimeContext = await createRunnerRuntimeContext({
      cwd: project.root,
      fallbackProjectRootDirectory: project.root,
    })
    const evalFilePaths = await discoverEvalFiles({
      exclude: project.exclude,
      include: project.include,
      root: project.root,
    })
    const modules = await loadEvalModules(evalFilePaths)
    const entries = collectEvalEntries(modules, runtimeContext)
    const tasks = createRunnerSchedule({
      evalMatrix: project.evalMatrix,
      entries,
      inferenceExecutors: project.inferenceExecutors,
      runMatrix: project.runMatrix,
    })

    const hasEntryTasks = entries.some(entry => entry.task != null)

    const canAutoExecuteEntryTasks = hasEntryTasks && project.models.length > 0

    if (project.executor == null && !canAutoExecuteEntryTasks) {
      return {
        kind: 'summary',
        summary: {
          caseSummary: null,
          discoveredEvalFileCount: evalFilePaths.length,
          durationMs: Date.now() - startedAt,
          entryCount: entries.length,
          errorMessage: null,
          executed: false,
          matrixSummary: createProjectMatrixSummary(tasks),
          name: project.name,
          result: null,
          taskCount: tasks.length,
        },
      }
    }

    return {
      kind: 'prepared',
      prepared: {
        discoveredEvalFileCount: evalFilePaths.length,
        entryCount: entries.length,
        name: project.name,
        project,
        startedAt,
        tasks,
      },
    }
  }
  catch (error) {
    return {
      kind: 'summary',
      summary: {
        caseSummary: null,
        discoveredEvalFileCount: 0,
        durationMs: Date.now() - startedAt,
        entryCount: 0,
        errorMessage: errorMessageFrom(error) ?? 'Unknown project execution error.',
        executed: false,
        matrixSummary: null,
        name: project.name,
        result: null,
        taskCount: 0,
      },
    }
  }
}

async function executePreparedProject(
  prepared: PreparedCliProjectExecution,
  identity: CliRunIdentity,
  cacheProjectName: string | undefined,
  reporter: CliRunReporter,
  counters: RunCliReporterCounters,
  recordEvent: (event: string, payload: unknown, metadata?: CliRunRecordedEventMetadata) => void,
): Promise<CliProjectSummary> {
  const settledTaskIds = new Set<string>()
  const projectCaseCounters: RunCliProjectCaseCounters = {
    failed: 0,
    passed: 0,
    seenCaseIds: new Set<string>(),
    skipped: 0,
  }
  const rawTaskExecutor = prepared.project.executor ?? createAutoTaskExecutor(
    reporter,
    prepared.name,
    recordEvent,
    projectCaseCounters,
  )
  const taskExecutor: ScheduledTaskExecutor = async (task, context) => {
    const result = await rawTaskExecutor(task, context)

    return {
      ...result,
      matrix: cloneScheduledTaskMatrix(task),
    }
  }

  try {
    const aggregated = await runScheduledTasks(prepared.tasks, taskExecutor, {
      createExecutionContext(task): TaskExecutionContext {
        return createCliTaskExecutionContext(
          task,
          prepared.project.models,
          resolve(prepared.project.root, '.vieval', 'cache'),
          cacheProjectName ?? prepared.name,
          identity.workspaceId,
          reporter,
          prepared.name,
          recordEvent,
          projectCaseCounters,
        )
      },
      onTaskEnd(task, state): void {
        settledTaskIds.add(task.id)
        reporter.onTaskEnd({
          state,
          taskId: task.id,
        })

        if (state === 'passed') {
          counters.passedTasks += 1
          return
        }

        counters.failedTasks += 1
      },
      onTaskStart(task): void {
        reporter.onTaskStart({
          taskId: task.id,
        })
      },
    })

    return {
      caseSummary: {
        failed: projectCaseCounters.failed,
        passed: projectCaseCounters.passed,
        skipped: projectCaseCounters.skipped,
        total: projectCaseCounters.seenCaseIds.size,
      },
      discoveredEvalFileCount: prepared.discoveredEvalFileCount,
      durationMs: Date.now() - prepared.startedAt,
      entryCount: prepared.entryCount,
      errorMessage: null,
      executed: true,
      matrixSummary: createProjectMatrixSummary(prepared.tasks),
      name: prepared.name,
      result: aggregated,
      taskCount: prepared.tasks.length,
    }
  }
  catch (error) {
    const failedTaskId = getFailedTaskId(error)

    if (failedTaskId != null && !settledTaskIds.has(failedTaskId)) {
      counters.failedTasks += 1
      settledTaskIds.add(failedTaskId)
      reporter.onTaskEnd({
        state: 'failed',
        taskId: failedTaskId,
      })
    }

    for (const task of prepared.tasks) {
      if (settledTaskIds.has(task.id)) {
        continue
      }

      counters.skippedTasks += 1
      settledTaskIds.add(task.id)
      reporter.onTaskEnd({
        state: 'skipped',
        taskId: task.id,
      })
    }

    return {
      caseSummary: {
        failed: projectCaseCounters.failed,
        passed: projectCaseCounters.passed,
        skipped: projectCaseCounters.skipped,
        total: projectCaseCounters.seenCaseIds.size,
      },
      discoveredEvalFileCount: prepared.discoveredEvalFileCount,
      durationMs: Date.now() - prepared.startedAt,
      entryCount: prepared.entryCount,
      errorMessage: errorMessageFrom(error) ?? 'Unknown project execution error.',
      executed: false,
      matrixSummary: createProjectMatrixSummary(prepared.tasks),
      name: prepared.name,
      result: null,
      taskCount: prepared.tasks.length,
    }
  }
}

async function writeRunReportArtifacts(
  output: CliRunOutput,
  events: readonly CliRunReportEvent[],
  identity: CliRunIdentity,
  reportOut: string,
): Promise<string> {
  const projectId = deriveReportProjectId(output)
  const reportDirectory = resolve(
    reportOut,
    identity.workspaceId,
    projectId,
    identity.experimentId,
    identity.attemptId,
    identity.runId,
  )
  await mkdir(reportDirectory, { recursive: true })
  await writeFile(
    resolve(reportDirectory, 'run-summary.json'),
    `${JSON.stringify(output, null, 2)}\n`,
    'utf-8',
  )
  await writeFile(
    resolve(reportDirectory, 'events.jsonl'),
    events.map(event => JSON.stringify(event)).join('\n').concat(events.length > 0 ? '\n' : ''),
    'utf-8',
  )
  return reportDirectory
}

/**
 * Runs vieval orchestration from config and returns project-level summaries.
 *
 * Call stack:
 *
 * {@link runVievalCli}
 *   -> {@link loadVievalCliConfig}
 *   -> {@link discoverEvalFiles}
 *   -> {@link collectEvalEntries}
 *   -> {@link createRunnerSchedule}
 *   -> {@link runScheduledTasks} (optional)
 *
 * Use when:
 * - running eval collection and scheduling from a single command
 * - keeping business-agent eval files near their implementation packages
 */
export async function runVievalCli(options: RunVievalCliOptions = {}): Promise<CliRunOutput> {
  const identity = createRunIdentity(options)
  const loadedConfig = await loadVievalCliConfig({
    configFilePath: options.configFilePath,
    cwd: options.cwd,
  })
  const restoreEnvironment = applyRunEnvironment(loadedConfig.env)
  const eventRecorder = createEventRecorder(identity)
  const reporter = createReporterWithEventCapture(
    createRunReporter(options.reporter),
    eventRecorder.record,
  )

  try {
    const selectedProjects = filterProjectsByName(loadedConfig.projects, options.project ?? [])
    const preparedProjects = await Promise.all(selectedProjects.map(async project => prepareProject(project)))
    const executableProjects = preparedProjects
      .filter(project => project.kind === 'prepared')
      .map(project => project.prepared)
    const totalTasks = preparedProjects.reduce((sum, project) => {
      if (project.kind === 'prepared') {
        return sum + project.prepared.tasks.length
      }

      return sum + project.summary.taskCount
    }, 0)
    const skippedSummaryTasks = preparedProjects.reduce((sum, project) => {
      if (project.kind === 'summary') {
        return sum + project.summary.taskCount
      }

      return sum
    }, 0)
    const reporterCounters: RunCliReporterCounters = {
      failedTasks: 0,
      passedTasks: 0,
      skippedTasks: 0,
    }

    reporter.onRunStart({
      totalTasks,
    })

    for (const project of executableProjects) {
      for (const task of project.tasks) {
        reporter.onTaskQueued(createTaskQueuePayload(task, project.name))
      }
    }

    const projectSummaries: CliProjectSummary[] = []

    for (const preparedProject of preparedProjects) {
      if (preparedProject.kind === 'summary') {
        projectSummaries.push(preparedProject.summary)
        continue
      }

      projectSummaries.push(await executePreparedProject(
        preparedProject.prepared,
        identity,
        options.cacheProjectName,
        reporter,
        reporterCounters,
        eventRecorder.record,
      ))
    }

    reporter.onRunEnd({
      failedTasks: reporterCounters.failedTasks,
      passedTasks: reporterCounters.passedTasks,
      skippedTasks: reporterCounters.skippedTasks + skippedSummaryTasks,
      totalTasks,
    })

    const output: CliRunOutput = {
      attemptId: identity.attemptId,
      configFilePath: loadedConfig.configFilePath,
      experimentId: identity.experimentId,
      projects: projectSummaries,
      reportDirectory: null,
      runId: identity.runId,
      workspaceId: identity.workspaceId,
    }

    if (options.reportOut != null) {
      output.reportDirectory = await writeRunReportArtifacts(
        output,
        eventRecorder.events,
        identity,
        options.reportOut,
      )
    }

    return output
  }
  finally {
    reporter.dispose()
    restoreEnvironment()
  }
}

/**
 * Formats CLI run output as human-readable lines.
 */
export function formatVievalCliRunOutput(output: CliRunOutput): string {
  const colorEnabled = shouldUseColor()
  const colors = createColorPalette(colorEnabled)
  const lines: string[] = []
  lines.push(` ${colors.dim('RUN')}  ${colors.yellow('vieval')}`)
  lines.push(` ${colors.dim('Config')}  ${output.configFilePath ?? '(not found, using defaults)'}`)
  lines.push('')

  let passedProjects = 0
  let skippedProjects = 0
  let failedProjects = 0
  let totalTasks = 0
  let executedTasks = 0

  function formatMatrixSummary(summary: CliProjectMatrixSummary | null): string | null {
    if (summary == null) {
      return null
    }

    const runAxesLabel = summary.runAxes.length === 0 ? '-' : summary.runAxes.join('|')
    const evalAxesLabel = summary.evalAxes.length === 0 ? '-' : summary.evalAxes.join('|')
    return `matrix run ${summary.runRows} [${runAxesLabel}] / eval ${summary.evalRows} [${evalAxesLabel}]`
  }

  function formatScheduleBreakdown(project: CliProjectSummary): string | null {
    const summary = project.matrixSummary
    if (summary == null) {
      return null
    }

    if (project.taskCount <= 0 || project.entryCount <= 0 || summary.runRows <= 0 || summary.evalRows <= 0) {
      return null
    }

    const denominator = project.entryCount * summary.runRows * summary.evalRows
    if (denominator <= 0 || project.taskCount % denominator !== 0) {
      return null
    }

    const providerCount = project.taskCount / denominator

    return [
      colors.dim('schedule '),
      colors.yellow(String(project.entryCount)),
      colors.dim(' entries × '),
      colors.yellow(String(providerCount)),
      colors.dim(' inferenceExecutors × '),
      colors.yellow(String(summary.runRows)),
      colors.dim(' run rows × '),
      colors.yellow(String(summary.evalRows)),
      colors.dim(' eval rows = '),
      colors.green(String(project.taskCount)),
      colors.dim(' tasks'),
    ].join('')
  }

  for (const project of output.projects) {
    totalTasks += project.taskCount
    executedTasks += project.result?.overall.runCount ?? 0

    const badge = createProjectBadge(project.name, colors, colorEnabled)
    const isFailed = project.errorMessage != null
    if (isFailed) {
      failedProjects += 1
      lines.push(` ${colors.red('❯')} ${badge}${formatDuration(project.durationMs, colors)}`)
      lines.push(`   ${project.errorMessage}`)
      continue
    }

    if (!project.executed) {
      skippedProjects += 1
      const countLabel = colors.dim(`(${project.taskCount} tasks)`)
      const detailsLabel = colors.dim(` ${project.discoveredEvalFileCount} files, ${project.entryCount} entries, 0 runs, hybrid n/a`)
      const matrixSummary = formatMatrixSummary(project.matrixSummary)
      lines.push(` ${colors.dim('○')} ${badge}${countLabel}${detailsLabel}${formatDuration(project.durationMs, colors)}`)
      if (matrixSummary != null) {
        lines.push(`   ${colors.dim(matrixSummary)}`)
      }
      const scheduleBreakdown = formatScheduleBreakdown(project)
      if (scheduleBreakdown != null) {
        lines.push(`   ${scheduleBreakdown}`)
      }
      continue
    }

    passedProjects += 1
    const hybridAverage = project.result?.overall.hybridAverage
    const hybridAverageLabel = hybridAverage == null ? 'n/a' : String(hybridAverage)
    const runCount = project.result?.overall.runCount ?? 0
    const countLabel = colors.dim(`(${project.taskCount} tasks)`)
    const caseSummaryLabel = project.caseSummary == null
      ? ''
      : `, cases ${project.caseSummary.passed} passed | ${project.caseSummary.failed} failed`
    const detailsLabel = colors.dim(` ${project.discoveredEvalFileCount} files, ${project.entryCount} entries, ${runCount} runs${caseSummaryLabel}, hybrid ${hybridAverageLabel}`)
    const matrixSummary = formatMatrixSummary(project.matrixSummary)
    lines.push(` ${colors.green('✓')} ${badge}${countLabel}${detailsLabel}${formatDuration(project.durationMs, colors)}`)
    if (matrixSummary != null) {
      lines.push(`   ${colors.dim(matrixSummary)}`)
    }
    const scheduleBreakdown = formatScheduleBreakdown(project)
    if (scheduleBreakdown != null) {
      lines.push(`   ${scheduleBreakdown}`)
    }
  }

  lines.push('')
  if (failedProjects > 0 || skippedProjects > 0) {
    const summarySegments = [`${colors.green(String(passedProjects))} passed`]

    if (skippedProjects > 0) {
      summarySegments.push(`${colors.dim(String(skippedProjects))} skipped`)
    }

    if (failedProjects > 0) {
      summarySegments.push(`${colors.red(String(failedProjects))} failed`)
    }

    lines.push(` ${colors.dim('Projects')}  ${summarySegments.join(' | ')} (${output.projects.length})`)
  }
  else {
    lines.push(` ${colors.dim('Projects')}  ${colors.green(String(passedProjects))} passed (${output.projects.length})`)
  }
  lines.push(` ${colors.dim('Tasks')}     ${executedTasks} executed / ${totalTasks} scheduled`)

  return lines.join('\n')
}
