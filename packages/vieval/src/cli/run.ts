import type { TaskRunStorage } from '../config'
import type { AggregatedRunResults, ScheduledTask, ScheduledTaskExecutor, TaskExecutionContext } from '../core/runner'
import type { RunEventBus } from '../core/runner/event-bus'
import type { Scheduler, SchedulerConcurrencyConfig } from '../core/scheduler/types'
import type { TelemetryRuntime } from '../core/telemetry'
import type { RunEventEmitter } from '../events'
import type { CliProjectConcurrencyConfig, CliProjectExecutorContext, LoadVievalCliConfigOptions, NormalizedCliProjectConfig } from './config'
import type { InterruptSignal } from './interrupt'
import type { ReportEventLog } from './report-log'
import type { CliReporter, SummaryReporter, SummaryReporterCaseStartPayload, SummaryReporterTaskQueuedPayload } from './reporters'
import type { WindowRendererTimer } from './reporters/renderers/windowed-renderer'
import type { RunReadyContext, RunReadyDisposer, RunReadyHook } from './viewer-host'

import process from 'node:process'

import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import c from 'tinyrainbow'

import { errorMessageFrom } from '@moeru/std'

import { collectEvalEntries, createFilesystemTaskCacheRuntime, createRunnerRuntimeContext, createRunnerSchedule, createScheduler, createTaskExecutionContext, RunnerExecutionError, runScheduledTasks } from '../core/runner'
import { createProcessOutputInterceptor } from '../core/runner/case-output'
import { createRunEventBus } from '../core/runner/event-bus'
import { createNoopTelemetryRuntime, createOpenTelemetryRuntime } from '../core/telemetry'
import { caseEnded, caseOutput, caseStarted, projectEnded, projectStarted, runEnded, runInterrupted, runStarted, taskEnded, taskQueued, taskStarted } from '../events'
import { loadVievalCliConfig } from './config'
import { discoverEvalFiles } from './discovery'
import { exitCodeFromSignal, listenForInterrupt } from './interrupt'
import { loadEvalModulesWithVitestRuntime } from './module-runtime'
import { resolveRunReportDirectory, writeRunReportArtifacts } from './report-artifacts'
import { createReportEventLog } from './report-log'
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
  /**
   * Signal that interrupted the run. Results then cover only the work finished before the interrupt.
   */
  interruptSignal?: InterruptSignal
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
   * Cache project identifier override used to share benchmark cache across multiple method runs.
   */
  cacheProjectName?: string
  /**
   * Most cases running at once in the whole run.
   *
   * Combined with the top-level `scheduler.concurrency.case` by taking the smaller value, so it never raises a configured
   * value.
   */
  caseConcurrency?: number
  /**
   * Experiment id attached to report artifacts.
   */
  experiment?: string
  /**
   * Attaches an external host (for example the web viewer) to the run's event bus.
   *
   * Called once, after the terminal reporter subscribed and before `run.started`, so the host sees every
   * event from `seq` 1. Not called when the run fails before it starts (for example on a config error).
   */
  onRunReady?: RunReadyHook
  /**
   * Restrict run to project names.
   *
   * @default []
   */
  project?: string[]
  /**
   * Most projects running at once.
   *
   * Combined with the top-level `scheduler.concurrency.project` by taking the smaller value.
   */
  projectConcurrency?: number
  /**
   * Writes report artifacts (live `events.jsonl`, summaries, and case artifacts).
   *
   * When `false`, nothing is written and case artifacts go to a temporary directory removed at run end.
   *
   * @default true
   */
  report?: boolean
  /**
   * Optional reporter overrides used by CLI integration tests or custom hosts.
   */
  reporter?: RunVievalCliReporterOptions
  /**
   * Report output root directory.
   *
   * @default `.vieval/reports` next to the config file, or under `cwd` without a config file
   */
  reportOut?: string
  /**
   * Most scheduled tasks running at once in the whole run.
   *
   * Combined with the top-level `scheduler.concurrency.task` by taking the smaller value.
   */
  taskConcurrency?: number
  /**
   * Workspace id attached to report artifacts.
   */
  workspace?: string
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
  if (output.interruptSignal != null) {
    lines.push(` ${colors.yellow('Interrupted')}  by ${output.interruptSignal}; results cover only the work finished before the interrupt`)
  }

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
 *     -> subscribers: {@link subscribeRunReporter}, {@link createReportEventLog} (live `events.jsonl`), {@link subscribeVitestCompatReporters}
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
  let eventLog: ReportEventLog | undefined
  let temporaryArtifactsRoot: string | undefined
  let stopListeningForInterrupt: (() => void) | undefined
  let interruptSignal: InterruptSignal | undefined
  let disposeRunReadyHook: RunReadyDisposer | undefined
  try {
    const selectedProjects = filterProjectsByName(loadedConfig.projects, options.project ?? [])
    const preparedProjects = await Promise.all(selectedProjects.map(async project => prepareProject(project)))
    const identity = createRunIdentity(options, preparedProjects)
    const bus = createRunEventBus(identity)
    // The report directory is fixed before execution so events and artifacts reach disk while the run is in progress.
    const reportRoot = options.report === false
      ? undefined
      : resolve(options.reportOut ?? join(loadedConfig.configFilePath == null ? (options.cwd ?? process.cwd()) : dirname(loadedConfig.configFilePath), '.vieval', 'reports'))
    const reportDirectory = reportRoot == null
      ? undefined
      : resolveRunReportDirectory(
          reportRoot,
          identity,
          selectedProjects.map(project => project.name),
        )
    if (reportDirectory != null) {
      const log = createReportEventLog(join(reportDirectory, 'events.jsonl'))
      eventLog = log
      bus.onAny(envelope => log.append(envelope))
    }
    // With reports disabled, artifacts still need a directory for the run; it is removed when the run ends.
    const artifactsRoot = reportDirectory == null
      ? await mkdtemp(join(tmpdir(), 'vieval-artifacts-'))
      : join(reportDirectory, 'artifacts')
    temporaryArtifactsRoot = reportDirectory == null ? artifactsRoot : undefined
    const runStorage: TaskRunStorage = {
      artifactsRoot,
      attemptId: identity.attemptId,
      runId: identity.runId,
    }
    const runReporter = createRunReporter(options.reporter)
    reporter = runReporter
    subscribeRunReporter(bus, runReporter)
    const reporterCounters = subscribeTaskCounters(bus)
    if (options.onRunReady != null) {
      disposeRunReadyHook = await callRunReadyHook(options.onRunReady, {
        artifactsRoot,
        bus,
        configFilePath: loadedConfig.configFilePath,
        identity,
        projectNames: selectedProjects.map(project => project.name),
        reportDirectory: reportDirectory ?? null,
        reportRoot: reportRoot ?? null,
      })
    }
    // First interrupt: stop starting work and abort running cases, so their cleanup runs before the run ends.
    // Second interrupt: give up waiting.
    const interruption = new AbortController()
    stopListeningForInterrupt = listenForInterrupt({
      onForceExit(signal) {
        reporter?.dispose()
        process.exit(exitCodeFromSignal(signal))
      },
      onInterrupt(signal) {
        interruptSignal = signal
        interruption.abort(new Error(`Run interrupted by ${signal}.`))
        void bus.emit(runInterrupted, { signal })
        // Written through the intercepted stream, so it appears above the live window.
        process.stderr.write(`\n${signal} received: waiting for running cases to finish their cleanup. Press Ctrl+C again to exit immediately.\n`)
      },
    })

    output = await telemetry.withSpan('vieval.run', {
      'vieval.attempt.id': identity.attemptId,
      'vieval.experiment.id': identity.experimentId,
      'vieval.run.id': identity.runId,
      'vieval.workspace.id': identity.workspaceId,
    }, async () => {
      const runConcurrency = resolveRunConcurrency(loadedConfig.scheduler?.concurrency, options)
      const runScheduler = createScheduler({
        concurrency: runConcurrency,
        context: {
          experimentId: identity.experimentId,
          workspaceId: identity.workspaceId,
        },
        middleware: loadedConfig.scheduler?.middleware,
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
          }, async () => await runScheduler.run({
            projectName: preparedProject.prepared.name,
            scope: 'project',
          }, async () => executePreparedProject(
            preparedProject.prepared,
            runScheduler.child({
              concurrency: resolveProjectConcurrency(preparedProject.prepared.project, runConcurrency),
              context: { projectName: preparedProject.prepared.name },
              middleware: preparedProject.prepared.project.scheduler?.middleware,
            }),
            identity,
            options.cacheProjectName,
            telemetry,
            bus,
            runStorage,
            interruption.signal,
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
        ...(interruptSignal == null ? {} : { interruptSignal }),
        reportDirectory: null,
        runId: identity.runId,
        workspaceId: identity.workspaceId,
      }

      if (reportDirectory != null) {
        // Summary files are derived from the log, so every buffered event must be on disk first.
        await eventLog?.close()
        output.reportDirectory = await writeRunReportArtifacts(output, identity, reportDirectory)
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
    stopListeningForInterrupt?.()
    reporter?.dispose()
    // Flush the log of a failed run as well, so it keeps every event recorded before the failure.
    try {
      await eventLog?.close()
    }
    catch (error) {
      if (runError == null) {
        runEndError ??= error
      }
    }
    if (disposeRunReadyHook != null) {
      try {
        await disposeRunReadyHook()
      }
      catch (error) {
        process.stderr.write(`[vieval] onRunReady cleanup failed: ${errorMessageFrom(error) ?? 'unknown error'}\n`)
      }
    }
    if (temporaryArtifactsRoot != null) {
      await rm(temporaryArtifactsRoot, { force: true, recursive: true })
    }
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

/**
 * Calls the `onRunReady` hook; a failing host is reported and never fails the run.
 */
async function callRunReadyHook(hook: RunReadyHook, context: RunReadyContext): Promise<RunReadyDisposer | undefined> {
  try {
    return await hook(context) ?? undefined
  }
  catch (error) {
    process.stderr.write(`[vieval] onRunReady hook failed: ${errorMessageFrom(error) ?? 'unknown error'}\n`)
    return undefined
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
      runStorage: cliContext.runStorage,
      scheduler: cliContext.scheduler,
      signal: cliContext.signal,
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
  runStorage: TaskRunStorage,
  signal: AbortSignal,
  scheduler: Scheduler,
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
    runStorage,
    scheduler,
    signal,
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

async function executePreparedProject(
  prepared: PreparedCliProjectExecution,
  scheduler: Scheduler,
  identity: CliRunIdentity,
  cacheProjectName: string | undefined,
  telemetry: TelemetryRuntime,
  bus: RunEventBus,
  runStorage: TaskRunStorage,
  signal: AbortSignal,
): Promise<CliProjectSummary> {
  const settledTaskIds = new Set<string>()
  const projectEvents = bus.scope({ projectId: prepared.name })
  const caseSummary = subscribeProjectCaseSummary(bus, prepared.name)
  const rawTaskExecutor = prepared.project.executor ?? createAutoTaskExecutor()
  const taskExecutor: ScheduledTaskExecutor = async (task, context) => {
    const result = await telemetry.withSpan('vieval.task', {
      'vieval.project.name': prepared.name,
      'vieval.run.id': identity.runId,
      'vieval.task.entry.id': task.entry.id,
      'vieval.task.id': task.id,
      'vieval.task.name': task.entry.name,
    }, async () => await rawTaskExecutor(task, context))

    return {
      ...result,
      matrix: cloneScheduledTaskMatrix(task),
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
          runStorage,
          signal,
          scheduler,
        )
      },
      onTaskEnd(task, state): void {
        settledTaskIds.add(task.id)
        void projectEvents.scope({ taskId: task.id }).emit(taskEnded, { state })
      },
      onTaskStart(task): void {
        void projectEvents.scope({ taskId: task.id }).emit(taskStarted, {})
      },
      scheduler,
      signal,
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

/**
 * Resolves the pools of one project from its config.
 *
 * Before:
 * - project `{ case: 2 }`, run-wide `{}`
 * - project `{ case: 2 }`, run-wide `{ task: 4 }`
 * - project `{}`, run-wide `{ case: 7 }`
 *
 * After:
 * - `{ case: 2, task: 1 }`
 * - `{ case: 2, task: undefined }`
 * - `{ case: undefined, task: undefined }`
 */
function resolveProjectConcurrency(
  project: NormalizedCliProjectConfig,
  runConcurrency: SchedulerConcurrencyConfig,
): CliProjectConcurrencyConfig {
  // Without any declaration, tasks of one project run one after another. A run-wide task pool takes over that job,
  // and so does a run-wide case pool: it already bounds the real work, and a one-task default would only make
  // every task wait for the slowest case of the task before it.
  const hasRunWidePool = runConcurrency.task != null || runConcurrency.case != null

  return {
    case: project.scheduler?.concurrency?.case,
    task: project.scheduler?.concurrency?.task ?? (hasRunWidePool ? undefined : 1),
  }
}

function resolveRunConcurrency(
  config: SchedulerConcurrencyConfig | undefined,
  options: RunVievalCliOptions,
): SchedulerConcurrencyConfig {
  return {
    case: smallestDeclared(config?.case, options.caseConcurrency),
    project: smallestDeclared(config?.project, options.projectConcurrency) ?? 1,
    task: smallestDeclared(config?.task, options.taskConcurrency),
  }
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

function smallestDeclared(configured: number | undefined, cli: number | undefined): number | undefined {
  if (configured == null || cli == null) {
    return configured ?? cli
  }

  return Math.min(configured, cli)
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
