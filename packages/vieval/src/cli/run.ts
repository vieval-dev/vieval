import type { TaskConcurrencyConfig } from '../config'
import type { AggregatedRunResults, ScheduledTask, ScheduledTaskExecutor, TaskExecutionContext } from '../core/runner'
import type { RunEventBus } from '../core/runner/event-bus'
import type { TelemetryRuntime } from '../core/telemetry'
import type { RunEventEmitter, RunEventEnvelope } from '../events'
import type { CliProjectExecutorContext, LoadVievalCliConfigOptions, NormalizedCliProjectConfig } from './config'
import type { CliReporter, SummaryReporter, SummaryReporterCaseStartPayload, SummaryReporterTaskQueuedPayload } from './reporters'
import type { WindowRendererTimer } from './reporters/renderers/windowed-renderer'

import process from 'node:process'

import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import c from 'tinyrainbow'

import { errorMessageFrom } from '@moeru/std'

import { collectEvalEntries, createFilesystemTaskCacheRuntime, createRunnerRuntimeContext, createRunnerSchedule, createSchedulerRuntime, createTaskExecutionContext, RunnerExecutionError, runScheduledTasks } from '../core/runner'
import { createProcessOutputInterceptor } from '../core/runner/case-output'
import { createRunEventBus } from '../core/runner/event-bus'
import { createNoopTelemetryRuntime, createOpenTelemetryRuntime } from '../core/telemetry'
import { caseEnded, caseOutput, caseStarted, projectEnded, projectStarted, runEnded, runStarted, taskEnded, taskQueued, taskStarted } from '../events'
import { loadVievalCliConfig } from './config'
import { discoverEvalFiles } from './discovery'
import { loadEvalModulesWithVitestRuntime } from './module-runtime'
import { writeRunReportArtifacts } from './report-artifacts'
import { createCliReporter } from './reporters'
import { WindowRenderer } from './reporters/renderers/windowed-renderer'
import { subscribeVitestCompatReporters } from './reporters/vitest-compat-reporter'

/**
 * Captures one failed case with its message for CLI and JSON debugging output.
 */
export interface CliProjectCaseFailure {
  caseId: string
  caseName: string
  errorMessage: string
  taskId: string
}

/**
 * Captures case-level summary counts for one project.
 */
export interface CliProjectCaseSummary {
  failed: number
  passed: number
  skipped: number
  timeout: number
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
 * Summary of one processed project.
 */
export interface CliProjectSummary {
  caseFailures?: CliProjectCaseFailure[]
  caseSummary?: CliProjectCaseSummary | null
  discoveredEvalFileCount: number
  durationMs?: number
  entryCount: number
  errorMessage: null | string
  executed: boolean
  matrixSummary: CliProjectMatrixSummary | null
  name: string
  result: AggregatedRunResults | null
  taskCount: number
}

/**
 * Final CLI output model.
 */
export interface CliRunOutput {
  attemptId?: string
  configFilePath: null | string
  experimentId?: string
  projects: CliProjectSummary[]
  reportDirectory?: null | string
  runId?: string
  workspaceId?: string
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
   * Optional attempt-level concurrency cap parsed by the CLI.
   */
  attemptConcurrency?: number
  /**
   * Cache project identifier override used to share benchmark cache across multiple method runs.
   */
  cacheProjectName?: string
  /**
   * Optional case-level concurrency cap parsed by the CLI.
   */
  caseConcurrency?: number
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
   * Optional project-level concurrency cap parsed by the CLI.
   */
  projectConcurrency?: number
  /**
   * Optional reporter overrides used by CLI integration tests or custom hosts.
   */
  reporter?: RunVievalCliReporterOptions
  /**
   * Optional report output root directory.
   */
  reportOut?: string
  /**
   * Optional task-level concurrency cap parsed by the CLI.
   */
  taskConcurrency?: number
  /**
   * Workspace id attached to report artifacts.
   */
  workspace?: string
  /**
   * Optional workspace-level concurrency cap parsed by the CLI.
   */
  workspaceConcurrency?: number
}

/**
 * Reporter runtime options for `runVievalCli`.
 */
export interface RunVievalCliReporterOptions {
  clearInterval?: (timer: WindowRendererTimer) => void
  createInterval?: (callback: () => void, intervalMs: number) => WindowRendererTimer
  getColumns?: () => number
  getNow?: () => number
  getRows?: () => number | undefined
  getWallClockNow?: () => number
  isTTY?: boolean
  queueRenderReset?: (callback: () => void) => void
  slowThresholdMs?: number
  supportsAnsiWindowing?: boolean
  writeError?: (value: string) => void
  writeOutput?: (value: string) => void
}

interface CliColorPalette {
  bgCyan: (value: string) => string
  bgGreen: (value: string) => string
  bgMagenta: (value: string) => string
  bgYellow: (value: string) => string
  black: (value: string) => string
  dim: (value: string) => string
  gray: (value: string) => string
  green: (value: string) => string
  red: (value: string) => string
  yellow: (value: string) => string
}

interface CliRunIdentity {
  attemptId: string
  experimentId: string
  runId: string
  workspaceId: string
}

type CliRunReporter = Omit<CliReporter, 'onCaseStart' | 'onTaskQueued'> & {
  onCaseStart: (payload: SummaryReporterCaseStartPayload) => void
  onTaskQueued: (payload: SummaryReporterTaskQueuedPayload) => void
}

type CliTaskExecutionContext = CliProjectExecutorContext

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
    experimentMatrixRows: string[]
    kind: 'prepared'
    prepared: PreparedCliProjectExecution
  }
  | {
    experimentMatrixRows: string[]
    kind: 'summary'
    summary: CliProjectSummary
  }

interface ProcessEnvSnapshotValue {
  existed: boolean
  value: string | undefined
}

interface RunCliReporterCounters {
  failedTasks: number
  passedTasks: number
  skippedTasks: number
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

  function formatMatrixSummary(summary: CliProjectMatrixSummary | null): null | string {
    if (summary == null) {
      return null
    }

    const runAxesLabel = summary.runAxes.length === 0 ? '-' : summary.runAxes.join('|')
    const evalAxesLabel = summary.evalAxes.length === 0 ? '-' : summary.evalAxes.join('|')
    return `matrix run ${summary.runRows} [${runAxesLabel}] / eval ${summary.evalRows} [${evalAxesLabel}]`
  }

  function formatScheduleBreakdown(project: CliProjectSummary): null | string {
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
    const hasFailedCases = (project.caseSummary?.failed ?? 0) > 0 || (project.caseSummary?.timeout ?? 0) > 0 || (project.caseFailures?.length ?? 0) > 0
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

    if (hasFailedCases) {
      failedProjects += 1
    }
    else {
      passedProjects += 1
    }
    const hybridAverageLabel = formatHybridAverage(project.result?.overall.hybridAverage)
    const runCount = project.result?.overall.runCount ?? 0
    const countLabel = colors.dim(`(${project.taskCount} tasks)`)
    const caseSummaryLabel = project.caseSummary == null
      ? ''
      : `, cases ${project.caseSummary.passed} passed | ${project.caseSummary.failed} failed | ${project.caseSummary.timeout} timeout`
    const detailsLabel = colors.dim(` ${project.discoveredEvalFileCount} files, ${project.entryCount} entries, ${runCount} runs${caseSummaryLabel}, hybrid ${hybridAverageLabel}`)
    const matrixSummary = formatMatrixSummary(project.matrixSummary)
    lines.push(` ${hasFailedCases ? colors.red('❯') : colors.green('✓')} ${badge}${countLabel}${detailsLabel}${formatDuration(project.durationMs, colors)}`)
    if (matrixSummary != null) {
      lines.push(`   ${colors.dim(matrixSummary)}`)
    }
    const scheduleBreakdown = formatScheduleBreakdown(project)
    if (scheduleBreakdown != null) {
      lines.push(`   ${scheduleBreakdown}`)
    }
    if ((project.caseFailures?.length ?? 0) > 0) {
      lines.push(`   ${colors.red('Failed cases:')}`)
      for (const failure of project.caseFailures!.slice(0, 5)) {
        lines.push(`   ${colors.red(`- ${failure.caseName} (${failure.taskId})`)}`)
        for (const line of failure.errorMessage.split('\n')) {
          lines.push(`     ${colors.red(line)}`)
        }
      }
      if (project.caseFailures!.length > 5) {
        lines.push(`   ${colors.dim(`... ${project.caseFailures!.length - 5} more failed cases`)}`)
      }
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

/**
 * Returns true when output contains at least one failing project/task/case outcome.
 */
export function hasRunFailures(output: CliRunOutput): boolean {
  return output.projects.some((project) => {
    if (project.errorMessage != null) {
      return true
    }

    if (project.caseSummary != null && (project.caseSummary.failed > 0 || project.caseSummary.timeout > 0)) {
      return true
    }

    return (project.caseFailures?.length ?? 0) > 0
  })
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
 *   -> {@link createRunEventBus}
 *     -> subscribers: {@link subscribeRunReporter}, {@link createEventRecorder}, {@link subscribeVitestCompatReporters}
 *   -> {@link runScheduledTasks} (optional), emitting `task.*` and, through `context.events`, `case.*`
 *
 * Use when:
 * - running eval collection and scheduling from a single command
 * - keeping business-agent eval files near their implementation packages
 */
export async function runVievalCli(options: RunVievalCliOptions = {}): Promise<CliRunOutput> {
  const loadedConfig = await loadVievalCliConfig({
    configFilePath: options.configFilePath,
    cwd: options.cwd,
  })
  const telemetry = loadedConfig.reporting?.openTelemetry?.enabled === true
    ? createOpenTelemetryRuntime()
    : createNoopTelemetryRuntime()
  const onOpenTelemetryRunEnd = loadedConfig.reporting?.openTelemetry?.enabled === true
    ? loadedConfig.reporting.openTelemetry.onRunEnd
    : undefined
  const restoreEnvironment = applyRunEnvironment(loadedConfig.env)

  let runError: unknown
  let runEndError: unknown
  let output: CliRunOutput | undefined
  let reporter: CliRunReporter | undefined
  try {
    const selectedProjects = filterProjectsByName(loadedConfig.projects, options.project ?? [])
    const preparedProjects = await Promise.all(selectedProjects.map(async project => prepareProject(project)))
    const identity = createRunIdentity(options, preparedProjects)
    const bus = createRunEventBus(identity)
    const eventRecorder = createEventRecorder(bus)
    const runReporter = createRunReporter(options.reporter)
    reporter = runReporter
    subscribeRunReporter(bus, runReporter)
    const reporterCounters = subscribeTaskCounters(bus)

    output = await telemetry.withSpan('vieval.run', {
      'vieval.attempt.id': identity.attemptId,
      'vieval.experiment.id': identity.experimentId,
      'vieval.run.id': identity.runId,
      'vieval.workspace.id': identity.workspaceId,
    }, async () => {
      const workspaceScheduler = createSchedulerRuntime({
        concurrency: {
          workspace: resolveWorkspaceConcurrency(loadedConfig, options),
        },
      })
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
      // Reporters must be subscribed before `task.queued`, so they see every module of their project.
      await Promise.all(executableProjects.map(async project => await subscribeVitestCompatReporters({
        bus,
        projectName: project.name,
        references: project.project.reporters,
      })))

      await bus.emit(runStarted, {
        totalTasks,
      })

      for (const project of executableProjects) {
        for (const task of project.tasks) {
          await bus.scope({ projectId: project.name, taskId: task.id }).emit(taskQueued, {
            displayName: formatTaskDisplayName(task),
          })
        }
      }

      const projectSummaryPairs = await Promise.all(preparedProjects.map(async (preparedProject, index) => {
        if (preparedProject.kind === 'summary') {
          return {
            index,
            summary: preparedProject.summary,
          }
        }

        return {
          index,
          summary: await telemetry.withSpan('vieval.project', {
            'vieval.project.name': preparedProject.prepared.name,
            'vieval.run.id': identity.runId,
          }, async () => await workspaceScheduler.runCase({
            experimentId: identity.experimentId,
            projectName: preparedProject.prepared.name,
            scope: 'workspace',
            workspaceId: identity.workspaceId,
          }, async () => executePreparedProject(
            preparedProject.prepared,
            identity,
            options.cacheProjectName,
            telemetry,
            bus,
            options,
          ))),
        }
      }))
      const projectSummaries = projectSummaryPairs
        .sort((left, right) => left.index - right.index)
        .map(item => item.summary)

      await bus.emit(runEnded, {
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
    })
  }
  catch (error) {
    runError = error
  }
  finally {
    if (onOpenTelemetryRunEnd != null) {
      try {
        await onOpenTelemetryRunEnd()
      }
      catch (error) {
        if (runError == null) {
          runEndError = error
        }
      }
    }
    reporter?.dispose()
    restoreEnvironment()
  }

  if (runError != null) {
    throw runError
  }

  if (runEndError != null) {
    throw runEndError
  }

  if (output == null) {
    throw new Error('Vieval run finished without output.')
  }

  return output
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

function createAutoTaskExecutor(): ScheduledTaskExecutor {
  return async (task, context) => {
    const taskDefinition = task.entry.task
    if (taskDefinition == null) {
      throw new Error(`Missing eval task definition for entry "${task.entry.id}".`)
    }

    const cliContext = context as CliProjectExecutorContext
    const output = await taskDefinition.run({
      cache: context.cache,
      events: cliContext.events,
      models: context.models,
      task,
      telemetry: cliContext.telemetry,
    })

    return {
      entryId: task.entry.id,
      id: task.id,
      inferenceExecutorId: task.inferenceExecutor.id,
      matrix: task.matrix,
      scores: [...output.scores],
    }
  }
}

function createCliTaskExecutionContext(
  task: ScheduledTask,
  models: NormalizedCliProjectConfig['models'],
  cacheRootDirectory: string,
  cacheProjectName: string,
  workspaceId: string,
  telemetry: TelemetryRuntime,
  events: RunEventEmitter,
  runtimeConcurrency: TaskConcurrencyConfig | undefined,
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
    events,
    runtimeConcurrency,
    telemetry,
  }
}

function createColorPalette(enabled: boolean): CliColorPalette {
  if (!enabled) {
    return {
      bgCyan: value => value,
      bgGreen: value => value,
      bgMagenta: value => value,
      bgYellow: value => value,
      black: value => value,
      dim: value => value,
      gray: value => value,
      green: value => value,
      red: value => value,
      yellow: value => value,
    }
  }

  return {
    bgCyan: value => c.bgCyan(value),
    bgGreen: value => c.bgGreen(value),
    bgMagenta: value => c.bgMagenta(value),
    bgYellow: value => c.bgYellow(value),
    black: value => c.black(value),
    dim: value => c.dim(value),
    gray: value => c.gray(value),
    green: value => c.green(value),
    red: value => c.red(value),
    yellow: value => c.yellow(value),
  }
}

/**
 * Keeps every run event for the report written when the run ends.
 */
function createEventRecorder(bus: RunEventBus): { events: RunEventEnvelope[] } {
  const events: RunEventEnvelope[] = []
  bus.onAny((envelope) => {
    events.push(envelope)
  })
  return { events }
}

function createExperimentMatrixRows(tasks: readonly ScheduledTask[]): string[] {
  const rows = new Set<string>()

  for (const task of tasks) {
    const runRowId = task.matrix.meta.runRowId
    const evalRowId = task.matrix.meta.evalRowId

    if (runRowId !== 'default' && evalRowId !== 'default') {
      rows.add(`run:${runRowId}+eval:${evalRowId}`)
      continue
    }

    if (runRowId !== 'default') {
      rows.add(`run:${runRowId}`)
    }

    if (evalRowId !== 'default') {
      rows.add(`eval:${evalRowId}`)
    }
  }

  return [...rows].sort((left, right) => left.localeCompare(right))
}

function createLiveRenderer(
  reporter: SummaryReporter,
  options: RunVievalCliReporterOptions | undefined,
  output: { getColumns: () => number, getRows: () => number | undefined, writeOutput: (value: string) => void },
): WindowRenderer {
  const rendererBaseOptions = {
    getColumns: output.getColumns,
    getWindow: () => reporter.getWindowRows({
      maxRows: normalizeLiveReporterMaxRows(output.getRows()),
    }),
    queueRenderReset: options?.queueRenderReset,
    supportsAnsiWindowing: options?.supportsAnsiWindowing,
    writeOutput: output.writeOutput,
  }

  return options?.clearInterval != null && options.createInterval != null
    ? new WindowRenderer({
        ...rendererBaseOptions,
        clearInterval: options.clearInterval,
        createInterval: options.createInterval,
      })
    : new WindowRenderer(rendererBaseOptions)
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

function createRunIdentity(
  options: RunVievalCliOptions,
  preparedProjects: readonly PreparedCliProjectResult[],
): CliRunIdentity {
  const workspaceId = sanitizeIdentitySegment(options.workspace ?? 'default-workspace')
  const experimentId = resolveExperimentId(options, preparedProjects)
  const attemptId = sanitizeIdentitySegment(options.attempt ?? `attempt-${new Date().toISOString().replace(/[:.]/g, '-')}`)

  return {
    attemptId,
    experimentId,
    runId: `run-${Date.now()}-${randomUUID().slice(0, 8)}`,
    workspaceId,
  }
}

/**
 * Creates the terminal reporter for one `vieval run` and takes over process output.
 *
 * Use when:
 * - `runVievalCli` starts executing prepared projects
 *
 * Expects:
 * - `dispose()` runs once the run settles, which restores `process.stdout` / `process.stderr`
 *
 * Returns:
 * - TTY: a live window where each running case shows the tail of its output; the collapsed (pnpm style)
 *   blocks of all finished cases are printed together when the run ends
 * - non-TTY: each case's full output printed as one block when the case ends
 *
 * Call stack:
 *
 * {@link runVievalCli}
 *   -> {@link createRunReporter}
 *     -> {@link createProcessOutputInterceptor}
 *       -> case output: {@link CliReporter.onCaseOutput} ({@link createCliReporter} picks TTY or non-TTY)
 *       -> other output: {@link WindowRenderer.write} (TTY) or the original stream
 */
function createRunReporter(options: RunVievalCliReporterOptions | undefined): CliRunReporter {
  const processOutput = createProcessOutputInterceptor()
  const writeOutput = options?.writeOutput ?? processOutput.writeStdout
  const writeError = options?.writeError ?? processOutput.writeStderr
  const getColumns = options?.getColumns ?? (() => process.stdout.columns ?? 80)
  const getRows = options?.getRows ?? (() => process.stdout.rows)
  // The reporter writes through the renderer, and the renderer draws the reporter's rows.
  let renderer: undefined | WindowRenderer
  const reporter = createCliReporter({
    getColumns,
    getNow: options?.getNow ?? (() => Date.now()),
    getWallClockNow: options?.getWallClockNow ?? (() => Date.now()),
    isTTY: options?.isTTY ?? (process.stdout.isTTY === true),
    slowThresholdMs: options?.slowThresholdMs ?? 300,
    writeError,
    // Case blocks printed at run end must land above the live window, not inside it.
    writeOutput: value => renderer == null ? writeOutput(value) : renderer.write(value),
  })
  renderer = isSummaryReporter(reporter)
    ? createLiveRenderer(reporter, options, { getColumns, getRows, writeOutput })
    : undefined

  // Output written outside of a case (for example by project executors or plugins) is printed
  // above the live window instead of tearing through it.
  processOutput.start((stream, content) => {
    if (renderer != null) {
      renderer.write(content)
      return
    }
    if (stream === 'stderr') {
      writeError(content)
      return
    }
    writeOutput(content)
  })
  renderer?.start()

  // Every lifecycle event can change the live window; `schedule()` renders at most once per reset window.
  function withRender<TPayload>(handle: (payload: TPayload) => void): (payload: TPayload) => void {
    return (payload) => {
      handle(payload)
      renderer?.schedule()
    }
  }

  return {
    dispose() {
      processOutput.restore()
      reporter.dispose()
      renderer?.dispose()
    },
    onCaseEnd: withRender(payload => reporter.onCaseEnd(payload)),
    onCaseOutput: withRender(payload => reporter.onCaseOutput(payload)),
    onCaseStart: withRender(payload => reporter.onCaseStart(payload)),
    onRunEnd: withRender(payload => reporter.onRunEnd(payload)),
    onRunStart: withRender(payload => reporter.onRunStart(payload)),
    onTaskEnd: withRender(payload => reporter.onTaskEnd(payload)),
    onTaskQueued: withRender(payload => reporter.onTaskQueued(payload)),
    onTaskStart: withRender(payload => reporter.onTaskStart(payload)),
  }
}

function createScheduledTaskWithRuntimeConcurrency(
  task: ScheduledTask,
  project: NormalizedCliProjectConfig,
  options: RunVievalCliOptions,
): ScheduledTask {
  const taskDefinition = task.entry.task
  if (taskDefinition == null) {
    return task
  }

  const concurrency = resolveRuntimeTaskConcurrency(taskDefinition.concurrency, project, options)

  return {
    ...task,
    entry: {
      ...task.entry,
      task: {
        ...taskDefinition,
        concurrency,
      },
    },
  }
}

async function executePreparedProject(
  prepared: PreparedCliProjectExecution,
  identity: CliRunIdentity,
  cacheProjectName: string | undefined,
  telemetry: TelemetryRuntime,
  bus: RunEventBus,
  options: RunVievalCliOptions,
): Promise<CliProjectSummary> {
  const settledTaskIds = new Set<string>()
  const projectEvents = bus.scope({ projectId: prepared.name })
  const caseSummary = subscribeProjectCaseSummary(bus, prepared.name)
  const rawTaskExecutor = prepared.project.executor ?? createAutoTaskExecutor()
  const taskExecutor: ScheduledTaskExecutor = async (task, context) => {
    const runtimeTask = createScheduledTaskWithRuntimeConcurrency(task, prepared.project, options)
    const result = await telemetry.withSpan('vieval.task', {
      'vieval.project.name': prepared.name,
      'vieval.run.id': identity.runId,
      'vieval.task.entry.id': runtimeTask.entry.id,
      'vieval.task.id': runtimeTask.id,
      'vieval.task.name': runtimeTask.entry.name,
    }, async () => await rawTaskExecutor(runtimeTask, context))

    return {
      ...result,
      matrix: cloneScheduledTaskMatrix(runtimeTask),
    }
  }

  await projectEvents.emit(projectStarted, {
    taskCount: prepared.tasks.length,
  })

  try {
    const aggregated = await runScheduledTasks(prepared.tasks, taskExecutor, {
      createExecutionContext(task): TaskExecutionContext {
        return createCliTaskExecutionContext(
          task,
          prepared.project.models,
          resolve(prepared.project.root, '.vieval', 'cache'),
          cacheProjectName ?? prepared.name,
          identity.workspaceId,
          telemetry,
          projectEvents.scope({ taskId: task.id }),
          resolveCliRuntimeConcurrency(options),
        )
      },
      maxConcurrency: resolveScheduledTaskConcurrency(prepared.project, options),
      onTaskEnd(task, state): void {
        settledTaskIds.add(task.id)
        void projectEvents.scope({ taskId: task.id }).emit(taskEnded, { state })
      },
      onTaskStart(task): void {
        void projectEvents.scope({ taskId: task.id }).emit(taskStarted, {})
      },
    })

    await projectEvents.emit(projectEnded, {
      failed: false,
    })

    return {
      caseFailures: caseSummary.failures,
      caseSummary: caseSummary.toSummary(),
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
      settledTaskIds.add(failedTaskId)
      await projectEvents.scope({ taskId: failedTaskId }).emit(taskEnded, { state: 'failed' })
    }

    for (const task of prepared.tasks) {
      if (settledTaskIds.has(task.id)) {
        continue
      }

      settledTaskIds.add(task.id)
      await projectEvents.scope({ taskId: task.id }).emit(taskEnded, { state: 'skipped' })
    }

    await projectEvents.emit(projectEnded, {
      failed: true,
    })

    return {
      caseFailures: caseSummary.failures,
      caseSummary: caseSummary.toSummary(),
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

function filterProjectsByName(projects: readonly NormalizedCliProjectConfig[], names: readonly string[]): NormalizedCliProjectConfig[] {
  if (names.length === 0) {
    return [...projects]
  }

  const nameSet = new Set(names)
  return projects.filter(project => nameSet.has(project.name))
}

function formatDuration(durationMs: number | undefined, colors: CliColorPalette): string {
  if (durationMs == null) {
    return ''
  }

  const rounded = Math.round(durationMs)
  const color = rounded > 1_000 ? colors.yellow : colors.green
  return color(` ${rounded}${colors.dim('ms')}`)
}

function formatHybridAverage(hybridAverage: null | number | undefined): string {
  if (hybridAverage == null) {
    return 'n/a'
  }

  return hybridAverage.toFixed(3).replace(/\.?0+$/, '')
}

/**
 * Normalizes a scheduled task into the label shown in the live window and case output headers.
 * Matrix rows of one eval share the entry name, so the selected row values tell them apart.
 *
 * Before:
 * - entry name "osworld", runRowId "model=gpt-5.5&repeat=1"
 * - entry name "osworld", runRowId "default"
 *
 * After:
 * - "osworld [model=gpt-5.5, repeat=1]"
 * - "osworld"
 */
function formatTaskDisplayName(task: ScheduledTask): string {
  const rows = [task.matrix.meta.runRowId, task.matrix.meta.evalRowId]
    .filter(rowId => rowId !== 'default')
    .flatMap(rowId => rowId.split('&').map(segment => decodeURIComponent(segment)))

  return rows.length === 0 ? task.entry.name : `${task.entry.name} [${rows.join(', ')}]`
}

function getFailedTaskId(error: unknown): null | string {
  if (error instanceof RunnerExecutionError) {
    return error.taskId
  }

  return null
}

function isSummaryReporter(reporter: CliReporter): reporter is SummaryReporter {
  return 'getWindowRows' in reporter
}

/**
 * Normalizes terminal row count into the live reporter window height.
 *
 * Before:
 * - undefined
 * - 4
 * - 40
 *
 * After:
 * - 23
 * - 6
 * - 39
 */
function normalizeLiveReporterMaxRows(rows: number | undefined): number {
  const visibleRows = rows == null || !Number.isFinite(rows) || rows <= 0
    ? 24
    : Math.floor(rows)

  // Keep one physical terminal row free so cursor-up based redraws do not
  // scroll the previous frame out of the region that can be cleared.
  return Math.max(6, visibleRows - 1)
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
    const modules = await loadEvalModulesWithVitestRuntime(evalFilePaths, project.root)
    const entries = collectEvalEntries(modules, runtimeContext)
    const tasks = createRunnerSchedule({
      entries,
      evalMatrix: project.evalMatrix,
      inferenceExecutors: project.inferenceExecutors,
      runMatrix: project.runMatrix,
    })

    const hasEntryTasks = entries.some(entry => entry.task != null)

    const canAutoExecuteEntryTasks = hasEntryTasks && project.models.length > 0

    if (project.executor == null && !canAutoExecuteEntryTasks) {
      return {
        experimentMatrixRows: createExperimentMatrixRows(tasks),
        kind: 'summary',
        summary: {
          caseFailures: [],
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
      experimentMatrixRows: createExperimentMatrixRows(tasks),
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
      experimentMatrixRows: [],
      kind: 'summary',
      summary: {
        caseFailures: [],
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

function resolveCappedConcurrency(
  defaultConcurrency: number | undefined,
  cliConcurrency: number | undefined,
  fallback: number,
): number {
  const effectiveDefault = defaultConcurrency ?? fallback
  if (cliConcurrency == null) {
    return effectiveDefault
  }

  return Math.min(effectiveDefault, cliConcurrency)
}

function resolveCliRuntimeConcurrency(options: RunVievalCliOptions): TaskConcurrencyConfig | undefined {
  if (options.attemptConcurrency == null && options.caseConcurrency == null) {
    return undefined
  }

  return {
    attempt: options.attemptConcurrency,
    case: options.caseConcurrency,
  }
}

function resolveExperimentId(
  options: RunVievalCliOptions,
  preparedProjects: readonly PreparedCliProjectResult[],
): string {
  if (options.experiment != null) {
    return sanitizeIdentitySegment(options.experiment)
  }

  const matrixRows = new Set<string>()
  for (const project of preparedProjects) {
    project.experimentMatrixRows.forEach(row => matrixRows.add(row))
  }

  if (matrixRows.size === 0) {
    return 'default-experiment'
  }

  return sanitizeIdentitySegment(`matrix-${[...matrixRows].sort().join('--')}`)
}

function resolveOptionalRuntimeTaskConcurrency(
  defaultConcurrency: number | undefined,
  cliConcurrency: number | undefined,
): number | undefined {
  return cliConcurrency ?? defaultConcurrency
}

function resolveProjectConcurrency(
  project: NormalizedCliProjectConfig,
  options: RunVievalCliOptions,
): number {
  return resolveCappedConcurrency(project.concurrency?.project, options.projectConcurrency, Number.POSITIVE_INFINITY)
}

function resolveRuntimeTaskConcurrency(
  taskConcurrency: TaskConcurrencyConfig | undefined,
  project: NormalizedCliProjectConfig,
  options: RunVievalCliOptions,
): TaskConcurrencyConfig | undefined {
  const attempt = resolveOptionalRuntimeTaskConcurrency(
    taskConcurrency?.attempt ?? project.concurrency?.attempt,
    options.attemptConcurrency,
  )
  const caseConcurrency = resolveOptionalRuntimeTaskConcurrency(
    taskConcurrency?.case ?? project.concurrency?.case,
    options.caseConcurrency,
  )

  if (attempt == null && caseConcurrency == null) {
    return undefined
  }

  return {
    attempt,
    case: caseConcurrency,
  }
}

function resolveScheduledTaskConcurrency(
  project: NormalizedCliProjectConfig,
  options: RunVievalCliOptions,
): number {
  return Math.min(
    resolveProjectConcurrency(project, options),
    resolveTaskConcurrency(project, options),
  )
}

function resolveTaskConcurrency(
  project: NormalizedCliProjectConfig,
  options: RunVievalCliOptions,
): number {
  return resolveCappedConcurrency(project.concurrency?.task, options.taskConcurrency, 1)
}

function resolveWorkspaceConcurrency(
  loadedConfig: Awaited<ReturnType<typeof loadVievalCliConfig>>,
  options: RunVievalCliOptions,
): number {
  return resolveCappedConcurrency(loadedConfig.concurrency?.workspace, options.workspaceConcurrency, 1)
}

function sanitizeIdentitySegment(value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) {
    return 'default'
  }

  return normalized.replace(/[^\w.-]+/g, '-')
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

/**
 * Counts the case results of one project from `case.ended` events.
 *
 * Returns:
 * - the failures list, filled as cases fail, and a snapshot function for the project summary
 */
function subscribeProjectCaseSummary(bus: RunEventBus, projectName: string): {
  failures: CliProjectCaseFailure[]
  toSummary: () => CliProjectCaseSummary
} {
  const counters = { failed: 0, passed: 0, skipped: 0, timeout: 0 }
  const seenCaseIds = new Set<string>()
  const failures: CliProjectCaseFailure[] = []

  bus.on(caseEnded, ({ caseId, data, projectId, taskId }) => {
    if (projectId !== projectName || taskId == null || caseId == null) {
      return
    }

    const projectCaseId = `${taskId}:${caseId}`
    if (!seenCaseIds.has(projectCaseId)) {
      seenCaseIds.add(projectCaseId)
      counters[data.state] += 1
    }

    if ((data.state === 'failed' || data.state === 'timeout') && data.errorMessage != null) {
      failures.push({
        caseId,
        caseName: data.name,
        errorMessage: data.errorMessage,
        taskId,
      })
    }
  })

  return {
    failures,
    toSummary: () => ({ ...counters, total: seenCaseIds.size }),
  }
}

/**
 * Forwards run events to the terminal reporter.
 *
 * Use when:
 * - the live window and case output blocks should follow the run's lifecycle
 *
 * Expects:
 * - it is called before `run.started` is emitted
 */
function subscribeRunReporter(bus: RunEventBus, reporter: CliRunReporter): void {
  bus.on(runStarted, ({ data }) => reporter.onRunStart(data))
  bus.on(taskQueued, ({ data, projectId, taskId }) => {
    if (taskId != null) {
      reporter.onTaskQueued({ displayName: data.displayName, projectName: projectId, taskId })
    }
  })
  bus.on(taskStarted, ({ taskId }) => {
    if (taskId != null) {
      reporter.onTaskStart({ taskId })
    }
  })
  bus.on(taskEnded, ({ data, taskId }) => {
    if (taskId != null) {
      reporter.onTaskEnd({ state: data.state, taskId })
    }
  })
  bus.on(caseStarted, ({ caseId, data, taskId }) => {
    if (taskId == null || caseId == null) {
      return
    }
    // Case totals are only known once the DSL starts running the task's cases.
    reporter.onTaskQueued({ taskId, totalCases: data.total })
    reporter.onCaseStart({
      autoRetry: data.autoRetry,
      caseId,
      caseName: data.name,
      input: data.input,
      retryIndex: data.retryIndex,
      taskId,
    })
  })
  bus.on(caseOutput, ({ caseId, data, taskId }) => {
    if (taskId != null && caseId != null) {
      reporter.onCaseOutput({ caseId, content: data.content, stream: data.stream, taskId })
    }
  })
  bus.on(caseEnded, ({ caseId, data, taskId }) => {
    if (taskId == null || caseId == null) {
      return
    }
    reporter.onTaskQueued({ taskId, totalCases: data.total })
    reporter.onCaseEnd({
      caseId,
      errorMessage: data.errorMessage,
      output: data.output,
      state: data.state,
      taskId,
    })
  })
  bus.on(runEnded, ({ data }) => reporter.onRunEnd(data))
}

/**
 * Counts task results of the whole run from `task.ended` events, for `run.ended` totals.
 */
function subscribeTaskCounters(bus: RunEventBus): RunCliReporterCounters {
  const counters: RunCliReporterCounters = {
    failedTasks: 0,
    passedTasks: 0,
    skippedTasks: 0,
  }

  bus.on(taskEnded, ({ data }) => {
    if (data.state === 'passed') {
      counters.passedTasks += 1
      return
    }
    if (data.state === 'failed') {
      counters.failedTasks += 1
      return
    }
    counters.skippedTasks += 1
  })

  return counters
}
