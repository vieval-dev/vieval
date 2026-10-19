import type { CollectedEvalEntry, EvalModule, EvalModuleMap } from '../../config'

import { basename, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Eval files in every module format that discovery includes (`cli/config.ts` default `include`). */
const evalFileSuffixPattern = /\.eval\.[cm]?[jt]s$/
const absolutePathPattern = /^(?:[A-Z]:\/|\/|\\\\)/i

/**
 * Paths that eval entry ids are made relative to.
 */
export interface RunnerRuntimeContext {
  /**
   * Absolute root of the project that owns the eval files; entry ids are relative to it.
   *
   * It is the project root, not the root of a surrounding pnpm workspace (an earlier version looked that up with
   * `@pnpm/find-workspace-dir`), so one project's task ids do not depend on where its directory sits in a monorepo
   * or a submodule, and the same tasks in two workspaces of a comparison get the same ids.
   */
  projectRootDirectory: string
}

/**
 * Converts a file path into a project-relative path when possible.
 *
 * Before: `/repo/plugins/airi-plugin-game-chess/src/agent/evals/chess-commentary.eval.ts`
 * After: `plugins/airi-plugin-game-chess/src/agent/evals/chess-commentary.eval.ts`
 *
 * Before: `D:/repo/plugins/airi-plugin-game-chess/src/agent/evals/chess-commentary.eval.ts`
 * After: `D:/repo/plugins/airi-plugin-game-chess/src/agent/evals/chess-commentary.eval.ts`
 */
export function asProjectRelativePath(filePath: string, context: RunnerRuntimeContext): string {
  const normalizedFilePath = normalizePath(filePath)
  const normalizedProjectRootDirectory = normalizePath(context.projectRootDirectory)
  const filePathWindowsDrive = normalizedFilePath.match(/^[A-Z]:\//i)?.[0]
  const projectRootWindowsDrive = normalizedProjectRootDirectory.match(/^[A-Z]:\//i)?.[0]

  if (filePathWindowsDrive != null && projectRootWindowsDrive == null) {
    return normalizedFilePath
  }

  if (
    filePathWindowsDrive != null
    && projectRootWindowsDrive != null
    && filePathWindowsDrive.toLowerCase() !== projectRootWindowsDrive.toLowerCase()
  ) {
    return normalizedFilePath
  }

  const projectRootDirectory = context.projectRootDirectory
  const relativeFilePath = normalizePath(relative(projectRootDirectory, filePath))

  if (!absolutePathPattern.test(relativeFilePath)) {
    if (relativeFilePath === '..') {
      return normalizePath(filePath)
    }

    if (!relativeFilePath.startsWith('../')) {
      return relativeFilePath
    }
  }

  return normalizePath(filePath)
}

/**
 * Collects loaded vieval modules into sorted runner entries with stable ids.
 *
 * Call stack:
 *
 * `import.meta.glob(...)`
 *   -> {@link collectEvalEntries}
 *     -> {@link createCollectedEvalEntry}
 *       -> {@link CollectedEvalEntry}[]
 *
 * Use when:
 * - the runner has already loaded candidate eval modules
 * - downstream scheduling needs stable entry ids and directory metadata
 */
export function collectEvalEntries(
  modules: EvalModuleMap,
  context: RunnerRuntimeContext,
): CollectedEvalEntry[] {
  const entries = Object.entries(modules)
    .flatMap(([moduleHref, moduleDefinition]) => {
      const entry = createCollectedEvalEntry(moduleHref, moduleDefinition, context)

      if (!entry) {
        return []
      }

      return [entry]
    })
    .sort((left, right) => left.id.localeCompare(right.id))

  // Tasks of one file are told apart by their names; two with one name would share every task id and overwrite
  // each other's cases in every report.
  for (const [index, entry] of entries.entries()) {
    if (entries[index + 1]?.id === entry.id) {
      throw new Error(`Eval file "${entry.filePath}" defines more than one task named "${entry.name}". Give each task in a file its own name.`)
    }
  }

  return entries
}

/**
 * Builds the entry of one eval definition.
 *
 * The entry name is the definition's name (the `describeTask` name), falling back to the file name. The id is the
 * file path without its `.eval.*` suffix, plus `#<name>` when the name differs from the file name, so several tasks
 * in one file get distinct ids and a task's id does not change when another task is added to its file.
 *
 * Before:
 * - `evals/speech.eval.ts` registering `speech`
 * - `evals/speech.eval.ts` registering `zh` and `en`
 *
 * After:
 * - id `evals/speech`, name `speech`
 * - ids `evals/speech#zh` and `evals/speech#en`, names `zh` and `en`
 */
function createCollectedEvalEntry(
  moduleHref: string,
  moduleDefinition: EvalModule,
  context: RunnerRuntimeContext,
): CollectedEvalEntry | null {
  const filePath = resolveModuleFilePath(moduleHref)

  if (!filePath) {
    return null
  }

  const relativeFilePath = asProjectRelativePath(filePath, context)

  if (!evalFileSuffixPattern.test(relativeFilePath)) {
    return null
  }

  const fileName = basename(relativeFilePath).replace(evalFileSuffixPattern, '')

  if (fileName.length === 0) {
    return null
  }

  const relativeDirectory = dirname(relativeFilePath)
  const directory = relativeDirectory === '.' ? '' : relativeDirectory
  const fileId = directory.length === 0 ? fileName : `${directory}/${fileName}`
  const name = moduleDefinition.default.name.length > 0 ? moduleDefinition.default.name : fileName

  return {
    ...moduleDefinition.default,
    directory,
    filePath,
    id: name === fileName ? fileId : `${fileId}#${name}`,
    name,
  }
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/')
}

function resolveModuleFilePath(moduleHref: string): null | string {
  if (!moduleHref.startsWith('file:')) {
    return null
  }

  try {
    return fileURLToPath(moduleHref)
  }
  catch {
    return null
  }
}
