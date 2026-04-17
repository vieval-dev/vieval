import type { CliComparisonMethodConfig, CliComparisonConfig as CliComparisonUserConfig, CliConfig, CliConfigMode } from './config'

import process from 'node:process'

import { access } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { glob } from 'tinyglobby'

import { detectCliConfigMode, loadRawVievalConfig, loadVievalCliConfig } from './config'

export interface VievalComparisonMethod {
  configFilePath?: string
  id: string
  project: string
  workspace: string
}

export interface VievalComparisonConfig {
  benchmark: {
    id: string
    sharedCaseNamespace: string
  }
  methods: VievalComparisonMethod[]
}

export interface LoadVievalComparisonConfigOptions {
  comparisonId?: string
  configFilePath?: string
  cwd?: string
}

const supportedWorkspaceConfigFileNames = [
  'vieval.config.ts',
  'vieval.config.mts',
  'vieval.config.cts',
  'vieval.config.js',
  'vieval.config.mjs',
  'vieval.config.cjs',
  'vieval.config.json',
] as const

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  }
  catch {
    return false
  }
}

function normalizeGlobInput(patterns: string | string[] | undefined): string[] {
  if (patterns == null) {
    return []
  }

  return (typeof patterns === 'string' ? [patterns] : patterns)
    .map(pattern => pattern.trim())
    .filter(pattern => pattern.length > 0)
}

function normalizeMethodShape(
  method: CliComparisonMethodConfig,
  configDirectory: string,
  index: number,
): VievalComparisonMethod {
  const id = method.id.trim()
  const workspace = method.workspace.trim()
  const project = method.project.trim()
  const configFilePath = method.configFilePath?.trim()

  if (id.length === 0) {
    throw new Error(`Comparison method #${index + 1} is missing id.`)
  }
  if (workspace.length === 0) {
    throw new Error(`Comparison method "${id}" is missing workspace.`)
  }
  if (project.length === 0) {
    throw new Error(`Comparison method "${id}" is missing project.`)
  }

  const resolvedWorkspace = isAbsolute(workspace) ? workspace : resolve(configDirectory, workspace)
  const resolvedConfigFilePath = configFilePath == null || configFilePath.length === 0
    ? undefined
    : (isAbsolute(configFilePath) ? configFilePath : resolve(configDirectory, configFilePath))

  return {
    configFilePath: resolvedConfigFilePath,
    id,
    project,
    workspace: resolvedWorkspace,
  }
}

async function findWorkspaceConfigFile(workspaceDirectory: string): Promise<string | null> {
  for (const fileName of supportedWorkspaceConfigFileNames) {
    const candidate = join(workspaceDirectory, fileName)
    if (await isReadableFile(candidate)) {
      return candidate
    }
  }

  return null
}

function createDiscoveredMethodId(configDirectory: string, workspace: string, projectName: string): string {
  const relativeWorkspace = relative(configDirectory, workspace)
  const workspaceLabel = relativeWorkspace.length > 0 ? relativeWorkspace : basename(workspace)
  return `${workspaceLabel.replaceAll('\\', '/')}:${projectName}`
}

async function discoverMethodsFromWorkspaceGlobs(args: {
  comparison: CliComparisonUserConfig
  configDirectory: string
}): Promise<VievalComparisonMethod[]> {
  const includes = normalizeGlobInput(args.comparison.includesWorkspaces)
  if (includes.length === 0) {
    return []
  }

  const discoveredWorkspaceDirectories = await glob(includes, {
    absolute: true,
    cwd: args.configDirectory,
    ignore: normalizeGlobInput(args.comparison.excludesWorkspaces),
    onlyDirectories: true,
  })

  const methods: VievalComparisonMethod[] = []
  for (const workspaceDirectory of discoveredWorkspaceDirectories.sort((left, right) => left.localeCompare(right))) {
    const configFilePath = await findWorkspaceConfigFile(workspaceDirectory)
    if (configFilePath == null) {
      continue
    }

    const loadedWorkspaceConfig = await loadVievalCliConfig({
      configFilePath,
      cwd: workspaceDirectory,
    })

    for (const project of loadedWorkspaceConfig.projects) {
      methods.push({
        configFilePath,
        id: createDiscoveredMethodId(args.configDirectory, workspaceDirectory, project.name),
        project: project.name,
        workspace: workspaceDirectory,
      })
    }
  }

  return methods
}

function validateMethodIdsAreUnique(methods: readonly VievalComparisonMethod[]): void {
  const methodIds = methods.map(method => method.id)
  const duplicatedMethodId = methodIds.find((methodId, index) => methodIds.indexOf(methodId) !== index)
  if (duplicatedMethodId != null) {
    throw new Error(`Duplicate comparison method id "${duplicatedMethodId}".`)
  }
}

function assertComparisonMode(config: CliConfig): asserts config is { comparisons: CliComparisonUserConfig[] } {
  const mode = detectCliConfigMode(config) as CliConfigMode
  if (mode !== 'comparisons') {
    throw new Error(`Expected comparison-mode config, but received ${mode}-mode config.`)
  }
}

function selectComparisonConfig(
  comparisons: readonly CliComparisonUserConfig[],
  comparisonId: string | undefined,
): CliComparisonUserConfig {
  if (comparisons.length === 0) {
    throw new Error('Comparison config requires at least one comparisons entry.')
  }

  if (comparisonId == null || comparisonId.trim().length === 0) {
    if (comparisons.length > 1) {
      throw new Error(`Multiple comparisons found. Provide --comparison. Available ids: ${comparisons.map(item => item.id).join(', ')}`)
    }

    return comparisons[0]
  }

  const selected = comparisons.find(item => item.id === comparisonId)
  if (selected == null) {
    throw new Error(`Unknown comparison id "${comparisonId}".`)
  }

  return selected
}

function normalizeBenchmark(comparison: CliComparisonUserConfig): VievalComparisonConfig['benchmark'] {
  const benchmarkId = comparison.benchmark.id.trim()
  const sharedCaseNamespace = comparison.benchmark.sharedCaseNamespace.trim()

  if (benchmarkId.length === 0) {
    throw new Error('Comparison config requires benchmark.id.')
  }
  if (sharedCaseNamespace.length === 0) {
    throw new Error('Comparison config requires benchmark.sharedCaseNamespace.')
  }

  return {
    id: benchmarkId,
    sharedCaseNamespace,
  }
}

/**
 * Loads and validates comparison-mode data from `vieval.config.*`.
 */
export async function loadVievalComparisonConfig(
  options: LoadVievalComparisonConfigOptions = {},
): Promise<{ config: VievalComparisonConfig, configFilePath: string }> {
  const cwd = options.cwd ?? process.cwd()

  try {
    const loaded = await loadRawVievalConfig({
      configFilePath: options.configFilePath,
      cwd,
    })

    if (loaded.configFilePath == null || loaded.config == null) {
      throw new Error('Failed to find vieval config. Expected vieval.config.*')
    }

    assertComparisonMode(loaded.config)
    const selectedComparison = selectComparisonConfig(loaded.config.comparisons, options.comparisonId)
    const configDirectory = dirname(loaded.configFilePath)

    const explicitMethods = (selectedComparison.methods ?? []).map((method, index) =>
      normalizeMethodShape(method, configDirectory, index),
    )

    const discoveredMethods = await discoverMethodsFromWorkspaceGlobs({
      comparison: selectedComparison,
      configDirectory,
    })

    const methods = [...explicitMethods, ...discoveredMethods]
    if (methods.length === 0) {
      throw new Error('Comparison config resolved zero methods. Configure methods or includesWorkspaces.')
    }

    validateMethodIdsAreUnique(methods)

    return {
      config: {
        benchmark: normalizeBenchmark(selectedComparison),
        methods,
      },
      configFilePath: loaded.configFilePath,
    }
  }
  catch (error) {
    const errorMessage = errorMessageFrom(error) ?? 'Unknown comparison config loading error.'
    const resolvedPath = options.configFilePath ?? 'vieval.config'
    throw new Error(`Failed to load comparison config "${resolvedPath}": ${errorMessage}`)
  }
}
