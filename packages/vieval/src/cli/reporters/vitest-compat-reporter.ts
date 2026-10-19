import type { RunEventBus } from '../../core/runner/event-bus'

import { pathToFileURL } from 'node:url'

import { caseEnded, caseStarted, projectEnded, projectStarted, taskEnded, taskQueued, taskStarted } from '../../events'

/**
 * Normalized test-case-like entity delivered to vitest-compatible reporter hooks.
 */
export interface VievalVitestCompatCase {
  id: string
  module: VievalVitestCompatModule
  name: string
  state: 'failed' | 'passed' | 'pending' | 'skipped'
}

/**
 * Normalized module-like entity delivered to vitest-compatible reporter hooks.
 */
export interface VievalVitestCompatModule {
  id: string
  name: string
  projectName: string
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

export type VievalVitestCompatReporterReference
  = readonly [VievalVitestCompatReporterValue, unknown?]
    | VievalVitestCompatReporterValue

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

type Awaitable<T> = Promise<T> | T

/**
 * Subscribes the project's vitest-compatible reporters to the run event bus.
 *
 * Use when:
 * - `vieval` should reuse vitest-like reporter callbacks without changing CLI output contracts
 *
 * Expects:
 * - references point to modules whose default export is a reporter instance or constructor
 * - it is called before `task.queued` is emitted, so reporters see every module
 * - `project.started` / `project.ended` are awaited by the emitter, so reporter run hooks finish in order
 *
 * Returns:
 * - an unsubscribe function; a no-op when no reporter is configured or loadable
 *
 * Call stack:
 *
 * runVievalCli (../run)
 *   -> {@link subscribeVitestCompatReporters}
 *     -> project's `task.*` / `case.*` / `project.*` events
 *       -> `onTestModule*` / `onTestCase*` / `onTestRun*` hooks
 */
export async function subscribeVitestCompatReporters(options: {
  bus: RunEventBus
  projectName: string
  references: readonly VievalVitestCompatReporterReference[]
}): Promise<() => void> {
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
    return () => {}
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

  const isOwnProject = (projectId: string | undefined): boolean => projectId === options.projectName
  const emit = async (callback: (reporter: VievalVitestCompatReporter) => Awaitable<void> | void): Promise<void> => await emitToReporters(loadedReporters, callback)

  const unsubscribes = [
    options.bus.on(taskQueued, async ({ projectId, taskId }) => {
      if (!isOwnProject(projectId) || taskId == null) {
        return
      }
      const module = getOrCreateModule(taskId)
      await emit(reporter => reporter.onTestModuleQueued?.(module))
      await emit(reporter => reporter.onTestModuleCollected?.(module))
    }),
    options.bus.on(projectStarted, async ({ projectId }) => {
      if (!isOwnProject(projectId)) {
        return
      }
      const specifications = [...modulesByTaskId.values()].map(module => ({
        moduleId: module.id,
        projectName: module.projectName,
      }))
      await emit(reporter => reporter.onTestRunStart?.(specifications))
    }),
    options.bus.on(taskStarted, async ({ projectId, taskId }) => {
      if (!isOwnProject(projectId) || taskId == null) {
        return
      }
      const module = getOrCreateModule(taskId)
      await emit(reporter => reporter.onTestModuleStart?.(module))
    }),
    options.bus.on(caseStarted, async ({ caseId, projectId, taskId }) => {
      if (!isOwnProject(projectId) || taskId == null || caseId == null) {
        return
      }
      const taskCase = getOrCreateCase(taskId, caseId)
      await emit(reporter => reporter.onTestCaseReady?.(taskCase))
    }),
    options.bus.on(caseEnded, async ({ caseId, data, projectId, taskId }) => {
      if (!isOwnProject(projectId) || taskId == null || caseId == null) {
        return
      }
      const taskCase = getOrCreateCase(taskId, caseId)
      // Vitest has no state for a case without a result, so `errored` and `timeout` both report as failed.
      taskCase.state = data.state === 'timeout' || data.state === 'errored' ? 'failed' : data.state
      await emit(reporter => reporter.onTestCaseResult?.(taskCase))
    }),
    options.bus.on(taskEnded, async ({ data, projectId, taskId }) => {
      if (!isOwnProject(projectId) || taskId == null) {
        return
      }
      const module = getOrCreateModule(taskId)
      if (data.state === 'failed') {
        const syntheticCase = getOrCreateCase(taskId, `${taskId}:task`)
        syntheticCase.state = 'failed'
        await emit(reporter => reporter.onTestCaseResult?.(syntheticCase))
      }
      await emit(reporter => reporter.onTestModuleEnd?.(module))
    }),
    options.bus.on(projectEnded, async ({ data, projectId }) => {
      if (!isOwnProject(projectId)) {
        return
      }
      const modules = [...modulesByTaskId.values()]
      const errors = data.failed
        ? [{ message: 'vieval run failed' }]
        : []
      await emit(reporter => reporter.onTestRunEnd?.(modules, errors, data.failed ? 'failed' : 'passed'))
    }),
  ]

  return () => {
    for (const unsubscribe of unsubscribes) {
      unsubscribe()
    }
  }
}

function createReporterInstance(moduleValue: unknown, options: unknown): null | VievalVitestCompatReporter {
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

function isAbsoluteLikePath(value: string): boolean {
  return value.startsWith('/')
    || value.startsWith('./')
    || value.startsWith('../')
    || /^[A-Z]:[\\/]/i.test(value)
}

function isReporterReferenceTuple(
  reference: VievalVitestCompatReporterReference,
): reference is readonly [VievalVitestCompatReporterValue, unknown?] {
  return Array.isArray(reference)
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
