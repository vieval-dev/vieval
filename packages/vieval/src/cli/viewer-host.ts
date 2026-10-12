import type { RunEventBus, RunEventIdentity } from '../core/runner/event-bus'

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { errorMessageFrom } from '@moeru/std'

/**
 * Package that implements the web viewer. It is optional: `vieval` never imports it unless asked to.
 */
export const VIEWER_PACKAGE_NAME = '@vieval/ui'

/**
 * Default viewer port of `vieval run --with-viewer` and `vieval viewer`, the same as `vitest --ui`.
 */
export const DEFAULT_VIEWER_PORT = 51204

/**
 * Default viewer interface. Loopback only, because the viewer API has no authentication.
 */
export const DEFAULT_VIEWER_HOST = '127.0.0.1'

/**
 * What an external host receives once a run's event bus exists, before the first event is emitted.
 */
export interface RunReadyContext {
  /**
   * Directory that holds case artifacts (`artifact.recorded` paths are relative to it).
   *
   * With reports disabled this is a temporary directory removed when the run ends.
   */
  artifactsRoot: string
  /**
   * Bus of the run. Subscribe with `onAny` to receive every event, starting from `seq` 1.
   */
  bus: RunEventBus
  /**
   * Config file of the run, or `null` when the run uses defaults.
   */
  configFilePath: null | string
  /**
   * Run identity stamped on every event and used as report path segments.
   */
  identity: RunEventIdentity
  /**
   * Names of the projects selected for the run.
   */
  projectNames: string[]
  /**
   * Directory of this run's report (`events.jsonl`, summaries), or `null` with reports disabled.
   */
  reportDirectory: null | string
  /**
   * Report root that holds this and earlier runs, or `null` with reports disabled.
   */
  reportRoot: null | string
}

/**
 * Cleanup returned by an `onRunReady` hook. Called once the run settled and its event log is closed.
 */
export type RunReadyDisposer = () => Promise<void> | void

/**
 * Hook that attaches an external host (for example the web viewer) to a run.
 *
 * Errors thrown by the hook or its disposer are reported on stderr and never fail the run.
 */
export type RunReadyHook = (context: RunReadyContext) => Promise<RunReadyDisposer | void> | RunReadyDisposer | void

/**
 * Options passed to {@link ViewerModule.startViewer}.
 */
export interface StartViewerOptions {
  /**
   * Extra directories that evidence links (for example `*.evidence` metrics) may point into, besides the parent
   * of every report root.
   */
  evidenceRoots?: string[]
  /**
   * Interface to listen on.
   *
   * @default '127.0.0.1'
   */
  host: string
  /**
   * `live`: runs are attached in-process through {@link ViewerHost.attachRun}.
   * `static`: only report directories are read.
   */
  mode: 'live' | 'static'
  /**
   * Opens the viewer URL in a browser once it listens.
   */
  open: boolean
  /**
   * Port to listen on.
   *
   * @default 51204
   */
  port: number
  /**
   * Report roots to scan for earlier runs.
   */
  reportRoots: string[]
  /**
   * Age of the last event after which a run without an end event is shown as stale.
   */
  staleAfterMs?: number
}

/**
 * Running viewer server.
 */
export interface ViewerHost {
  /**
   * Attaches one in-process run. The returned disposer runs when the run settled.
   */
  attachRun: RunReadyHook
  /**
   * Stops the server; resolves {@link ViewerHost.waitUntilClosed}.
   */
  close: () => Promise<void>
  /**
   * URL the viewer listens on.
   */
  url: string
  /**
   * Resolves once the server stopped.
   */
  waitUntilClosed: () => Promise<void>
}

/**
 * Module shape `@vieval/ui` must export.
 */
export interface ViewerModule {
  startViewer: (options: StartViewerOptions) => Promise<ViewerHost>
}

/**
 * Loads the optional viewer package.
 *
 * Use when:
 * - `vieval run --with-viewer` (or another opt-in entry) needs the viewer; nothing else may call this, so runs
 *   without the flag never load viewer code
 *
 * Expects:
 * - `baseDirectory` is where the user's project resolves packages (the config directory or the cwd)
 * - `packageName` only differs from {@link VIEWER_PACKAGE_NAME} in tests that simulate a missing package
 *
 * Returns:
 * - the viewer module, resolved from `baseDirectory` first and from the `vieval` installation second
 *
 * Throws:
 * - when the package is not installed or does not export `startViewer`
 */
export async function importViewer(baseDirectory: string, packageName: string = VIEWER_PACKAGE_NAME): Promise<ViewerModule> {
  const loaded = await importFromProject(baseDirectory, packageName) ?? await importFromVieval(packageName)
  if (loaded == null) {
    throw new Error(`--with-viewer requires the "${packageName}" package. Install it next to your vieval config, for example: pnpm add -D ${packageName}`)
  }

  if (!isViewerModule(loaded)) {
    throw new Error(`"${packageName}" does not export a startViewer(options) function.`)
  }

  return loaded
}

async function importFromProject(baseDirectory: string, packageName: string): Promise<undefined | unknown> {
  let resolvedPath: string
  try {
    // NOTICE: `createRequire(...).resolve` walks `node_modules` from the user's project, which `import()` from
    // inside the `vieval` package cannot do when vieval is installed elsewhere (global, pnpm store, workspace).
    resolvedPath = createRequire(join(baseDirectory, 'noop.js')).resolve(packageName)
  }
  catch {
    return undefined
  }

  return await import(pathToFileURL(resolvedPath).href)
}

async function importFromVieval(packageName: string): Promise<undefined | unknown> {
  // A variable specifier keeps bundlers from resolving or inlining the optional package.
  const specifier: string = packageName
  try {
    return await import(specifier)
  }
  catch (error) {
    if (isModuleNotFound(error)) {
      return undefined
    }

    throw new Error(`Failed to load "${packageName}": ${errorMessageFrom(error) ?? 'unknown error'}`)
  }
}

function isModuleNotFound(error: unknown): boolean {
  const code = (error as null | { code?: unknown })?.code
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND'
}

function isViewerModule(value: unknown): value is ViewerModule {
  return typeof (value as null | { startViewer?: unknown })?.startViewer === 'function'
}
