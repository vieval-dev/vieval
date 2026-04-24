import type { RunScore } from '../core/runner'
import type { ScheduledTask } from '../core/runner/schedule'
import type { TaskExecutionContext } from '../core/runner/task-context'

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
export type MatrixPrimitive = string | number | boolean

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
  /**
   * Matrix axes disabled at this layer.
   *
   * @example
   * ```ts
   * disable: ['temperatureProfile']
   * ```
   */
  disable?: readonly string[]
}

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
   * Additional retries allowed within the current attempt.
   *
   * @default 0
   */
  autoRetry?: number
  /**
   * Additional full task attempts allowed after the current attempt settles.
   *
   * @default 0
   */
  autoAttempt?: number
  /**
   * Timeout in milliseconds for one case execution.
   */
  timeout?: number
}

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
   * Matrix-scoped model resolver.
   *
   * Runtime impact:
   * - `context.model()` uses `context.task.matrix.run.model` first when present
   * - then falls back to inferenceExecutor-id match
   * - then falls back to first configured model
   *
   * @example
   * ```ts
   * // matrix.run.model = 'gpt-4.1-mini'
   * const defaultModel = context.model()
   * // resolves the configured model whose id/model/alias matches 'gpt-4.1-mini'
   *
   * const judgeModel = context.model({ name: 'judge-large' })
   * // explicit lookup bypasses matrix default
   * ```
   */
  model: TaskExecutionContext['model']
  /**
   * Optional reporter lifecycle hooks for task-local case events.
   *
   * Use when:
   * - a caller wants visibility into each case without coupling to the CLI reporter layer
   *
   * Expects:
   * - hooks are best-effort observers and should not affect task scoring
   */
  reporterHooks?: TaskReporterHooks
  /**
   * Cooperative abort signal for the current execution.
   */
  signal?: AbortSignal
}

/**
 * Allowed terminal outcomes for one task case.
 *
 * Use when:
 * - emitting case lifecycle events from the task DSL
 *
 * Expects:
 * - consumers treat the value as the final state for the case
 */
export type TaskCaseState = 'passed' | 'failed' | 'timeout'

/**
 * Payload emitted when a task case starts.
 *
 * Use when:
 * - reporter hooks need a stable position for one case within the task
 *
 * Expects:
 * - `name` is the declared DSL case label
 * - `index` is the zero-based case position within the task
 * - `total` is the total number of registered cases
 */
export interface TaskCaseReporterPayload {
  /**
   * Declared case label.
   */
  name: string
  /**
   * Zero-based case position within the task.
   */
  index: number
  /**
   * Total number of registered cases.
   */
  total: number
}

/**
 * Payload emitted when a task case ends.
 *
 * Use when:
 * - reporter hooks need the case position plus terminal state
 *
 * Expects:
 * - `name` is the declared DSL case label
 * - `index` is the zero-based case position within the task
 * - `total` is the total number of registered cases
 * - `state` describes the final case result
 */
export interface TaskCaseReporterEndPayload extends TaskCaseReporterPayload {
  /**
   * Final case state.
   */
  state: TaskCaseState
  /**
   * Optional failure message when `state` is `failed`.
   */
  errorMessage?: string
}

/**
 * Reporter hooks invoked around each task case execution.
 *
 * Use when:
 * - a caller needs case-level lifecycle visibility from the DSL runner
 * - downstream reporters should stay decoupled from the task execution path
 *
 * Expects:
 * - hooks observe case start/end events but do not influence scoring
 */
export interface TaskReporterHooks {
  /**
   * Runs when a case is about to execute.
   */
  onCaseStart?: (payload: TaskCaseReporterPayload) => void
  /**
   * Runs after a case settles.
   */
  onCaseEnd?: (payload: TaskCaseReporterEndPayload) => void
  /**
   * Runs when task code emits a custom telemetry/reporting event.
   *
   * Use when:
   * - eval implementations need report artifacts beyond case lifecycle counters
   * - model/runtime integrations emit inference, metering, or tool-call events
   */
  onEvent?: (payload: TaskReporterEventPayload) => void
}

/**
 * Payload emitted by task code for custom report events.
 *
 * Use when:
 * - reporting runtime telemetry such as inference requests, responses, or tool calls
 * - attaching modality-specific metrics without coupling task logic to CLI internals
 *
 * Expects:
 * - `event` to be a stable event name
 * - `data` to be JSON-serializable for report artifact persistence
 */
export interface TaskReporterEventPayload {
  /**
   * Event name written into report event envelopes.
   */
  event: string
  /**
   * Optional custom payload persisted under event `data`.
   */
  data?: unknown
  /**
   * Optional stable case id when the event maps to one case lifecycle.
   */
  caseId?: string
}

/**
 * Eval task definition used by `defineTask`.
 */
export interface TaskDefinition {
  /**
   * Stable task id for diagnostics.
   */
  id: string
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
 * Declares the metadata required for a single vieval evaluation module.
 */
export interface EvalDefinition {
  description: string
  name: string
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
 * Represents a normalized evaluation entry collected by the runner.
 */
export type CollectedEvalEntry<TDefinition extends EvalDefinition = EvalDefinition> = TDefinition & {
  directory: string
  filePath: string
  id: string
}
