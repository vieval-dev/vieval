import type { CliReportingConfig, ConfigHookPlugin, MatrixDefinition, MatrixLayer, TaskRunContext } from '../config'
import type { ModelDefinition } from '../config/models'
import type { RunResult, TaskExecutionContext } from '../core/runner'
import type { InferenceExecutor, ScheduledTask } from '../core/runner/schedule'
import type { SchedulerConcurrencyConfig, SchedulerMiddleware } from '../core/scheduler/types'
import type { VievalVitestCompatReporterReference } from './reporters/vitest-compat-reporter'

import process from 'node:process'

import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { errorMessageFrom } from '@moeru/std'
import { createDefineConfig, loadConfig } from 'c12'
import { glob } from 'tinyglobby'
import { loadEnv as loadViteEnv } from 'vite'

const matrixLayerKeys = new Set(['disable', 'extend', 'override'])
const ambiguousMatrixDefinitionErrorMessage = 'Ambiguous matrix definition: cannot mix reserved layer keys (disable, extend, override) with matrix axis keys.'
const require = createRequire(import.meta.url)

/** Config file names, in lookup order: a directory with one of them is a workspace or a comparison. */
export const supportedConfigFileNames = [
  'vieval.config.ts',
  'vieval.config.mts',
  'vieval.config.cts',
  'vieval.config.js',
  'vieval.config.mjs',
  'vieval.config.cjs',
  'vieval.config.json',
] as const

/**
 * Comparison config: the outermost level, which runs several workspaces side by side and compares them.
 *
 * A comparison holds no evaluation settings (models, plugins, reporters): each workspace runs in its own process
 * with its own config and dependencies, so only what the comparison owns is set here.
 */
export interface CliComparisonConfig {
  /**
   * Cache shared by every workspace, under `.vieval/cache/<comparison id>/<namespace>/` next to this config.
   *
   * Without it, each project keeps caching under its own root.
   *
   * @default undefined
   */
  cache?: {
    /** Namespace that names what the shared entries are valid for, for example `formula-speech-v1`. */
    namespace: string
  }
  /**
   * How many workspaces run at once.
   */
  concurrency?: {
    /**
     * Most workspaces running at once. Each workspace keeps its own task and case pools.
     *
     * @default every workspace at once
     */
    workspace?: number
  }
  /**
   * Env given to every workspace. It wins over each workspace config's own `env`, and is applied before the
   * workspace's plugins run, so plugins that read `config.env` (model API keys) see it.
   *
   * @default {}
   */
  env?: NodeJS.ProcessEnv
  /**
   * Comparison id stamped on every run.
   *
   * @default the name of the directory of this config file
   */
  id?: string
  projects?: never
  /**
   * Workspaces to compare: directories holding a `vieval.config.*`, as paths or globs relative to this config,
   * or entries with their own id and env. A glob entry starting with `!` excludes directories.
   */
  workspaces: Array<CliComparisonWorkspaceConfig | string>
}

/**
 * One workspace of a comparison, given explicitly.
 */
export interface CliComparisonWorkspaceConfig {
  /**
   * Env given to this workspace only, on top of the comparison's `env`.
   *
   * @default {}
   */
  env?: NodeJS.ProcessEnv
  /**
   * Workspace id used in report paths and on every event.
   *
   * @default the name of `root`
   */
  id?: string
  /**
   * Directory of the workspace (holding its `vieval.config.*`), relative to the comparison config.
   */
  root: string
}

/**
 * Top-level CLI config loaded from `vieval.config.*`.
 *
 * - With `workspaces`, the config is a comparison ({@link CliComparisonConfig}).
 * - Otherwise it is a workspace: it lists its `projects` ({@link CliProjectModeConfig}).
 */
export type CliConfig = CliComparisonConfig | CliProjectModeConfig

export type CliConfigMode = 'comparison' | 'workspace'

/**
 * CLI plugin shape bound to the full CLI config object.
 */
export type CliConfigPlugin = ConfigHookPlugin<CliProjectModeConfig>

/**
 * Pools a project declares for its own tasks and cases.
 */
export type CliProjectConcurrencyConfig = Pick<SchedulerConcurrencyConfig, 'case' | 'task'>

/**
 * Defines one project block for `vieval run`.
 */
export interface CliProjectConfig {
  /**
   * Optional eval-time matrix dimensions.
   */
  evalMatrix?: MatrixDefinition | MatrixLayer
  /**
   * Glob patterns excluded from discovery.
   *
   * @default Common exclusion globs for dependencies, build output, and VCS directories.
   */
  exclude?: string[]
  /**
   * Optional task executor.
   *
   * Use when this project should execute live inferenceExecutor requests.
   * If omitted, `vieval run` performs collection + scheduling only.
   */
  executor?: (task: ScheduledTask, context: CliProjectExecutorContext) => Promise<RunResult>
  /**
   * Glob patterns for eval file discovery.
   *
   * @default Common eval file globs for TypeScript and JavaScript module formats.
   */
  include?: string[]
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
   * runtime lookup metadata for model plugin helpers during task execution.
   *
   * @default inherited from top-level config models
   */
  models?: ModelDefinition[]
  /**
   * Project label used in summary output.
   */
  name: string
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
  /**
   * Project root used for include/exclude glob matching.
   *
   * @default the directory of the config file (the process cwd without one)
   */
  root?: string
  /**
   * Optional run-time matrix dimensions.
   */
  runMatrix?: MatrixDefinition | MatrixLayer
  /**
   * Scheduler settings for the tasks and cases of this project.
   *
   * @default undefined
   */
  scheduler?: CliProjectSchedulerConfig
}

/**
 * Execution context exposed to project-level `executor` implementations.
 *
 * Use when:
 * - a project executor needs task-scoped models plus the task's run event emitter
 * - custom scheduling logic wants the same context shape as `TaskRunContext`
 *
 * Expects:
 * - `models` exposes configured model registrations for plugin helpers
 * - `events` follows `TaskRunContext['events']`; forward it into `task.entry.task.run(...)` so case progress
 *   and output reach the terminal and the event log
 * - `runStorage` follows `TaskRunContext['runStorage']`; forward it too, so cases get their ids and artifacts directory
 * - `signal` follows `TaskRunContext['signal']`; forward it too, so an interrupted run aborts running cases
 * - `telemetry` follows `TaskRunContext['telemetry']`
 * - `scheduler` follows `TaskRunContext['scheduler']`; forward it too, so cases share the project and run pools
 */
export interface CliProjectExecutorContext extends TaskExecutionContext {
  events?: TaskRunContext['events']
  runStorage?: TaskRunContext['runStorage']
  scheduler?: TaskRunContext['scheduler']
  selectsCase?: TaskRunContext['selectsCase']
  signal?: TaskRunContext['signal']
  telemetry?: TaskRunContext['telemetry']
}

/**
 * Project mode config for `vieval run`.
 */
export interface CliProjectModeConfig extends CliConfigBase {
  /**
   * Projects of this workspace: inline project objects, or references to other configs whose projects the
   * workspace collects (a path or glob string, or {@link CliProjectReference}), for example `'packages/*'`.
   *
   * @default [{ name: 'default' }]
   */
  projects?: Array<CliProjectConfig | CliProjectReference | string>
  workspaces?: never
}

/**
 * A reference from a workspace to other configs whose projects it collects.
 *
 * A collected project is loaded by its own config, with that config's plugins, models, and reporters, so it runs
 * as it does alone; only what a workspace owns (env and scheduling) is added here.
 */
export interface CliProjectReference {
  /**
   * Env added for the collected projects.
   *
   * Projects of one workspace share one process, so env is process-wide: the workspace's own env, each
   * referenced config's env, and these values are merged, and a key set to two different values is an error
   * (run such projects as workspaces of a comparison instead, which gives each its own process).
   *
   * @default {}
   */
  env?: NodeJS.ProcessEnv
  /**
   * A config file, a directory holding a `vieval.config.*`, or a glob of such directories, relative to this config.
   */
  from: string
  /**
   * Scheduler settings applied to every collected project, replacing what its config declares.
   *
   * @default undefined (each project keeps its own)
   */
  scheduler?: CliProjectSchedulerConfig
}

/**
 * Scheduler settings of one project.
 */
export interface CliProjectSchedulerConfig {
  /**
   * Pools shared by the tasks and cases of this project.
   *
   * Tasks and cases also need a slot in the run-wide pools of the top-level `scheduler.concurrency` and the CLI, so a
   * project value can only lower concurrency for this project.
   *
   * @default `{ task: 1 }` when neither the top-level config nor the CLI declares `task` or `case`; otherwise `{}`
   */
  concurrency?: CliProjectConcurrencyConfig
  /**
   * Middleware wrapped around every task and case of this project, inside the top-level middleware.
   *
   * Each hook runs after the unit holds all of its slots.
   *
   * @default []
   */
  middleware?: SchedulerMiddleware[]
}

/**
 * Scheduler settings of the whole run, declared on the top-level config.
 *
 * Unlike models or reporters, these settings are not inherited by projects as defaults: they configure the run
 * scheduler, and projects configure their own scheduler below it.
 */
export interface CliSchedulerConfig {
  /**
   * Pools shared by the whole run.
   *
   * Use when:
   * - one resource bounds the run as a whole, for example "at most 7 cases in the whole run"
   *
   * Expects:
   * - each provided value to be a positive integer; projects, tasks, and case groups can only declare smaller pools
   *   for their own work, and CLI flags can only lower these values
   *
   * @default `{ project: 1 }` when neither `task` nor `case` is declared here or by the CLI; otherwise projects are bounded only by those pools
   */
  concurrency?: SchedulerConcurrencyConfig
  /**
   * Middleware wrapped around every project, task, and case of the run.
   *
   * Top-level middleware wraps project middleware. Each hook runs after the unit holds all of its slots.
   *
   * @default []
   */
  middleware?: SchedulerMiddleware[]
}

/**
 * Result of loading and normalizing a config file.
 */
export interface LoadedCliConfig {
  configFilePath: null | string
  env: NodeJS.ProcessEnv
  projects: NormalizedCliProjectConfig[]
  reporting?: CliReportingConfig
  scheduler?: CliSchedulerConfig
}

export interface LoadedRawCliConfig {
  config: CliConfig | null
  configFilePath: null | string
}

/**
 * Runtime options for config loading.
 */
export interface LoadVievalCliConfigOptions {
  /**
   * Explicit config file path.
   */
  configFilePath?: string
  /**
   * Starting directory for config lookup.
   *
   * @default process.cwd()
   */
  cwd?: string
  /**
   * Env values that win over the config's `env`. They are merged into `config.env` right after the config module
   * is evaluated, before any plugin runs, so plugins that read `config.env` (model API keys) see them.
   *
   * @default {}
   */
  envOverrides?: NodeJS.ProcessEnv
  /**
   * Config files already being loaded higher up a chain of project references, to report a cycle.
   *
   * @default empty
   */
  visitedConfigFiles?: ReadonlySet<string>
}

/**
 * Normalized CLI project used by runtime orchestration.
 */
export interface NormalizedCliProjectConfig {
  evalMatrix?: MatrixLayer
  exclude: string[]
  executor?: (task: ScheduledTask, context: CliProjectExecutorContext) => Promise<RunResult>
  include: string[]
  inferenceExecutors: InferenceExecutor[]
  models: ModelDefinition[]
  name: string
  reporters: VievalVitestCompatReporterReference[]
  root: string
  runMatrix?: MatrixLayer
  scheduler?: CliProjectSchedulerConfig
}

/**
 * Top-level CLI config loaded from `vieval.config.*`.
 */
interface CliConfigBase {
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
  /**
   * Global model definitions inherited by projects.
   *
   * @default []
   */
  models?: ModelDefinition[]
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
   * Optional reporting integrations shared by CLI run orchestration.
   *
   * @default undefined
   */
  reporting?: CliReportingConfig
  /**
   * Scheduler settings of the whole run: run-wide concurrency pools and middleware.
   *
   * @default undefined
   */
  scheduler?: CliSchedulerConfig
}

/**
 * Helper used by `vieval.config.*` for better type inference.
 */
export const defineConfig = createDefineConfig<CliConfig>()

/**
 * Detects whether a config is a comparison or a workspace.
 *
 * Returns:
 * - `comparison` when the config lists `workspaces`, `workspace` otherwise (including a config without `projects`)
 */
export function detectCliConfigMode(config: CliConfig): CliConfigMode {
  if (config.workspaces != null && config.projects != null) {
    throw new Error('Invalid vieval config: `workspaces` (a comparison) and `projects` (a workspace) are mutually exclusive.')
  }

  return config.workspaces == null ? 'workspace' : 'comparison'
}

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

    // A comparison has no plugins: its workspaces load (and run their plugins) in their own processes.
    if (detectCliConfigMode(loadedConfig.config) === 'comparison') {
      return { config: loadedConfig.config, configFilePath: loadedConfig.configFilePath }
    }

    const workspaceConfig = loadedConfig.config as CliProjectModeConfig
    const overrides = Object.keys(options.envOverrides ?? {}).length === 0 ? undefined : options.envOverrides
    const config = await applyVievalPlugins(overrides == null
      ? workspaceConfig
      : { ...workspaceConfig, env: { ...workspaceConfig.env, ...overrides } })

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
        configFilePath: null,
        env: {},
        projects: await normalizeConfig(null, [{ name: 'default' }], cwd),
        reporting: undefined,
        scheduler: undefined,
      }
    }

    if (detectCliConfigMode(loadedConfig.config) === 'comparison') {
      throw new Error('This config is a comparison (it lists workspaces); `vieval run` runs it through runComparison.')
    }
    const config = loadedConfig.config as CliProjectModeConfig
    const configDirectory = dirname(loadedConfig.configFilePath)
    const entries = config.projects ?? [{ name: 'default' }]
    const inlineProjects = entries.filter((entry): entry is CliProjectConfig => typeof entry !== 'string' && !('from' in entry))
    const references = entries.flatMap(entry => typeof entry === 'string' ? [{ from: entry }] : ('from' in entry ? [entry] : []))
    const env: NodeJS.ProcessEnv = { ...config.env }
    const projects = await normalizeConfig(config, inlineProjects, configDirectory)
    const visited = new Set([...(options.visitedConfigFiles ?? []), resolve(loadedConfig.configFilePath)])

    for (const reference of references) {
      for (const sourceConfigFilePath of await resolveProjectReference(reference.from, configDirectory)) {
        if (visited.has(sourceConfigFilePath)) {
          throw new Error(`Config "${loadedConfig.configFilePath}" collects projects from "${sourceConfigFilePath}", which already collects from it.`)
        }
        const source = await loadVievalCliConfig({ configFilePath: sourceConfigFilePath, envOverrides: options.envOverrides, visitedConfigFiles: visited })
        mergeWorkspaceEnv(env, source.env, sourceConfigFilePath)
        mergeWorkspaceEnv(env, reference.env ?? {}, `${loadedConfig.configFilePath} (from: ${reference.from})`)
        projects.push(...source.projects.map(project => reference.scheduler == null ? project : { ...project, scheduler: reference.scheduler }))
      }
    }

    const names = new Map<string, number>()
    for (const project of projects) {
      names.set(project.name, (names.get(project.name) ?? 0) + 1)
    }
    const duplicates = [...names].filter(([, count]) => count > 1).map(([name]) => name)
    if (duplicates.length > 0) {
      throw new Error(`Workspace "${loadedConfig.configFilePath}" has more than one project named ${duplicates.map(name => `"${name}"`).join(', ')}. Project names must be unique within a workspace.`)
    }

    return {
      configFilePath: loadedConfig.configFilePath,
      env: { ...env, ...options.envOverrides },
      projects,
      reporting: normalizeReportingConfig(config.reporting),
      scheduler: config.scheduler,
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
 * Tells whether the nearest (or given) config is a comparison or a workspace, without running its plugins.
 *
 * Use when:
 * - `vieval run` decides between running a comparison and running a workspace
 *
 * Returns:
 * - `workspace` also when no config file exists (the defaults are one project)
 */
export async function resolveVievalConfigMode(options: LoadVievalCliConfigOptions = {}): Promise<CliConfigMode> {
  // Importing the config here and loading it again later evaluates it once: ESM caches the module.
  const loaded = await resolveVievalConfig(options.cwd ?? process.cwd(), options.configFilePath)
  return loaded.config == null ? 'workspace' : detectCliConfigMode(loaded.config)
}

async function applyProjectPlugins(
  config: CliProjectModeConfig | null | undefined,
  project: CliProjectConfig,
  normalizedProject: NormalizedCliProjectConfig,
  cwd: string,
): Promise<NormalizedCliProjectConfig> {
  if (project.plugins == null || project.plugins.length === 0) {
    return normalizedProject
  }

  const scopedConfig = createProjectScopedConfig(config, project, normalizedProject)
  const resolvedConfig = await applyVievalPlugins(scopedConfig) as CliProjectModeConfig
  // The scoped config holds exactly the one inline project; a plugin may replace it, but not with a reference.
  const scopedProject = scopedConfig.projects?.[0] as CliProjectConfig | undefined
  if (scopedProject == null) {
    throw new Error('Project-local plugin normalization requires one scoped project.')
  }
  const resolvedProject = (resolvedConfig.projects?.[0] as CliProjectConfig | undefined) ?? scopedProject

  return normalizeProjectConfig(
    {
      ...resolvedProject,
      models: resolvedProject.models === scopedProject.models
        ? resolvedConfig.models
        : resolvedProject.models,
      reporters: resolvedProject.reporters === scopedProject.reporters
        ? resolvedConfig.reporters
        : resolvedProject.reporters,
      scheduler: resolvedProject.scheduler === scopedProject.scheduler
        ? toProjectScheduler(resolvedConfig.scheduler)
        : resolvedProject.scheduler,
    },
    cwd,
    resolvedConfig.models ?? [],
    resolvedConfig.reporters ?? [],
  )
}

async function applyVievalPlugins(config: CliProjectModeConfig): Promise<CliProjectModeConfig> {
  let currentConfig: CliProjectModeConfig = config
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
      } as CliProjectModeConfig
    }
  }

  for (const plugin of plugins) {
    await plugin.configVievalResolved?.(currentConfig)
  }

  return currentConfig
}

function assertNonAmbiguousMatrixDefinition(matrix: MatrixDefinition | MatrixLayer): void {
  const matrixKeys = Object.keys(matrix)
  const hasReservedKeys = matrixKeys.some(key => matrixLayerKeys.has(key))
  const hasAxisKeys = matrixKeys.some(key => !matrixLayerKeys.has(key))

  if (hasReservedKeys && hasAxisKeys) {
    throw new TypeError(ambiguousMatrixDefinitionErrorMessage)
  }
}

function createProjectScopedConfig(
  config: CliProjectModeConfig | null | undefined,
  project: CliProjectConfig,
  normalizedProject: NormalizedCliProjectConfig,
): CliProjectModeConfig {
  return {
    env: config?.env,
    models: normalizedProject.models,
    plugins: project.plugins,
    projects: [
      {
        evalMatrix: normalizedProject.evalMatrix,
        exclude: normalizedProject.exclude,
        executor: normalizedProject.executor,
        include: normalizedProject.include,
        inferenceExecutors: normalizedProject.inferenceExecutors,
        models: normalizedProject.models,
        name: normalizedProject.name,
        plugins: project.plugins,
        reporters: normalizedProject.reporters,
        root: normalizedProject.root,
        runMatrix: normalizedProject.runMatrix,
        scheduler: normalizedProject.scheduler,
      },
    ],
    reporters: normalizedProject.reporters,
    reporting: config?.reporting,
    // Inside a project-local plugin, the top-level `scheduler` stands for the project's own scheduler.
    scheduler: normalizedProject.scheduler,
  }
}

async function findNearestConfigFile(startDirectory: string): Promise<null | string> {
  let currentDirectory = resolve(startDirectory)

  while (true) {
    for (const fileName of supportedConfigFileNames) {
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

function isConfigFileExtensionUsingJsonParse(extension: string): boolean {
  return extension === '.json'
}

function isConfigFileExtensionUsingRequire(extension: string): boolean {
  return extension === '.cjs' || extension === '.cts'
}

function isLayerMatrixDefinition(matrix: MatrixDefinition | MatrixLayer): matrix is MatrixLayer {
  const matrixKeys = Object.keys(matrix)
  return (
    matrixKeys.length > 0
    && matrixKeys.every(key => matrixLayerKeys.has(key))
  )
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

/**
 * Merges env a referenced config or reference adds into a workspace's process-wide env.
 *
 * NOTICE:
 * Projects of one workspace run in one process and `vieval run` applies env to `process.env` for the run, so two
 * values for one key cannot both hold. Silently keeping one would run a project with another project's settings.
 */
function mergeWorkspaceEnv(target: NodeJS.ProcessEnv, added: NodeJS.ProcessEnv, source: string): void {
  for (const [key, value] of Object.entries(added)) {
    if (Object.hasOwn(target, key) && target[key] !== value) {
      throw new Error(`Env "${key}" has two values in one workspace (from ${source}). Projects of a workspace share one process; run them as workspaces of a comparison to give each its own env.`)
    }
    target[key] = value
  }
}

async function normalizeConfig(workspaceConfig: CliProjectModeConfig | null, projects: readonly CliProjectConfig[], cwd: string): Promise<NormalizedCliProjectConfig[]> {
  const inheritedModels = workspaceConfig?.models ?? []
  const inheritedReporterReferences = workspaceConfig?.reporters ?? []

  return Promise.all(projects.map(async (project) => {
    const normalizedProject = normalizeProjectConfig(
      project,
      cwd,
      inheritedModels,
      inheritedReporterReferences,
    )

    return applyProjectPlugins(
      workspaceConfig,
      project,
      normalizedProject,
      cwd,
    )
  }))
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

function normalizeProjectConfig(
  project: CliProjectConfig,
  cwd: string,
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
  return {
    evalMatrix: normalizeMatrixLayerInput(project.evalMatrix),
    exclude,
    executor: project.executor,
    include,
    inferenceExecutors,
    models,
    name: project.name,
    reporters,
    root,
    runMatrix: normalizeMatrixLayerInput(project.runMatrix),
    scheduler: project.scheduler,
  }
}

function normalizeReportingConfig(config: CliReportingConfig | undefined): CliReportingConfig | undefined {
  if (config == null) {
    return undefined
  }

  return {
    openTelemetry: config.openTelemetry == null
      ? undefined
      : {
          enabled: config.openTelemetry.enabled ?? false,
          onRunEnd: config.openTelemetry.onRunEnd,
        },
  }
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

/**
 * Resolves a project reference to config files.
 *
 * Before:
 * - `'packages/*'` (glob of directories), `'agents/legacy'` (directory), `'agents/x/vieval.config.ts'` (file)
 *
 * After:
 * - the `vieval.config.*` of each matched directory (directories without one are skipped for a glob), or the file
 */
async function resolveProjectReference(from: string, configDirectory: string): Promise<string[]> {
  const findConfigFile = async (directory: string) => {
    for (const name of supportedConfigFileNames) {
      if (await isReadableFile(join(directory, name))) {
        return join(directory, name)
      }
    }
    return undefined
  }

  if (/[*?[\]{}]/.test(from)) {
    const directories = (await glob(from, { absolute: true, cwd: configDirectory, onlyDirectories: true })).map(path => resolve(path)).sort()
    const files = await Promise.all(directories.map(findConfigFile))
    return files.filter((file): file is string => file != null)
  }

  const target = isAbsolute(from) ? from : resolve(configDirectory, from)
  if (await isReadableFile(target) && supportedConfigFileNames.some(name => target.endsWith(name))) {
    return [target]
  }
  const file = await findConfigFile(target)
  if (file == null) {
    throw new Error(`Project reference "${from}" has no vieval.config.* at ${target}.`)
  }
  return [file]
}

async function resolveVievalConfig(
  cwd: string,
  explicitConfigFilePath: string | undefined,
): Promise<{
  config: CliConfig | null
  configFilePath: null | string
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

function toProjectScheduler(
  scheduler: CliSchedulerConfig | undefined,
): CliProjectSchedulerConfig | undefined {
  if (scheduler == null) {
    return undefined
  }

  return {
    // A project cannot declare the run-wide `project` pool.
    concurrency: scheduler.concurrency == null
      ? undefined
      : {
          case: scheduler.concurrency.case,
          task: scheduler.concurrency.task,
        },
    middleware: scheduler.middleware,
  }
}
