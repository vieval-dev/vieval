import type { CollectedEvalEntry, EvalModule, EvalModuleMap } from '../../config'
import type { RunnerRuntimeContext } from './runtime-context'

import { basename, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const evalFileSuffix = '.eval.ts'
const absolutePathPattern = /^(?:[A-Z]:\/|\/|\\\\)/i

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/')
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

function resolveModuleFilePath(moduleHref: string): string | null {
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

  if (!relativeFilePath.endsWith(evalFileSuffix)) {
    return null
  }

  const entryName = basename(relativeFilePath, evalFileSuffix)

  if (entryName.length === 0) {
    return null
  }

  const relativeDirectory = dirname(relativeFilePath)
  const directory = relativeDirectory === '.' ? '' : relativeDirectory

  return {
    ...moduleDefinition.default,
    directory,
    filePath,
    id: directory.length === 0 ? entryName : `${directory}/${entryName}`,
    name: entryName,
  }
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
  return Object.entries(modules)
    .flatMap(([moduleHref, moduleDefinition]) => {
      const entry = createCollectedEvalEntry(moduleHref, moduleDefinition, context)

      if (!entry) {
        return []
      }

      return [entry]
    })
    .sort((left, right) => left.id.localeCompare(right.id))
}
