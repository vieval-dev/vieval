import type { TaskRunStorage } from '../config'
import type { AggregatedRunResults, ScheduledTask, ScheduledTaskExecutor, TaskExecutionContext } from '../core/runner'
import type { RunEventBus } from '../core/runner/event-bus'
import type { Scheduler, SchedulerConcurrencyConfig } from '../core/scheduler/types'
import type { TelemetryRuntime } from '../core/telemetry'
import type { RunEventEmitter, RunEventEnvelope } from '../events'
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
import { basename, dirname, join, resolve } from 'node:path'

import c from 'tinyrainbow'

import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

import { collectEvalEntries, createFilesystemTaskCacheRuntime, createRunnerSchedule, createScheduler, createTaskExecutionContext, RunnerExecutionError, runScheduledTasks } from '../core/runner'
import { createProcessOutputInterceptor } from '../core/runner/case-output'
import { createRunEventBus } from '../core/runner/event-bus'
import { createNoopTelemetryRuntime, createOpenTelemetryRuntime } from '../core/telemetry'
import { caseEnded, caseEndedDataSchema, caseOutput, caseOutputDataSchema, caseStarted, caseStartedDataSchema, projectEnded, projectStarted, runEnded, runInterrupted, runStarted, taskEnded, taskEndedDataSchema, taskQueued, taskQueuedDataSchema, taskStarted } from '../events'
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
  /** Report directory of this project's run, or `null` with reports disabled. */
  reportDirectory?: null | string
  result: AggregatedRunResults | null
  /** Run id of this project's run; every project of an invocation runs as its own run. */
  runId?: string
  taskCount: number
}

/**
 * Final CLI output model.
 */
export interface CliRunOutput {
  attemptId?: string
  /** Comparison the invocation belongs to, when a comparison started it. */
  comparisonId?: string
  configFilePath: null | string
  experimentId?: string
  /**
   * Signal that interrupted the run. Results then cover only the work finished before the interrupt.
   */
  interruptSignal?: InterruptSignal
  /** Id shared by every project run of one `vieval run` invocation (and by every workspace of a comparison). */
  invocationId?: string
  /** One summary per project; each project ran as its own run (`runId`, `reportDirectory`). */
  projects: CliProjectSummary[]
  workspaceId?: string
}

/** Terminal reporter of `vieval run`, also used by a comparison to show all of its workspaces. */
export type CliRunReporter = Omit<CliReporter, 'onCaseStart' | 'onTaskQueued'> & {
  onCaseStart: (payload: SummaryReporterCaseStartPayload) => void
  onTaskQueued: (payload: SummaryReporterTaskQueuedPayload) => void
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
   * Restrict cases to names, or globs when a value contains `*`, within every selected task.
   *
   * @default []
   */
  case?: string[]
  /**
   * Most cases running at once in the whole run.
   *
   * Combined with the top-level `scheduler.concurrency.case` by taking the smaller value, so it never raises a configured
   * value.
   */
  caseConcurrency?: number
  /**
   * Comparison id stamped on every run, when a comparison started this invocation.
   */
  comparisonId?: string
  /**
   * Env values that win over the config's `env`, applied before the config's plugins run.
   *
   * A comparison passes its own env to each workspace this way.
   */
  envOverrides?: NodeJS.ProcessEnv
  /**
   * Experiment id attached to report artifacts.
   */
  experiment?: string
  /**
   * Invocation id shared by the runs; a comparison passes one id to all of its workspaces.
   *
   * @default a new id
   */
  invocationId?: string
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
   * Lets project, task, and case selectors match nothing here instead of failing.
   *
   * A comparison forwards its selectors to every workspace, and a selector only has to match in one of them.
   *
   * @default false
   */
  selectorsMayMatchNothing?: boolean
  /**
   * Cache shared by the workspaces of a comparison: every project reads and writes
   * `<root>/<scope>/<namespace>/...` instead of `<project root>/.vieval/cache/<workspace>/<project>/...`.
   */
  sharedCache?: { namespace: string, root: string, scope: string }
  /**
   * Restrict tasks to entry names or entry ids, or globs when a value contains `*`.
   *
   * @default []
   */
  task?: string[]
  /**
   * Most scheduled tasks running at once in the whole run.
   *
   * Combined with the top-level `scheduler.concurrency.task` by taking the smaller value.
   */
  taskConcurrency?: number
  /**
   * Workspace id attached to report artifacts and used as the report path segment.
   *
   * @default the name of the config file's directory (`default-workspace` without a config)
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

/** Identity shared by the project runs of one invocation. */
interface CliInvocationIdentity {
  attemptId: string
  comparisonId?: string
  experimentId: string
  invocationId: string
  workspaceId: string
}

interface CliRunIdentity extends CliInvocationIdentity {
  runId: string
}

type CliTaskExecutionContext = CliProjectExecutorContext

interface PreparedCliProjectExecution {
  /** Names of every entry before `--task` selected some, for the error that names what exists. */
  allEntryNames: string[]
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

/**
 * One project's run inside an invocation: the project is the unit that owns a run directory and an event log.
 */
interface ProjectRun {
  bus: RunEventBus
  counters: RunCliReporterCounters
  eventLog: ReportEventLog | undefined
  identity: CliRunIdentity
  name: string
  prepared: PreparedCliProjectResult
  reportDirectory: string | undefined
  storage: TaskRunStorage
  taskCount: number
  /** The artifacts directory is temporary (reports disabled) and removed when the invocation ends. */
  temporaryArtifactsRoot: boolean
}

interface RunCliReporterCounters {
  failedTasks: number
  passedTasks: number
  skippedTasks: number
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
export function createRunReporter(options: RunVievalCliReporterOptions | undefined): CliRunReporter {
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
 * Applies one run event envelope to the terminal reporter.
 *
 * Use when:
 * - an in-process run's bus delivers an event ({@link subscribeRunReporter})
 * - a comparison reads the events its workspace processes send, and shows all of them in one live window
 *
 * Expects:
 * - `scope.workspaceName` is set when events of several workspaces share one reporter; task keys then include the
 *   run id, so equal task ids of different workspaces stay apart
 *
 * Returns:
 * - nothing; events the reporter does not show, and envelopes whose data does not match their schema, are ignored
 */
export function forwardRunEventToReporter(envelope: RunEventEnvelope, reporter: CliRunReporter, scope: { workspaceName?: string } = {}): void {
  if (envelope.taskId == null) {
    return
  }
  const taskId = scope.workspaceName == null ? envelope.taskId : `${envelope.runId}/${envelope.taskId}`
  const caseId = envelope.caseId

  switch (envelope.event) {
    case caseOutput.id: {
      const data = v.safeParse(caseOutputDataSchema, envelope.data)
      if (data.success && caseId != null) {
        reporter.onCaseOutput({ caseId, content: data.output.content, stream: data.output.stream, taskId })
      }
      return
    }
    case caseStarted.id: {
      const data = v.safeParse(caseStartedDataSchema, envelope.data)
      if (!data.success || caseId == null) {
        return
      }
      // Tasks that do not declare their cases up front report the total with each case.
      reporter.onTaskQueued({ taskId, totalCases: data.output.total })
      reporter.onCaseStart({
        autoRetry: data.output.autoRetry,
        caseId,
        caseName: data.output.name,
        input: data.output.input,
        retryIndex: data.output.retryIndex,
        taskId,
      })
      return
    }
    case taskEnded.id: {
      const data = v.safeParse(taskEndedDataSchema, envelope.data)
      if (data.success) {
        reporter.onTaskEnd({ state: data.output.state, taskId })
      }
      return
    }
    case taskQueued.id: {
      const data = v.safeParse(taskQueuedDataSchema, envelope.data)
      if (data.success) {
        reporter.onTaskQueued({ displayName: data.output.displayName, projectName: envelope.projectId, taskId, totalCases: data.output.totalCases, workspaceName: scope.workspaceName })
      }
      return
    }
    case taskStarted.id:
      reporter.onTaskStart({ taskId })
      return
    case caseEnded.id: {
      const data = v.safeParse(caseEndedDataSchema, envelope.data)
      if (!data.success || caseId == null) {
        return
      }
      reporter.onTaskQueued({ taskId, totalCases: data.output.total })
      reporter.onCaseEnd({
        caseId,
        errorMessage: data.output.errorMessage,
        output: data.output.output,
        state: data.output.state,
        taskId,
      })
    }
  }
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
    envOverrides: options.envOverrides,
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
  const projectRuns: ProjectRun[] = []
  let stopListeningForInterrupt: (() => void) | undefined
  let interruptSignal: InterruptSignal | undefined
  const runReadyDisposers: RunReadyDisposer[] = []
  try {
    const selectedProjects = selectProjects(loadedConfig.projects, options.project ?? [], options.selectorsMayMatchNothing === true)
    const preparedProjects = await Promise.all(selectedProjects.map(async project => prepareProject(project, options.task ?? [])))
    if (options.selectorsMayMatchNothing !== true) {
      assertSelectorsMatch(preparedProjects, options.task ?? [], options.case ?? [])
    }
    const caseSelectors = options.case ?? []
    const selectsCase = caseSelectors.length === 0 ? undefined : (caseName: string) => caseSelectors.some(selector => matchesSelector(caseName, selector))
    const invocation = createInvocationIdentity(options, preparedProjects, loadedConfig.configFilePath)
    // The report directories are fixed before execution so events and artifacts reach disk while the runs are in progress.
    const reportRoot = options.report === false
      ? undefined
      : resolve(options.reportOut ?? join(loadedConfig.configFilePath == null ? (options.cwd ?? process.cwd()) : dirname(loadedConfig.configFilePath), '.vieval', 'reports'))
    // One run per project: its own bus, `events.jsonl`, and report directory, so the report layout keeps the
    // project level. Runs of one invocation share the invocation identity.
    for (const preparedProject of preparedProjects) {
      projectRuns.push(await createProjectRun(preparedProject, invocation, reportRoot))
    }
    const runReporter = createRunReporter(options.reporter)
    reporter = runReporter
    for (const run of projectRuns) {
      subscribeRunReporter(run.bus, runReporter)
    }
    if (options.onRunReady != null) {
      for (const run of projectRuns) {
        const dispose = await callRunReadyHook(options.onRunReady, {
          artifactsRoot: run.storage.artifactsRoot,
          bus: run.bus,
          configFilePath: loadedConfig.configFilePath,
          identity: run.identity,
          projectNames: [run.name],
          reportDirectory: run.reportDirectory ?? null,
          reportRoot: reportRoot ?? null,
        })
        if (dispose != null) {
          runReadyDisposers.push(dispose)
        }
      }
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
        for (const run of projectRuns) {
          void run.bus.emit(runInterrupted, { signal })
        }
        // Written through the intercepted stream, so it appears above the live window.
        process.stderr.write(`\n${signal} received: waiting for running cases to finish their cleanup. Press Ctrl+C again to exit immediately.\n`)
      },
    })

    output = await telemetry.withSpan('vieval.run', {
      'vieval.attempt.id': invocation.attemptId,
      'vieval.experiment.id': invocation.experimentId,
      'vieval.invocation.id': invocation.invocationId,
      'vieval.workspace.id': invocation.workspaceId,
    }, async () => {
      const runConcurrency = resolveRunConcurrency(loadedConfig.scheduler?.concurrency, options)
      const runScheduler = createScheduler({
        concurrency: runConcurrency,
        context: {
          experimentId: invocation.experimentId,
          workspaceId: invocation.workspaceId,
        },
        middleware: loadedConfig.scheduler?.middleware,
      })
      const totalTasks = projectRuns.reduce((sum, run) => sum + run.taskCount, 0)
      runReporter.onRunStart({ totalTasks })

      for (const run of projectRuns) {
        if (run.prepared.kind === 'prepared') {
          // Reporters must be subscribed before `task.queued`, so they see every module of their project.
          await subscribeVitestCompatReporters({
            bus: run.bus,
            projectName: run.name,
            references: run.prepared.prepared.project.reporters,
          })
        }
        await run.bus.emit(runStarted, { totalTasks: run.taskCount })
        if (run.prepared.kind === 'prepared') {
          for (const task of run.prepared.prepared.tasks) {
            await run.bus.scope({ projectId: run.name, taskId: task.id }).emit(taskQueued, {
              displayName: formatTaskDisplayName(task),
              totalCases: task.entry.task?.caseNames?.filter(name => selectsCase?.(name) ?? true).length,
            })
          }
        }
      }

      const projectSummaries = await Promise.all(projectRuns.map(async (run) => {
        const summary = await executeProjectRun(run, {
          interruptSignal: interruption.signal,
          runConcurrency,
          runScheduler,
          selectsCase,
          sharedCache: options.sharedCache,
          telemetry,
        })
        // A project's report is complete as soon as the project settles; it does not wait for the others.
        await run.bus.emit(runEnded, {
          failedTasks: run.counters.failedTasks,
          passedTasks: run.counters.passedTasks,
          skippedTasks: run.counters.skippedTasks + (run.prepared.kind === 'summary' ? run.taskCount : 0),
          totalTasks: run.taskCount,
        })
        const projectSummary: CliProjectSummary = { ...summary, reportDirectory: run.reportDirectory ?? null, runId: run.identity.runId }
        if (run.reportDirectory != null) {
          // Summary files are derived from the log, so every buffered event must be on disk first.
          await run.eventLog?.close()
          await writeRunReportArtifacts({
            attemptId: invocation.attemptId,
            configFilePath: loadedConfig.configFilePath,
            experimentId: invocation.experimentId,
            invocationId: invocation.invocationId,
            ...(invocation.comparisonId == null ? {} : { comparisonId: invocation.comparisonId }),
            ...(interruptSignal == null ? {} : { interruptSignal }),
            projects: [projectSummary],
            workspaceId: invocation.workspaceId,
          }, run.identity, run.reportDirectory)
        }
        return projectSummary
      }))

      runReporter.onRunEnd({
        failedTasks: sumCounters(projectRuns, 'failedTasks'),
        passedTasks: sumCounters(projectRuns, 'passedTasks'),
        skippedTasks: sumCounters(projectRuns, 'skippedTasks') + projectRuns.filter(run => run.prepared.kind === 'summary').reduce((sum, run) => sum + run.taskCount, 0),
        totalTasks,
      })

      return {
        attemptId: invocation.attemptId,
        ...(invocation.comparisonId == null ? {} : { comparisonId: invocation.comparisonId }),
        configFilePath: loadedConfig.configFilePath,
        experimentId: invocation.experimentId,
        invocationId: invocation.invocationId,
        projects: projectSummaries,
        ...(interruptSignal == null ? {} : { interruptSignal }),
        workspaceId: invocation.workspaceId,
      }
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
    for (const run of projectRuns) {
      // Flush the log of a failed run as well, so it keeps every event recorded before the failure.
      try {
        await run.eventLog?.close()
      }
      catch (error) {
        if (runError == null) {
          runEndError ??= error
        }
      }
    }
    for (const dispose of runReadyDisposers) {
      try {
        await dispose()
      }
      catch (error) {
        process.stderr.write(`[vieval] onRunReady cleanup failed: ${errorMessageFrom(error) ?? 'unknown error'}\n`)
      }
    }
    for (const run of projectRuns) {
      if (run.temporaryArtifactsRoot) {
        await rm(run.storage.artifactsRoot, { force: true, recursive: true })
      }
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
 * Checks `--task` and `--case` against what the selected projects contain, before anything runs, so a typo fails
 * fast instead of running nothing. Cases can only be checked when every task lists its case names.
 */
function assertSelectorsMatch(preparedProjects: readonly PreparedCliProjectResult[], taskSelectors: readonly string[], caseSelectors: readonly string[]): void {
  const tasks = preparedProjects.flatMap(project => project.kind === 'prepared' ? project.prepared.tasks : [])
  const unknownTasks = taskSelectors.filter(selector => !tasks.some(task => selectsTask(task, [selector])))
  if (unknownTasks.length > 0) {
    const entries = [...new Set(preparedProjects.flatMap(project => project.kind === 'prepared' ? project.prepared.allEntryNames : []))]
    throw new Error(`No task matches ${unknownTasks.map(selector => `"${selector}"`).join(', ')}. Tasks: ${entries.join(', ') || '(none)'}.`)
  }

  if (caseSelectors.length === 0 || tasks.some(task => task.entry.task?.caseNames == null)) {
    return
  }
  const caseNames = new Set(tasks.flatMap(task => task.entry.task?.caseNames ?? []))
  const unknownCases = caseSelectors.filter(selector => ![...caseNames].some(name => matchesSelector(name, selector)))
  if (unknownCases.length > 0) {
    const examples = [...caseNames].slice(0, 10).join(', ')
    throw new Error(`No case matches ${unknownCases.map(selector => `"${selector}"`).join(', ')}. Cases include: ${examples || '(none)'}.`)
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
      selectsCase: cliContext.selectsCase,
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
  selectsCase: ((caseName: string) => boolean) | undefined,
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
    ...(selectsCase == null ? {} : { selectsCase }),
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

function createInvocationIdentity(
  options: RunVievalCliOptions,
  preparedProjects: readonly PreparedCliProjectResult[],
  configFilePath: null | string,
): CliInvocationIdentity {
  // A workspace is named after the directory of its config, the same id a comparison gives it by default, so its
  // reports land in one place whether it runs alone or inside a comparison.
  const workspaceId = sanitizeIdentitySegment(options.workspace ?? (configFilePath == null ? 'default-workspace' : basename(dirname(configFilePath))))
  const experimentId = resolveExperimentId(options, preparedProjects)
  const attemptId = sanitizeIdentitySegment(options.attempt ?? `attempt-${new Date().toISOString().replace(/[:.]/g, '-')}`)

  return {
    attemptId,
    ...(options.comparisonId == null ? {} : { comparisonId: options.comparisonId }),
    experimentId,
    invocationId: options.invocationId ?? `invocation-${Date.now()}-${randomUUID().slice(0, 8)}`,
    workspaceId,
  }
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

async function createProjectRun(
  prepared: PreparedCliProjectResult,
  invocation: CliInvocationIdentity,
  reportRoot: string | undefined,
): Promise<ProjectRun> {
  const name = prepared.kind === 'prepared' ? prepared.prepared.name : prepared.summary.name
  const identity: CliRunIdentity = { ...invocation, runId: `run-${Date.now()}-${randomUUID().slice(0, 8)}` }
  const bus = createRunEventBus(identity)
  const reportDirectory = reportRoot == null ? undefined : resolveRunReportDirectory(reportRoot, identity, name)
  const eventLog = reportDirectory == null ? undefined : createReportEventLog(join(reportDirectory, 'events.jsonl'))
  if (eventLog != null) {
    bus.onAny(envelope => eventLog.append(envelope))
  }
  // With reports disabled, artifacts still need a directory for the run; it is removed when the invocation ends.
  const artifactsRoot = reportDirectory == null
    ? await mkdtemp(join(tmpdir(), 'vieval-artifacts-'))
    : join(reportDirectory, 'artifacts')

  return {
    bus,
    counters: subscribeTaskCounters(bus),
    eventLog,
    identity,
    name,
    prepared,
    reportDirectory,
    storage: { artifactsRoot, attemptId: identity.attemptId, runId: identity.runId },
    taskCount: prepared.kind === 'prepared' ? prepared.prepared.tasks.length : prepared.summary.taskCount,
    temporaryArtifactsRoot: reportDirectory == null,
  }
}

async function executePreparedProject(
  prepared: PreparedCliProjectExecution,
  scheduler: Scheduler,
  identity: CliRunIdentity,
  cache: { projectName: string, rootDirectory: string, workspaceId: string },
  telemetry: TelemetryRuntime,
  bus: RunEventBus,
  runStorage: TaskRunStorage,
  signal: AbortSignal,
  selectsCase: ((caseName: string) => boolean) | undefined,
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
          cache.rootDirectory,
          cache.projectName,
          cache.workspaceId,
          telemetry,
          projectEvents.scope({ taskId: task.id }),
          runStorage,
          signal,
          scheduler,
          selectsCase,
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

async function executeProjectRun(
  run: ProjectRun,
  options: {
    interruptSignal: AbortSignal
    runConcurrency: SchedulerConcurrencyConfig
    runScheduler: Scheduler
    selectsCase: ((caseName: string) => boolean) | undefined
    sharedCache: RunVievalCliOptions['sharedCache']
    telemetry: TelemetryRuntime
  },
): Promise<CliProjectSummary> {
  if (run.prepared.kind === 'summary') {
    return run.prepared.summary
  }

  const prepared = run.prepared.prepared
  return await options.telemetry.withSpan('vieval.project', {
    'vieval.project.name': prepared.name,
    'vieval.run.id': run.identity.runId,
  }, async () => await options.runScheduler.run({
    projectName: prepared.name,
    scope: 'project',
  }, async () => executePreparedProject(
    prepared,
    options.runScheduler.child({
      concurrency: resolveProjectConcurrency(prepared.project, options.runConcurrency),
      context: { projectName: prepared.name },
      middleware: prepared.project.scheduler?.middleware,
    }),
    run.identity,
    // A comparison shares one cache across its workspaces; otherwise each project caches under its own root.
    options.sharedCache == null
      ? { projectName: prepared.name, rootDirectory: resolve(prepared.project.root, '.vieval', 'cache'), workspaceId: run.identity.workspaceId }
      : { projectName: options.sharedCache.namespace, rootDirectory: options.sharedCache.root, workspaceId: options.sharedCache.scope },
    options.telemetry,
    run.bus,
    run.storage,
    options.interruptSignal,
    options.selectsCase,
  )))
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
 * Whether a selector given on the command line matches a value: exactly, or as a glob when it contains `*`
 * (`*` matches any run of characters, including `/`).
 *
 * Before:
 * - `matchesSelector('formula-speech-raw', 'formula-speech-*')`
 * - `matchesSelector('tasks/read-aloud#zh', 'zh')`
 *
 * After:
 * - `true`
 * - `false` (callers match a task's name and its id separately)
 */
function matchesSelector(value: string, selector: string): boolean {
  if (!selector.includes('*')) {
    return value === selector
  }

  const pattern = selector.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${pattern}$`).test(value)
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

async function prepareProject(project: NormalizedCliProjectConfig, taskSelectors: readonly string[]): Promise<PreparedCliProjectResult> {
  const startedAt = Date.now()

  try {
    const runtimeContext = { projectRootDirectory: project.root }
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
    }).filter(task => selectsTask(task, taskSelectors))

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
        allEntryNames: entries.map(entry => entry.name),
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
  const caseConcurrency = smallestDeclared(config?.case, options.caseConcurrency)
  const taskConcurrency = smallestDeclared(config?.task, options.taskConcurrency)
  // Same rule as the task default in `resolveProjectConcurrency`: without any pool, projects run one after another;
  // a run-wide task or case pool already bounds the real work, and a one-project default would leave its slots
  // idle while the last slow case of a project runs.
  const projectDefault = taskConcurrency == null && caseConcurrency == null ? 1 : undefined

  return {
    case: caseConcurrency,
    project: smallestDeclared(config?.project, options.projectConcurrency) ?? projectDefault,
    task: taskConcurrency,
  }
}

function sanitizeIdentitySegment(value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) {
    return 'default'
  }

  return normalized.replace(/[^\w.-]+/g, '-')
}

/**
 * Selects the projects named by `--project`; an unknown name is an error instead of a run with nothing in it.
 */
function selectProjects(projects: readonly NormalizedCliProjectConfig[], names: readonly string[], mayMatchNothing: boolean): NormalizedCliProjectConfig[] {
  if (names.length === 0) {
    return [...projects]
  }

  const unknown = names.filter(name => !projects.some(project => matchesSelector(project.name, name)))
  if (unknown.length > 0 && !mayMatchNothing) {
    throw new Error(`No project matches ${unknown.map(name => `"${name}"`).join(', ')}. Projects: ${projects.map(project => project.name).join(', ') || '(none)'}.`)
  }

  return projects.filter(project => names.some(name => matchesSelector(project.name, name)))
}

/** A task is selected by its entry name (the `describeTask` name) or its entry id (file path plus `#name`). */
function selectsTask(task: ScheduledTask, selectors: readonly string[]): boolean {
  return selectors.length === 0 || selectors.some(selector => matchesSelector(task.entry.name, selector) || matchesSelector(task.entry.id, selector))
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
 * Forwards the events of one in-process run to the terminal reporter.
 *
 * Use when:
 * - the live window and case output blocks should follow the run's lifecycle
 *
 * Expects:
 * - it is called before `run.started` is emitted
 */
function subscribeRunReporter(bus: RunEventBus, reporter: CliRunReporter): void {
  bus.onAny(envelope => forwardRunEventToReporter(envelope, reporter))
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

function sumCounters(runs: readonly ProjectRun[], key: keyof RunCliReporterCounters): number {
  return runs.reduce((sum, run) => sum + run.counters[key], 0)
}
