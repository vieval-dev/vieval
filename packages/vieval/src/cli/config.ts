import type { ConfigHookPlugin, MatrixDefinition, MatrixLayer, TaskRunContext } from '../config'
import type { ModelDefinition } from '../config/models'
import type { RunResult, TaskExecutionContext } from '../core/runner'
import type { InferenceExecutor, ScheduledTask } from '../core/runner/schedule'
import type { VievalVitestCompatReporterReference } from './reporters/vitest-compat-reporter'

import process from 'node:process'

import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { errorMessageFrom } from '@moeru/std'
import { createDefineConfig, loadConfig } from 'c12'
import { loadEnv as loadViteEnv } from 'vite'

const matrixLayerKeys = new Set(['disable', 'extend', 'override'])
const ambiguousMatrixDefinitionErrorMessage = 'Ambiguous matrix definition: cannot mix reserved layer keys (disable, extend, override) with matrix axis keys.'
const require = createRequire(import.meta.url)

/**
 * CLI plugin shape bound to the full CLI config object.
 */
export type CliConfigPlugin = ConfigHookPlugin<CliConfig>

/**
 * Concurrency limits that can be declared in CLI-facing config.
 *
 * Use when:
 * - the CLI needs independent caps for workspace, project, task, attempt, or case scheduling scopes
 * - config authors want to define concurrency without wiring runtime execution yet
 *
 * Expects:
 * - each provided value to be a positive integer chosen by the caller
 *
 * Returns:
 * - one partial concurrency descriptor keyed by scheduling scope
 */
export interface CliConcurrencyConfig {
  /**
   * Workspace-level concurrency cap.
   */
  workspace?: number
  /**
   * Project-level concurrency cap.
   */
  project?: number
  /**
   * Task-level concurrency cap.
   */
  task?: number
  /**
   * Attempt-level concurrency cap.
   */
  attempt?: number
  /**
   * Case-level concurrency cap.
   */
  case?: number
}

/**
 * Defines one project block for `vieval run`.
 */
export interface CliProjectConfig {
  /**
   * Project label used in summary output.
   */
  name: string
  /**
   * Project root used for include/exclude glob matching.
   *
   * @default process cwd
   */
  root?: string
  /**
   * Glob patterns for eval file discovery.
   *
   * @default Common eval file globs for TypeScript and JavaScript module formats.
   */
  include?: string[]
  /**
   * Glob patterns excluded from discovery.
   *
   * @default Common exclusion globs for dependencies, build output, and VCS directories.
   */
  exclude?: string[]
  /**
   * Providers expanded by scheduler.
   *
   * @default [{ id: 'default' }]
   */
  inferenceExecutors?: InferenceExecutor[]
  /**
   * Model definitions available to project runtime execution.
   *
   * Inference executors control schedule fan-out, while models provide
   * runtime lookup metadata for `context.model(...)` during task execution.
   *
   * @default inherited from top-level config models
   */
  models?: ModelDefinition[]
  /**
   * Optional run-time matrix dimensions.
   */
  runMatrix?: MatrixDefinition | MatrixLayer
  /**
   * Optional eval-time matrix dimensions.
   */
  evalMatrix?: MatrixDefinition | MatrixLayer
  /**
   * Optional project-scoped concurrency overrides.
   *
   * @default inherited from top-level or CLI execution settings
   */
  concurrency?: Omit<CliConcurrencyConfig, 'workspace'>
  /**
   * Optional task executor.
   *
   * Use when this project should execute live inferenceExecutor requests.
   * If omitted, `vieval run` performs collection + scheduling only.
   */
  executor?: (task: ScheduledTask, context: CliProjectExecutorContext) => Promise<RunResult>
  /**
   * Optional project-local plugins.
   */
  plugins?: CliConfigPlugin[]
  /**
   * Optional vitest-compatible reporter modules.
   *
   * Use when:
   * - project runs should emit additional reporter callbacks using Vitest-style lifecycle names
   *
   * @default []
   */
  reporters?: VievalVitestCompatReporterReference[]
}

/**
 * One workspace descriptor for workspace-mode configs.
 */
export interface CliWorkspaceConfig {
  /**
   * Workspace identifier.
   */
  id: string
  /**
   * Workspace root path.
   */
  root: string
}

/**
 * One explicit comparison method descriptor.
 */
export interface CliComparisonMethodConfig {
  /**
   * Method identifier shown in compare reports.
   */
  id: string
  /**
   * Workspace path containing this method's `vieval.config.*`.
   */
  workspace: string
  /**
   * Project name to execute inside workspace config.
   */
  project: string
  /**
   * Optional explicit config file path for this workspace.
   */
  configFilePath?: string
}

/**
 * Benchmark identity and shared cache namespace.
 */
export interface CliComparisonBenchmarkConfig {
  /**
   * Benchmark identifier used in report artifacts.
   */
  id: string
  /**
   * Shared cache namespace reused across method runs.
   */
  sharedCaseNamespace: string
}

/**
 * One comparison entry loaded by `vieval compare`.
 */
export interface CliComparisonConfig {
  /**
   * Comparison id selected by `--comparison`.
   */
  id: string
  /**
   * Benchmark metadata for reporting and shared cache coordination.
   */
  benchmark: CliComparisonBenchmarkConfig
  /**
   * Optional explicit method list.
   */
  methods?: CliComparisonMethodConfig[]
  /**
   * Optional workspace glob(s) discovered relative to config directory.
   */
  includesWorkspaces?: string | string[]
  /**
   * Optional workspace exclude glob(s), also relative to config directory.
   */
  excludesWorkspaces?: string | string[]
}

/**
 * Execution context exposed to project-level `executor` implementations.
 *
 * Use when:
 * - a project executor needs the task-scoped model resolver plus case reporter hooks
 * - custom scheduling logic wants the same hook shape as `TaskRunContext`
 *
 * Expects:
 * - `model` resolves configured models for the current task
 * - `reporterHooks` follows `TaskRunContext['reporterHooks']`
 */
export interface CliProjectExecutorContext extends TaskExecutionContext {
  reporterHooks?: TaskRunContext['reporterHooks']
}

/**
 * Top-level CLI config loaded from `vieval.config.*`.
 */
interface CliConfigBase {
  /**
   * Global model definitions inherited by projects.
   *
   * @default []
   */
  models?: ModelDefinition[]
  /**
   * Global concurrency defaults inherited by projects and tasks.
   *
   * Use when:
   * - config authors want one shared concurrency policy across workspace, project, task, attempt, and case scopes
   * - project-local overrides should start from a top-level baseline
   *
   * Expects:
   * - each provided value to be a positive integer chosen by the caller
   *
   * @default undefined
   */
  concurrency?: CliConcurrencyConfig
  /**
   * Global config plugins.
   *
   * @default []
   */
  plugins?: CliConfigPlugin[]
  /**
   * Global vitest-compatible reporter modules inherited by projects.
   *
   * @default []
   */
  reporters?: VievalVitestCompatReporterReference[]
  /**
   * Environment variables injected into `process.env` during `vieval run`.
   *
   * Use when:
   * - eval tasks depend on runtime env values (for example inferenceExecutor API keys)
   * - config wants deterministic env values without shell-level exports
   *
   * @default {}
   */
  env?: NodeJS.ProcessEnv
}

/**
 * Project mode config for `vieval run`.
 */
export interface CliProjectModeConfig extends CliConfigBase {
  /**
   * Project list expanded by `vieval run`.
   *
   * @default [{ name: 'default' }]
   */
  projects?: CliProjectConfig[]
  comparisons?: never
  workspaces?: never
}

/**
 * Workspace mode config placeholder for future workspace orchestration.
 */
export interface CliWorkspaceModeConfig extends CliConfigBase {
  workspaces: CliWorkspaceConfig[]
  projects?: never
  comparisons?: never
}

/**
 * Comparison mode config for `vieval compare`.
 */
export interface CliComparisonModeConfig extends CliConfigBase {
  comparisons: CliComparisonConfig[]
  projects?: never
  workspaces?: never
}

/**
 * Top-level CLI config loaded from `vieval.config.*`.
 *
 * Exactly one top-level mode is allowed:
 * - `projects`
 * - `workspaces`
 * - `comparisons`
 */
export type CliConfig = CliProjectModeConfig | CliWorkspaceModeConfig | CliComparisonModeConfig

export type CliConfigMode = 'comparisons' | 'projects' | 'workspaces'

export interface LoadedRawCliConfig {
  config: CliConfig | null
  configFilePath: string | null
}

/**
 * Normalized CLI project used by runtime orchestration.
 */
export interface NormalizedCliProjectConfig {
  concurrency?: Omit<CliConcurrencyConfig, 'workspace'>
  exclude: string[]
  executor?: (task: ScheduledTask, context: CliProjectExecutorContext) => Promise<RunResult>
  include: string[]
  runMatrix?: MatrixLayer
  evalMatrix?: MatrixLayer
  models: ModelDefinition[]
  name: string
  inferenceExecutors: InferenceExecutor[]
  root: string
  reporters: VievalVitestCompatReporterReference[]
}

/**
 * Result of loading and normalizing a config file.
 */
export interface LoadedCliConfig {
  concurrency?: CliConcurrencyConfig
  configFilePath: string | null
  env: NodeJS.ProcessEnv
  projects: NormalizedCliProjectConfig[]
}

/**
 * Runtime options for config loading.
 */
export interface LoadVievalCliConfigOptions {
  /**
   * Starting directory for config lookup.
   *
   * @default process.cwd()
   */
  cwd?: string
  /**
   * Explicit config file path.
   */
  configFilePath?: string
}

/**
 * Helper used by `vieval.config.*` for better type inference.
 */
export const defineConfig = createDefineConfig<CliConfig>()

/**
 * Loads `.env*` files using Vite's env resolution behavior.
 *
 * Use when:
 * - `vieval.config.*` should mirror Vitest/Vite env loading semantics
 * - config wants to populate top-level `env` via file-based values
 *
 * Expects:
 * - `mode` to match the env file suffix (`.env.<mode>`)
 * - `envDir` to point at the directory containing `.env` files
 *
 * Returns:
 * - Key/value map compatible with `CliConfig['env']`
 */
export function loadEnv(mode: string, envDir: string, prefixes: string | string[] = ''): NodeJS.ProcessEnv {
  return loadViteEnv(mode, envDir, prefixes)
}

async function applyVievalPlugins(config: CliConfig): Promise<CliConfig> {
  let currentConfig: CliConfig = config
  const plugins = currentConfig.plugins ?? []

  for (const plugin of plugins) {
    if (plugin.configVieval == null) {
      continue
    }

    const nextConfig = await plugin.configVieval(currentConfig)
    if (nextConfig != null) {
      currentConfig = {
        ...currentConfig,
        ...nextConfig,
      } as CliConfig
    }
  }

  for (const plugin of plugins) {
    await plugin.configVievalResolved?.(currentConfig)
  }

  return currentConfig
}

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  }
  catch {
    return false
  }
}

function isConfigFileExtensionUsingRequire(extension: string): boolean {
  return extension === '.cjs' || extension === '.cts'
}

function isConfigFileExtensionUsingJsonParse(extension: string): boolean {
  return extension === '.json'
}

async function importVievalConfigModule(filePath: string): Promise<unknown> {
  const extension = extname(filePath)

  if (isConfigFileExtensionUsingJsonParse(extension)) {
    const raw = await readFile(filePath, 'utf-8')
    return JSON.parse(raw) as unknown
  }

  if (isConfigFileExtensionUsingRequire(extension)) {
    return require(filePath) as unknown
  }

  return import(pathToFileURL(filePath).href)
}

function resolveConfigExport(moduleValue: unknown): unknown {
  if (moduleValue == null) {
    return null
  }

  if (typeof moduleValue !== 'object') {
    return moduleValue
  }

  if ('default' in moduleValue) {
    return (moduleValue as { default: unknown }).default
  }

  return moduleValue
}

async function findNearestConfigFile(startDirectory: string): Promise<string | null> {
  const supportedFileNames = [
    'vieval.config.ts',
    'vieval.config.mts',
    'vieval.config.cts',
    'vieval.config.js',
    'vieval.config.mjs',
    'vieval.config.cjs',
    'vieval.config.json',
  ]

  let currentDirectory = resolve(startDirectory)

  while (true) {
    for (const fileName of supportedFileNames) {
      const candidatePath = join(currentDirectory, fileName)
      if (await isReadableFile(candidatePath)) {
        return candidatePath
      }
    }

    const parentDirectory = dirname(currentDirectory)
    if (parentDirectory === currentDirectory) {
      return null
    }
    currentDirectory = parentDirectory
  }
}

async function resolveVievalConfig(
  cwd: string,
  explicitConfigFilePath: string | undefined,
): Promise<{
  config: CliConfig | null
  configFilePath: string | null
}> {
  const resolvedConfigFilePath = explicitConfigFilePath == null
    ? await findNearestConfigFile(cwd)
    : (isAbsolute(explicitConfigFilePath) ? explicitConfigFilePath : resolve(cwd, explicitConfigFilePath))

  if (explicitConfigFilePath != null && resolvedConfigFilePath != null && !await isReadableFile(resolvedConfigFilePath)) {
    throw new Error(`Config file does not exist or is not readable: ${resolvedConfigFilePath}`)
  }

  if (resolvedConfigFilePath == null) {
    return {
      config: null,
      configFilePath: null,
    }
  }

  const loaded = await loadConfig<CliConfig>({
    configFile: resolvedConfigFilePath,
    cwd,
    dotenv: false,
    envName: false,
    extend: false,
    import: importVievalConfigModule,
    packageJson: false,
    rcFile: false,
    resolveModule: resolveConfigExport,
  })
  return {
    config: loaded.config,
    configFilePath: resolvedConfigFilePath,
  }
}

function isLayerMatrixDefinition(matrix: MatrixDefinition | MatrixLayer): matrix is MatrixLayer {
  const matrixKeys = Object.keys(matrix)
  return (
    matrixKeys.length > 0
    && matrixKeys.every(key => matrixLayerKeys.has(key))
  )
}

function assertNonAmbiguousMatrixDefinition(matrix: MatrixDefinition | MatrixLayer): void {
  const matrixKeys = Object.keys(matrix)
  const hasReservedKeys = matrixKeys.some(key => matrixLayerKeys.has(key))
  const hasAxisKeys = matrixKeys.some(key => !matrixLayerKeys.has(key))

  if (hasReservedKeys && hasAxisKeys) {
    throw new TypeError(ambiguousMatrixDefinitionErrorMessage)
  }
}

function normalizeMatrixLayerInput(matrix: MatrixDefinition | MatrixLayer | undefined): MatrixLayer | undefined {
  if (matrix == null) {
    return undefined
  }

  assertNonAmbiguousMatrixDefinition(matrix)

  if (isLayerMatrixDefinition(matrix)) {
    return matrix
  }

  return {
    extend: matrix,
  }
}

function toProjectConcurrencyDefaults(
  concurrency: CliConcurrencyConfig | undefined,
): Omit<CliConcurrencyConfig, 'workspace'> | undefined {
  if (concurrency == null) {
    return undefined
  }

  return {
    attempt: concurrency.attempt,
    case: concurrency.case,
    project: concurrency.project,
    task: concurrency.task,
  }
}

function mergeProjectConcurrency(
  inheritedConcurrency: Omit<CliConcurrencyConfig, 'workspace'> | undefined,
  projectConcurrency: Omit<CliConcurrencyConfig, 'workspace'> | undefined,
): Omit<CliConcurrencyConfig, 'workspace'> | undefined {
  if (inheritedConcurrency == null && projectConcurrency == null) {
    return undefined
  }

  return {
    attempt: projectConcurrency?.attempt ?? inheritedConcurrency?.attempt,
    case: projectConcurrency?.case ?? inheritedConcurrency?.case,
    project: projectConcurrency?.project ?? inheritedConcurrency?.project,
    task: projectConcurrency?.task ?? inheritedConcurrency?.task,
  }
}

function normalizeProjectConfig(
  project: CliProjectConfig,
  cwd: string,
  inheritedConcurrency: Omit<CliConcurrencyConfig, 'workspace'> | undefined,
  inheritedModels: readonly ModelDefinition[],
  inheritedReporterReferences: readonly VievalVitestCompatReporterReference[],
): NormalizedCliProjectConfig {
  const include = project.include ?? [
    '**/*.eval.ts',
    '**/*.eval.mts',
    '**/*.eval.cts',
    '**/*.eval.js',
    '**/*.eval.mjs',
    '**/*.eval.cjs',
  ]
  const exclude = project.exclude ?? [
    '**/node_modules/**',
    '**/dist/**',
    '**/.git/**',
  ]
  const models = project.models ?? [...inheritedModels]
  const inferenceExecutors = project.inferenceExecutors ?? [{ id: 'default' }]
  const root = project.root == null
    ? cwd
    : (isAbsolute(project.root) ? project.root : resolve(cwd, project.root))
  const reporters = project.reporters ?? [...inheritedReporterReferences]
  const concurrency = mergeProjectConcurrency(inheritedConcurrency, project.concurrency)

  return {
    concurrency,
    exclude,
    executor: project.executor,
    include,
    evalMatrix: normalizeMatrixLayerInput(project.evalMatrix),
    models,
    name: project.name,
    inferenceExecutors,
    reporters,
    runMatrix: normalizeMatrixLayerInput(project.runMatrix),
    root,
  }
}

function normalizeConfig(config: CliConfig | null | undefined, cwd: string): NormalizedCliProjectConfig[] {
  if (config != null) {
    const mode = detectCliConfigMode(config)
    if (mode === 'comparisons') {
      throw new Error('vieval run requires project-mode config. Received comparison-mode config.')
    }
    if (mode === 'workspaces') {
      throw new Error('vieval run requires project-mode config. Received workspace-mode config.')
    }
  }

  const projects = config?.projects ?? [{ name: 'default' }]
  const inheritedConcurrency = toProjectConcurrencyDefaults(config?.concurrency)
  const inheritedModels = config?.models ?? []
  const inheritedReporterReferences = config?.reporters ?? []

  return projects.map(project => normalizeProjectConfig(
    project,
    cwd,
    inheritedConcurrency,
    inheritedModels,
    inheritedReporterReferences,
  ))
}

/**
 * Detects which top-level config mode is active.
 *
 * Expects:
 * - exactly one of `projects`, `workspaces`, or `comparisons`
 *
 * Returns:
 * - active top-level mode key
 */
export function detectCliConfigMode(config: CliConfig): CliConfigMode {
  const declaredModes: CliConfigMode[] = []
  if (config.projects != null) {
    declaredModes.push('projects')
  }
  if (config.workspaces != null) {
    declaredModes.push('workspaces')
  }
  if (config.comparisons != null) {
    declaredModes.push('comparisons')
  }

  if (declaredModes.length > 1) {
    throw new Error(`Invalid vieval config: top-level keys are mutually exclusive. Found ${declaredModes.join(', ')}.`)
  }

  return declaredModes[0] ?? 'projects'
}

/**
 * Loads nearest `vieval.config.*` without project normalization.
 */
export async function loadRawVievalConfig(options: LoadVievalCliConfigOptions = {}): Promise<LoadedRawCliConfig> {
  const cwd = options.cwd ?? process.cwd()

  try {
    const loadedConfig = await resolveVievalConfig(cwd, options.configFilePath)
    if (loadedConfig.configFilePath == null || loadedConfig.config == null) {
      return {
        config: null,
        configFilePath: null,
      }
    }

    const config = await applyVievalPlugins(loadedConfig.config)
    detectCliConfigMode(config)

    return {
      config,
      configFilePath: loadedConfig.configFilePath,
    }
  }
  catch (error) {
    const errorMessage = errorMessageFrom(error) ?? 'Unknown config loading error.'
    const configFilePath = options.configFilePath == null
      ? 'vieval.config'
      : (isAbsolute(options.configFilePath) ? options.configFilePath : resolve(cwd, options.configFilePath))
    throw new Error(`Failed to load vieval config "${configFilePath}": ${errorMessage}`, { cause: error })
  }
}

/**
 * Loads nearest `vieval.config.*` and returns normalized project definitions.
 *
 * Call stack:
 *
 * {@link loadVievalCliConfig}
 *   -> {@link resolveVievalConfig}
 *   -> {@link normalizeConfig}
 *     -> {@link NormalizedCliProjectConfig}[]
 *
 * Use when:
 * - CLI orchestration needs project includes/excludes similar to Vitest
 * - callers want config auto-discovery without manual imports in eval files
 */
export async function loadVievalCliConfig(options: LoadVievalCliConfigOptions = {}): Promise<LoadedCliConfig> {
  const cwd = options.cwd ?? process.cwd()
  try {
    const loadedConfig = await loadRawVievalConfig(options)
    if (loadedConfig.configFilePath == null || loadedConfig.config == null) {
      return {
        concurrency: undefined,
        configFilePath: null,
        env: {},
        projects: normalizeConfig(null, cwd),
      }
    }

    const config = loadedConfig.config

    return {
      concurrency: config.concurrency,
      configFilePath: loadedConfig.configFilePath,
      env: config.env ?? {},
      projects: normalizeConfig(config, dirname(loadedConfig.configFilePath)),
    }
  }
  catch (error) {
    const errorMessage = errorMessageFrom(error) ?? 'Unknown config loading error.'
    const configFilePath = options.configFilePath == null
      ? 'vieval.config'
      : (isAbsolute(options.configFilePath) ? options.configFilePath : resolve(cwd, options.configFilePath))
    throw new Error(`Failed to load vieval config "${configFilePath}": ${errorMessage}`, { cause: error })
  }
}
