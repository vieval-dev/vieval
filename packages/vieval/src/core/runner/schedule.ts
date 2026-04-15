import type { CollectedEvalEntry, MatrixDefinition, MatrixLayer, MatrixValue } from '../../config'

/**
 * Describes the inferenceExecutor target for a scheduled eval run.
 */
export interface InferenceExecutor {
  /**
   * Stable inferenceExecutor identifier such as `openai:gpt-4.1-mini`.
   */
  id: string
}

/**
 * Stores the selected value for each matrix axis.
 */
export type RunnerMatrixSelection = Record<string, string>

/**
 * Stores stable row ids for one resolved scheduled task matrix.
 */
export interface ScheduledTaskMatrixMeta {
  /**
   * Stable row id for the resolved run matrix selection.
   */
  runRowId: string
  /**
   * Stable row id for the resolved eval matrix selection.
   */
  evalRowId: string
}

/**
 * Stores the structured matrix payload for one scheduled task.
 */
export interface ScheduledTaskMatrix {
  /**
   * Runtime matrix selection visible to task code.
   */
  run: RunnerMatrixSelection
  /**
   * Eval-time matrix selection visible to task code.
   */
  eval: RunnerMatrixSelection
  /**
   * Stable row ids for both scopes.
   */
  meta: ScheduledTaskMatrixMeta
}

/**
 * Maps matrix axis names to the values that should be expanded.
 */
export type RunnerMatrixDefinition = MatrixDefinition

/**
 * Accepts either flat axis definitions or one layered matrix object.
 */
export type RunnerMatrixInput = RunnerMatrixDefinition | MatrixLayer

const matrixLayerKeys = new Set(['disable', 'extend', 'override'])
const ambiguousMatrixDefinitionErrorMessage = 'Ambiguous matrix definition: cannot mix reserved layer keys (disable, extend, override) with matrix axis keys.'

/**
 * Represents one fully expanded runner task.
 */
export interface ScheduledTask {
  /**
   * Stable task id derived from the entry, inferenceExecutor, and matrix selection.
   */
  id: string
  /**
   * The collected eval entry to execute.
   */
  entry: CollectedEvalEntry
  /**
   * The inferenceExecutor selected for this task.
   */
  inferenceExecutor: InferenceExecutor
  /**
   * The concrete scoped matrix selection for this task.
   */
  matrix: ScheduledTaskMatrix
}

/**
 * Configures how the runner should expand its execution matrix.
 */
export interface CreateRunnerScheduleOptions {
  /**
   * Collected eval entries that should be scheduled.
   */
  entries: readonly CollectedEvalEntry[]
  /**
   * Providers that should run each entry.
   */
  inferenceExecutors: readonly InferenceExecutor[]
  /**
   * Optional run-time matrix axes expanded as a cartesian product.
   */
  runMatrix?: RunnerMatrixInput
  /**
   * Optional eval-time matrix axes expanded as a cartesian product.
   */
  evalMatrix?: RunnerMatrixInput
}

function encodeTaskIdSegment(value: string): string {
  return encodeURIComponent(value)
}

function stringifyMatrixValue(value: MatrixValue): string {
  return String(value)
}

function cloneMatrixSelection(matrix: RunnerMatrixSelection): RunnerMatrixSelection {
  return { ...matrix }
}

function createScheduledTaskMatrix(
  runMatrix: RunnerMatrixSelection,
  evalMatrix: RunnerMatrixSelection,
): ScheduledTaskMatrix {
  return {
    eval: cloneMatrixSelection(evalMatrix),
    meta: {
      evalRowId: createStableRowId(evalMatrix),
      runRowId: createStableRowId(runMatrix),
    },
    run: cloneMatrixSelection(runMatrix),
  }
}

function isMatrixLayer(matrix: RunnerMatrixInput): matrix is MatrixLayer {
  const matrixKeys = Object.keys(matrix)
  return (
    matrixKeys.length > 0
    && matrixKeys.every(key => matrixLayerKeys.has(key))
  )
}

function assertNonAmbiguousMatrixDefinition(matrix: RunnerMatrixInput): void {
  const matrixKeys = Object.keys(matrix)
  const hasReservedKeys = matrixKeys.some(key => matrixLayerKeys.has(key))
  const hasAxisKeys = matrixKeys.some(key => !matrixLayerKeys.has(key))

  if (hasReservedKeys && hasAxisKeys) {
    throw new TypeError(ambiguousMatrixDefinitionErrorMessage)
  }
}

function normalizeLayerInputToAxes(matrix: RunnerMatrixInput | undefined): MatrixLayer | undefined {
  if (matrix == null) {
    return undefined
  }

  assertNonAmbiguousMatrixDefinition(matrix)

  if (isMatrixLayer(matrix)) {
    return matrix
  }

  return {
    extend: matrix,
  }
}

function dedupeAxisValues(values: readonly MatrixValue[]): string[] {
  return Array.from(new Set(values.map(stringifyMatrixValue)))
}

function applyAxisValues(
  axes: Map<string, string[]>,
  definition: RunnerMatrixDefinition | undefined,
  mode: 'extend' | 'override',
): void {
  if (definition == null) {
    return
  }

  for (const [axis, values] of Object.entries(definition)) {
    const nextValues = dedupeAxisValues(values)

    if (mode === 'extend') {
      const existingValues = axes.get(axis) ?? []
      axes.set(axis, Array.from(new Set([...existingValues, ...nextValues])))
      continue
    }

    axes.set(axis, nextValues)
  }
}

function applyLayer(
  baseAxes: ReadonlyMap<string, string[]>,
  layer: MatrixLayer | undefined,
): Map<string, string[]> {
  const nextAxes = new Map<string, string[]>(
    Array.from(baseAxes.entries()).map(([axis, values]) => [axis, [...values]]),
  )

  for (const axis of layer?.disable ?? []) {
    nextAxes.delete(axis)
  }

  applyAxisValues(nextAxes, layer?.extend, 'extend')
  applyAxisValues(nextAxes, layer?.override, 'override')

  return nextAxes
}

function expandAxesToRows(axes: ReadonlyMap<string, readonly string[]>): RunnerMatrixSelection[] {
  if (axes.size === 0) {
    return [{}]
  }

  const dimensions = Array.from(axes.entries())

  let selections: RunnerMatrixSelection[] = [{}]

  for (const [axis, values] of dimensions) {
    if (values.length === 0) {
      return []
    }

    const nextSelections: RunnerMatrixSelection[] = []

    for (const selection of selections) {
      for (const value of values) {
        nextSelections.push({
          ...selection,
          [axis]: value,
        })
      }
    }

    selections = nextSelections
  }

  return selections
}

function createStableRowId(matrix: RunnerMatrixSelection): string {
  const segments = Object.entries(matrix)
    .sort(([leftAxis], [rightAxis]) => leftAxis.localeCompare(rightAxis))
    .map(([axis, value]) => `${encodeTaskIdSegment(axis)}=${encodeTaskIdSegment(value)}`)

  if (segments.length === 0) {
    return 'default'
  }

  return segments.join('&')
}

function createTaskId(entryId: string, inferenceExecutorId: string, runRowId: string, evalRowId: string): string {
  const encodedEntryId = encodeTaskIdSegment(entryId)
  const encodedProviderId = encodeTaskIdSegment(inferenceExecutorId)

  return [
    encodedEntryId,
    encodedProviderId,
    `run=${encodeTaskIdSegment(runRowId)}`,
    `eval=${encodeTaskIdSegment(evalRowId)}`,
  ].join('::')
}

function createResolvedRunAxes(
  entry: CollectedEvalEntry,
  runMatrix: RunnerMatrixInput | undefined,
): Map<string, string[]> {
  let resolvedAxes = new Map<string, string[]>()

  for (const layerInput of [
    runMatrix,
    entry.matrix?.runMatrix,
    entry.task?.matrix?.runMatrix,
  ]) {
    resolvedAxes = applyLayer(resolvedAxes, normalizeLayerInputToAxes(layerInput))
  }

  return resolvedAxes
}

function createResolvedEvalAxes(
  entry: CollectedEvalEntry,
  evalMatrix: RunnerMatrixInput | undefined,
): Map<string, string[]> {
  let resolvedAxes = new Map<string, string[]>()

  for (const layerInput of [
    evalMatrix,
    entry.matrix?.evalMatrix,
    entry.task?.matrix?.evalMatrix,
  ]) {
    resolvedAxes = applyLayer(resolvedAxes, normalizeLayerInputToAxes(layerInput))
  }

  return resolvedAxes
}

/**
 * Expands collected entries into a stable runner schedule.
 *
 * Call stack:
 *
 * {@link collectEvalEntries} (`../runner`)
 *   -> {@link createRunnerSchedule}
 *     -> {@link expandAxesToRows}
 *       -> {@link ScheduledTask}[]
 *
 * Use when:
 * - the runner already knows which eval entries are available
 * - each entry must run against multiple inferenceExecutors or matrix variants
 *
 * Expects:
 * - `entries` and `inferenceExecutors` to be provided in the desired execution order
 * - matrix axes to use insertion order when generating combinations
 */
export function createRunnerSchedule(options: CreateRunnerScheduleOptions): ScheduledTask[] {
  if (options.entries.length === 0) {
    return []
  }

  if (options.inferenceExecutors.length === 0) {
    return []
  }

  const tasks: ScheduledTask[] = []

  for (const entry of options.entries) {
    const runSelections = expandAxesToRows(createResolvedRunAxes(entry, options.runMatrix))
    const evalSelections = expandAxesToRows(createResolvedEvalAxes(entry, options.evalMatrix))

    if (runSelections.length === 0 || evalSelections.length === 0) {
      continue
    }

    for (const inferenceExecutor of options.inferenceExecutors) {
      for (const runMatrix of runSelections) {
        for (const evalMatrix of evalSelections) {
          const isolatedMatrix = createScheduledTaskMatrix(runMatrix, evalMatrix)

          tasks.push({
            entry,
            id: createTaskId(
              entry.id,
              inferenceExecutor.id,
              isolatedMatrix.meta.runRowId,
              isolatedMatrix.meta.evalRowId,
            ),
            matrix: isolatedMatrix,
            inferenceExecutor,
          })
        }
      }
    }
  }

  return tasks
}
