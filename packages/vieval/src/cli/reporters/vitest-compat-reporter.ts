import type { CliReporterCaseEndPayload, CliReporterCaseStartPayload, CliReporterTaskEndPayload, CliReporterTaskQueuedPayload, CliReporterTaskStartPayload } from './types'

import { pathToFileURL } from 'node:url'

type Awaitable<T> = T | Promise<T>

/**
 * Normalized module-like entity delivered to vitest-compatible reporter hooks.
 */
export interface VievalVitestCompatModule {
  id: string
  name: string
  projectName: string
}

/**
 * Normalized test-case-like entity delivered to vitest-compatible reporter hooks.
 */
export interface VievalVitestCompatCase {
  id: string
  name: string
  module: VievalVitestCompatModule
  state: 'failed' | 'passed' | 'pending' | 'skipped'
}

/**
 * Supported vitest-style reporter lifecycle hooks.
 *
 * Use when:
 * - external reporter modules should observe vieval task/case lifecycle events
 * - the project wants a familiar Vitest reporter callback model
 *
 * Expects:
 * - hook handlers to be best-effort observers only
 * - thrown errors are ignored to avoid interrupting eval execution
 */
export interface VievalVitestCompatReporter {
  onTestCaseReady?: (testCase: VievalVitestCompatCase) => Awaitable<void>
  onTestCaseResult?: (testCase: VievalVitestCompatCase) => Awaitable<void>
  onTestModuleCollected?: (module: VievalVitestCompatModule) => Awaitable<void>
  onTestModuleEnd?: (module: VievalVitestCompatModule) => Awaitable<void>
  onTestModuleQueued?: (module: VievalVitestCompatModule) => Awaitable<void>
  onTestModuleStart?: (module: VievalVitestCompatModule) => Awaitable<void>
  onTestRunEnd?: (modules: readonly VievalVitestCompatModule[], errors: readonly { message: string }[], state: 'failed' | 'passed') => Awaitable<void>
  onTestRunStart?: (specifications: readonly { moduleId: string, projectName: string }[]) => Awaitable<void>
}

/**
 * Supported project reporter references.
 *
 * - String: module path or package name, default export used.
 * - Reporter object: inline hook object (Vitest-style inline reporter).
 * - Tuple: [string or reporter object, constructor options].
 *
 * Source permalink:
 * `https://github.com/vitest-dev/vitest/blob/b865b4d83d1e7874607ba1b2d84b9e2d135ecd33/packages/vitest/src/node/config/resolveConfig.ts#L674-L713`
 */
export type VievalVitestCompatReporterValue = string | VievalVitestCompatReporter

export type VievalVitestCompatReporterReference
  = VievalVitestCompatReporterValue
    | readonly [VievalVitestCompatReporterValue, unknown?]

function isReporterReferenceTuple(
  reference: VievalVitestCompatReporterReference,
): reference is readonly [VievalVitestCompatReporterValue, unknown?] {
  return Array.isArray(reference)
}

function isAbsoluteLikePath(value: string): boolean {
  return value.startsWith('/')
    || value.startsWith('./')
    || value.startsWith('../')
    || /^[A-Z]:[\\/]/i.test(value)
}

async function loadReporterModule(path: string): Promise<unknown> {
  if (isAbsoluteLikePath(path)) {
    return import(pathToFileURL(path).href)
  }

  return import(path)
}

function normalizeReporterReference(reference: VievalVitestCompatReporterReference): {
  options: unknown
  value: VievalVitestCompatReporterValue
} {
  if (isReporterReferenceTuple(reference)) {
    return {
      options: reference[1],
      value: reference[0],
    }
  }

  return {
    options: undefined,
    value: reference,
  }
}

function createReporterInstance(moduleValue: unknown, options: unknown): VievalVitestCompatReporter | null {
  const candidate = moduleValue as { default?: unknown }
  const value = candidate.default ?? moduleValue

  if (value == null) {
    return null
  }

  if (typeof value === 'function') {
    const reporter = new (value as new (options?: unknown) => unknown)(options)
    return reporter as VievalVitestCompatReporter
  }

  if (typeof value === 'object') {
    return value as VievalVitestCompatReporter
  }

  return null
}

async function emitToReporters(
  reporters: readonly VievalVitestCompatReporter[],
  callback: (reporter: VievalVitestCompatReporter) => Awaitable<void> | void,
): Promise<void> {
  await Promise.all(reporters.map(async (reporter) => {
    try {
      await callback(reporter)
    }
    catch {
      // Reporter errors are intentionally swallowed to keep task execution deterministic.
    }
  }))
}

/**
 * Project-scoped bridge that adapts vieval lifecycle events to vitest-style hooks.
 */
export interface VievalVitestCompatReporterBridge {
  onCaseEnd: (payload: CliReporterCaseEndPayload) => Promise<void>
  onCaseStart: (payload: CliReporterCaseStartPayload) => Promise<void>
  onTaskEnd: (payload: CliReporterTaskEndPayload) => Promise<void>
  onTaskQueued: (payload: CliReporterTaskQueuedPayload) => Promise<void>
  onTaskStart: (payload: CliReporterTaskStartPayload) => Promise<void>
  onRunEnd: (options: { failed: boolean }) => Promise<void>
  onRunStart: () => Promise<void>
}

/**
 * Creates a project-level vitest-compatible reporter bridge.
 *
 * Use when:
 * - `vieval` should reuse vitest-like reporter callbacks without changing CLI output contracts
 *
 * Expects:
 * - references point to modules whose default export is a reporter instance or constructor
 *
 * Returns:
 * - `null` when no reporter references are configured
 */
export async function createVievalVitestCompatReporterBridge(options: {
  projectName: string
  references: readonly VievalVitestCompatReporterReference[]
}): Promise<VievalVitestCompatReporterBridge | null> {
  if (options.references.length === 0) {
    return null
  }

  const loadedReporters: VievalVitestCompatReporter[] = []

  for (const reference of options.references) {
    const normalized = normalizeReporterReference(reference)
    try {
      const moduleValue = typeof normalized.value === 'string'
        ? await loadReporterModule(normalized.value)
        : normalized.value
      const instance = createReporterInstance(moduleValue, normalized.options)
      if (instance != null) {
        loadedReporters.push(instance)
      }
    }
    catch {
      // Best effort only: invalid reporter modules should not break eval runs.
    }
  }

  if (loadedReporters.length === 0) {
    return null
  }

  const modulesByTaskId = new Map<string, VievalVitestCompatModule>()
  const casesByCompositeId = new Map<string, VievalVitestCompatCase>()

  function getOrCreateModule(taskId: string): VievalVitestCompatModule {
    const existing = modulesByTaskId.get(taskId)
    if (existing != null) {
      return existing
    }

    const created: VievalVitestCompatModule = {
      id: taskId,
      name: taskId,
      projectName: options.projectName,
    }
    modulesByTaskId.set(taskId, created)
    return created
  }

  function getOrCreateCase(taskId: string, caseId: string): VievalVitestCompatCase {
    const compositeId = `${taskId}::${caseId}`
    const existing = casesByCompositeId.get(compositeId)
    if (existing != null) {
      return existing
    }

    const created: VievalVitestCompatCase = {
      id: caseId,
      module: getOrCreateModule(taskId),
      name: caseId,
      state: 'pending',
    }
    casesByCompositeId.set(compositeId, created)
    return created
  }

  return {
    async onCaseEnd(payload) {
      const taskCase = getOrCreateCase(payload.taskId, payload.caseId)
      taskCase.state = payload.state === 'timeout' ? 'failed' : payload.state
      await emitToReporters(loadedReporters, reporter => reporter.onTestCaseResult?.(taskCase))
    },

    async onCaseStart(payload) {
      const taskCase = getOrCreateCase(payload.taskId, payload.caseId)
      await emitToReporters(loadedReporters, reporter => reporter.onTestCaseReady?.(taskCase))
    },

    async onRunEnd(run) {
      const modules = [...modulesByTaskId.values()]
      const errors = run.failed
        ? [{ message: 'vieval run failed' }]
        : []
      await emitToReporters(loadedReporters, reporter => reporter.onTestRunEnd?.(modules, errors, run.failed ? 'failed' : 'passed'))
    },

    async onRunStart() {
      const specifications = [...modulesByTaskId.values()].map(module => ({
        moduleId: module.id,
        projectName: module.projectName,
      }))
      await emitToReporters(loadedReporters, reporter => reporter.onTestRunStart?.(specifications))
    },

    async onTaskEnd(payload) {
      const module = getOrCreateModule(payload.taskId)
      if (payload.state === 'failed') {
        const syntheticCase = getOrCreateCase(payload.taskId, `${payload.taskId}:task`)
        syntheticCase.state = 'failed'
        await emitToReporters(loadedReporters, reporter => reporter.onTestCaseResult?.(syntheticCase))
      }
      await emitToReporters(loadedReporters, reporter => reporter.onTestModuleEnd?.(module))
    },

    async onTaskQueued(payload) {
      const module = getOrCreateModule(payload.taskId)
      await emitToReporters(loadedReporters, reporter => reporter.onTestModuleQueued?.(module))
      await emitToReporters(loadedReporters, reporter => reporter.onTestModuleCollected?.(module))
    },

    async onTaskStart(payload) {
      const module = getOrCreateModule(payload.taskId)
      await emitToReporters(loadedReporters, reporter => reporter.onTestModuleStart?.(module))
    },
  }
}
