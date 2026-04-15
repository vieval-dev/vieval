import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

/**
 * Shared runtime context used by the vieval runner.
 *
 * Use when:
 * - runner services need stable path resolution without module-level side effects
 * - call sites want deterministic control over workspace root detection
 */
export interface RunnerRuntimeContext {
  /**
   * Absolute project root directory used for path normalization.
   */
  projectRootDirectory: string
}

/**
 * Options used to construct the runner runtime context.
 */
export interface CreateVievalRunnerRuntimeContextOptions {
  /**
   * Directory used to search for the nearest pnpm workspace.
   *
   * @default directory of this module file
   */
  cwd?: string
  /**
   * Absolute fallback directory when a pnpm workspace root is not found.
   *
   * @default package root directory (`packages/vieval`)
   */
  fallbackProjectRootDirectory?: string
}

/**
 * Creates a side-effect-free runtime context for runner path normalization.
 *
 * Call stack:
 *
 * {@link createRunnerRuntimeContext}
 *   -> `findWorkspaceDir(cwd)`
 *     -> `resolve projectRootDirectory`
 *       -> `{ projectRootDirectory }`
 *
 * Use when:
 * - initializing runner infrastructure before collecting eval modules
 * - tests need deterministic root resolution behavior
 */
export async function createRunnerRuntimeContext(
  options: CreateVievalRunnerRuntimeContextOptions = {},
): Promise<RunnerRuntimeContext> {
  const cwd = options.cwd ?? dirname(fileURLToPath(import.meta.url))
  const fallbackProjectRootDirectory = options.fallbackProjectRootDirectory
    ?? fileURLToPath(new URL('../../../', import.meta.url))

  // NOTICE:
  // We use dynamic `require` here because `@pnpm/find-workspace-dir` is CommonJS.
  // Keeping this load inside the factory avoids module-level initialization side effects.
  const { findWorkspaceDir } = require('@pnpm/find-workspace-dir') as {
    findWorkspaceDir: (currentWorkingDirectory: string) => Promise<string | undefined>
  }

  // NOTICE:
  // Workspace discovery is required to keep collected eval ids stable when this
  // package is moved inside different monorepo layouts.
  const workspaceDirectory = await findWorkspaceDir(cwd)

  return {
    projectRootDirectory: workspaceDirectory ?? fallbackProjectRootDirectory,
  }
}
