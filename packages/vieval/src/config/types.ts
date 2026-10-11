import type { RunScore } from '../core/runner'
import type { ScheduledTask } from '../core/runner/schedule'
import type { TaskExecutionContext } from '../core/runner/task-context'
import type { TelemetryRuntime } from '../core/telemetry'
import type { RunEventEmitter } from '../events'

/**
 * Value that can be returned directly or through a promise.
 *
 * @param T - Resolved value type.
 */
export type Awaitable<T> = Promise<T> | T

/**
 * OpenTelemetry reporting configuration managed by user config setup.
 */
export interface CliOpenTelemetryReportingConfig {
  /**
   * Enables Vieval active span wrapping through `@opentelemetry/api`.
   *
   * @default false
   */
  enabled?: boolean
  /**
   * Called after all telemetry events and local report artifacts have been emitted.
   */
  onRunEnd?: () => Awaitable<void>
}

/**
 * Reporting configuration for local artifacts and optional OpenTelemetry integration.
 */
export interface CliReportingConfig {
  /**
   * Optional OpenTelemetry API integration.
   */
  openTelemetry?: CliOpenTelemetryReportingConfig
}

/**
 * Represents a normalized evaluation entry collected by the runner.
 */
export type CollectedEvalEntry<TDefinition extends EvalDefinition = EvalDefinition> = TDefinition & {
  directory: string
  filePath: string
  id: string
}

/**
 * Declares the metadata required for a single vieval evaluation module.
 */
export interface EvalDefinition {
  description: string
  /**
   * Optional matrix layering for this eval definition.
   *
   * Use when:
   * - one eval file needs control-group variants that differ from project defaults
   *
   * @example
   * ```ts
   * matrix: {
   *   runMatrix: {
   *     extend: {
   *       promptStyle: ['concise'],
   *     },
   *     override: {
   *       scenario: ['eval-scenario'],
   *     },
   *   },
   *   evalMatrix: {
   *     override: {
   *       rubric: ['strict'],
   *     },
   *   },
   * }
   * ```
   *
   * Context impact:
   *
   * ```txt
   * project.runMatrix + eval.matrix.runMatrix + task.matrix.runMatrix
   *   => context.task.matrix.run
   *
   * project.evalMatrix + eval.matrix.evalMatrix + task.matrix.evalMatrix
   *   => context.task.matrix.eval
   * ```
   */
  matrix?: ScopedMatrices
  name: string
  /**
   * Optional task implementation executed by runner.
   */
  task?: TaskDefinition
}

/**
 * Describes the shape of an imported vieval evaluation module.
 */
export interface EvalModule<TDefinition extends EvalDefinition = EvalDefinition> {
  default: TDefinition
}

/**
 * Maps module URLs to their loaded vieval evaluation modules.
 */
export type EvalModuleMap = Record<string, EvalModule>

/**
 * Canonical axis value list for one matrix definition.
 *
 * Use when:
 * - describing the values that one axis can expand into
 *
 * Expects:
 * - values are ordered and deterministic
 *
 * Returns:
 * - one axis value list
 */
export type MatrixAxisValues = readonly MatrixValue[]

/**
 * Canonical layered matrix definition.
 *
 * Use when:
 * - a config layer extends, overrides, or disables matrix axes
 *
 * Expects:
 * - `extend` adds or inherits axes
 * - `override` replaces axis values at the current layer
 * - `disable` removes axes from the active layer
 *
 * Returns:
 * - one structured layer object
 */
export type MatrixDefinition = Record<string, MatrixAxisValues>

/**
 * Canonical matrix layer payload.
 *
 * Use when:
 * - a project, eval, or task needs scoped matrix layering
 *
 * Expects:
 * - absent sections are treated as empty
 *
 * Resolution order:
 *
 * ```txt
 * current-layer:
 *   disable -> extend -> override
 * ```
 *
 * Returns:
 * - a layer object with optional extend, override, and disable sections
 *
 * @example
 * ```ts
 * const layer: MatrixLayer = {
 *   disable: ['temperatureProfile'],
 *   extend: {
 *     scenario: ['baseline', 'stress'],
 *   },
 *   override: {
 *     model: ['gpt-4.1-mini'],
 *   },
 * }
 * ```
 */
export interface MatrixLayer {
  /**
   * Matrix axes disabled at this layer.
   *
   * @example
   * ```ts
   * disable: ['temperatureProfile']
   * ```
   */
  disable?: readonly string[]
  /**
   * Matrix axes inherited or appended at this layer.
   *
   * @example
   * ```ts
   * extend: {
   *   promptLanguage: ['en', 'zh'],
   *   scenario: ['baseline'],
   * }
   * ```
   */
  extend?: MatrixDefinition
  /**
   * Matrix axes replaced at this layer.
   *
   * @example
   * ```ts
   * override: {
   *   rubric: ['strict'],
   * }
   * ```
   */
  override?: MatrixDefinition
}

/**
 * Primitive value allowed in one matrix cell.
 *
 * Use when:
 * - defining axis values for canonical layered matrix config
 * - preserving JSON-safe primitive values through config normalization
 *
 * Expects:
 * - values remain serializable and comparable with stringified task ids
 *
 * Returns:
 * - one JSON-friendly primitive matrix value
 */
export type MatrixPrimitive = boolean | number | string

/**
 * Canonical row payload for one matrix combination.
 *
 * Use when:
 * - storing the selected values for a resolved matrix row
 * - passing task-level matrix context between layers
 *
 * Expects:
 * - keys are axis names and values are resolved axis selections
 *
 * Returns:
 * - one resolved row object
 */
export type MatrixRow = Record<string, MatrixValue>

/**
 * Canonical matrix value type.
 *
 * Use when:
 * - declaring matrix axis values at the config boundary
 *
 * Expects:
 * - values are normalized from config input without extra wrapping
 *
 * Returns:
 * - a primitive cell value suitable for matrix expansion
 */
export type MatrixValue = MatrixPrimitive

/**
 * Canonical run/eval matrix grouping.
 *
 * Use when:
 * - a task or eval definition needs separate run and eval matrix scopes
 *
 * Expects:
 * - each scope is optional and independently normalized
 *
 * Orchestration model:
 *
 * ```txt
 * run scope:
 *   project.runMatrix -> eval.matrix.runMatrix -> task.matrix.runMatrix
 *
 * eval scope:
 *   project.evalMatrix -> eval.matrix.evalMatrix -> task.matrix.evalMatrix
 *
 * expanded tasks:
 *   run rows x eval rows
 * ```
 *
 * Returns:
 * - a grouped matrix object with optional run and eval layers
 *
 * @example
 * ```ts
 * const scoped: ScopedMatrices = {
 *   runMatrix: {
 *     extend: {
 *       model: ['gpt-4.1-mini', 'gpt-4.1'],
 *       scenario: ['baseline', 'stress'],
 *     },
 *   },
 *   evalMatrix: {
 *     extend: {
 *       rubric: ['strict', 'lenient'],
 *       rubricModel: ['judge-mini', 'judge-large'],
 *     },
 *   },
 * }
 * ```
 */
export interface ScopedMatrices {
  /**
   * Eval-time matrix scope.
   *
   * @example
   * ```ts
   * evalMatrix: {
   *   override: {
   *     rubric: ['strict'],
   *   },
   * }
   * ```
   */
  evalMatrix?: MatrixLayer
  /**
   * Runtime matrix scope.
   *
   * @example
   * ```ts
   * runMatrix: {
   *   extend: {
   *     promptLanguage: ['en', 'zh'],
   *   },
   * }
   * ```
   */
  runMatrix?: MatrixLayer
}

/**
 * Delay policy for retries within one task case attempt.
 *
 * @param retryIndex Retry number where `1` is the first retry after the initial failure.
 */
export type TaskAutoRetryDelay = ((retryIndex: number) => number) | number

/**
 * Allowed terminal outcomes for one task case.
 *
 * Use when:
 * - emitting case lifecycle events from the task DSL
 *
 * Expects:
 * - consumers treat the value as the final state for the case
 */
export type TaskCaseState = 'failed' | 'passed' | 'timeout'

/**
 * Task-local concurrency metadata.
 *
 * Use when:
 * - task declarations need to preserve attempt and case caps for later runtime coordination
 * - DSL execution needs to resolve the default task-level case concurrency for registered cases
 *
 * Expects:
 * - each provided value to be a positive integer chosen by the caller
 *
 * Returns:
 * - one partial task-local concurrency descriptor
 */
export interface TaskConcurrencyConfig {
  /**
   * Attempt-level concurrency cap for this task.
   */
  attempt?: number
  /**
   * Case-level concurrency cap for this task.
   */
  case?: number
}

/**
 * Eval task definition used by `defineTask`.
 */
export interface TaskDefinition {
  /**
   * Optional task-local concurrency metadata.
   *
   * Use when:
   * - task declarations need to preserve task-scoped attempt/case caps for later scheduler wiring
   * - higher-level orchestration wants to inspect task-local concurrency without executing the task
   *
   * Expects:
   * - each provided value to be a positive integer chosen by the caller
   *
   * Returns:
   * - one partial task-local concurrency descriptor
   */
  concurrency?: TaskConcurrencyConfig
  /**
   * Optional task-local execution policy.
   */
  executionPolicy?: TaskExecutionPolicy
  /**
   * Stable task id for diagnostics.
   */
  id: string
  /**
   * Optional matrix layering for this task definition.
   *
   * Use when:
   * - task-local experiments should refine project/eval defaults
   *
   * @example
   * ```ts
   * matrix: {
   *   runMatrix: {
   *     override: {
   *       model: ['gpt-4.1-mini'],
   *     },
   *   },
   *   evalMatrix: {
   *     extend: {
   *       evaluator: ['default-judge'],
   *     },
   *   },
   * }
   * ```
   */
  matrix?: ScopedMatrices
  /**
   * Executes one scheduled eval task.
   */
  run: (context: TaskRunContext) => Promise<TaskRunOutput> | TaskRunOutput
}

/**
 * Execution policy applied to task and case callbacks.
 *
 * Use when:
 * - one task or case should time out after a bounded duration
 * - failures should retry within the current attempt or trigger a later full task attempt
 *
 * Expects:
 * - `timeout` to be a positive integer when provided
 * - `autoRetry` and `autoAttempt` to be non-negative integers when provided
 *
 * Returns:
 * - one partial execution policy descriptor
 */
export interface TaskExecutionPolicy {
  /**
   * Additional full task attempts allowed after the current attempt settles.
   *
   * @default 0
   */
  autoAttempt?: number
  /**
   * Additional retries allowed within the current attempt.
   *
   * @default 0
   */
  autoRetry?: number
  /**
   * Delay in milliseconds before a case auto retry starts.
   *
   * A number applies the same delay to every retry. A function receives the
   * retry index where `1` is the first retry after the initial failure.
   *
   * @default retryIndex => 500 * 2 ** (retryIndex - 1)
   */
  autoRetryDelay?: TaskAutoRetryDelay
  /**
   * Timeout in milliseconds for one case execution.
   */
  timeout?: number
}

/**
 * Runtime context passed into eval task `run`.
 */
export interface TaskRunContext {
  /**
   * Task-scoped cache runtime.
   *
   * Use when:
   * - benchmark setup needs deterministic artifact reuse across attempts
   * - case-level logic needs typed text/json/binary cache loaders
   */
  cache: TaskExecutionContext['cache']
  /**
   * Emitter for run events, scoped to this task (and to the case inside case callbacks).
   *
   * Use when:
   * - task, case, or plugin code reports activity to the terminal, the event log, and reporters
   * - a custom project `executor` forwards `context.events` into `task.entry.task.run(...)`
   *
   * Expects:
   * - emits are best-effort: they never reject and never affect task scoring
   * - absent when a task runs outside `vieval run`; case output then goes straight to the terminal
   */
  events?: RunEventEmitter
  /**
   * Configured model registrations available to model plugins.
   *
   * Use when:
   * - a plugin owns model selection semantics and needs access to registered models
   * - eval code resolves matrix-selected model axes through plugin helpers
   */
  models: TaskExecutionContext['models']
  /**
   * Run identity and artifact storage supplied by `vieval run`.
   *
   * Use when:
   * - case code needs the run ids or a directory for its artifacts
   *
   * Expects:
   * - custom project executors forward the value they receive
   *
   * @default a local identity and a temporary artifacts root when the task runs outside `vieval run`
   */
  runStorage?: TaskRunStorage
  /**
   * Optional runtime scheduling overrides supplied by CLI or host execution.
   *
   * Use when:
   * - run operators need to override task/case concurrency without editing eval code
   * - DSL task runners need to distinguish runtime flags from code defaults
   *
   * Expects:
   * - values are positive integers when provided
   *
   * @default undefined
   */
  runtimeConcurrency?: TaskConcurrencyConfig
  /**
   * Cooperative abort signal for the current execution.
   *
   * `vieval run` aborts it when the run is interrupted (SIGINT, SIGTERM, SIGHUP). Running cases then see
   * their own `signal` abort, queued cases do not start, and failed cases are not retried.
   *
   * Expects:
   * - custom project executors forward the value they receive
   */
  signal?: AbortSignal
  /**
   * Scheduled runner task metadata.
   *
   * Matrix impact on runtime context:
   *
   * ```txt
   * project/eval/task matrix definitions
   *   -> scheduler expands run rows x eval rows
   *   -> one scheduled task per row pair
   *   -> context.task.matrix = {
   *        run:  selected run-axis values,
   *        eval: selected eval-axis values,
   *        meta: { runRowId, evalRowId }
   *      }
   * ```
   *
   * Practical impact:
   * - `runMatrix` axes appear under `context.task.matrix.run.*`
   * - `evalMatrix` axes appear under `context.task.matrix.eval.*`
   * - row ids are stable labels for grouping/aggregation under `context.task.matrix.meta.*`
   *
   * @example
   * ```ts
   * // If final selected rows are:
   * // run:  { model: 'gpt-4.1-mini', scenario: 'stress', promptLanguage: 'zh' }
   * // eval: { rubric: 'strict', rubricModel: 'judge-large' }
   *
   * context.task.matrix.run.model // 'gpt-4.1-mini'
   * context.task.matrix.run.scenario // 'stress'
   * context.task.matrix.eval.rubric // 'strict'
   * context.task.matrix.meta.runRowId // stable encoded row id
   * ```
   */
  task: ScheduledTask
  /**
   * Optional telemetry runtime shared by runner, DSL, and reporter integrations.
   *
   * Use when:
   * - task execution should emit events to the currently active telemetry runtime
   * - enabled and disabled telemetry should keep the same execution path
   *
   * Expects:
   * - callers inject a no-op runtime when telemetry is disabled
   */
  telemetry?: TelemetryRuntime
}

/**
 * Output of one eval task execution.
 */
export interface TaskRunOutput {
  /**
   * Scores emitted by this task run.
   */
  scores: readonly RunScore[]
}

/**
 * Run identity and artifact storage shared by every task of one run.
 */
export interface TaskRunStorage {
  /**
   * Directory under which each case gets its own `<taskId>/<caseId>/` artifacts directory.
   *
   * `vieval run` uses `<reportDirectory>/artifacts`, or a temporary directory removed at run end with `--no-report`.
   */
  artifactsRoot: string
  /**
   * Attempt id of the run.
   */
  attemptId: string
  /**
   * Run id.
   */
  runId: string
}
