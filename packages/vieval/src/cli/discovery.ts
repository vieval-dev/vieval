import { uniq } from 'es-toolkit'
import { glob } from 'tinyglobby'

/**
 * Options for eval file discovery.
 */
export interface DiscoverEvalFilesOptions {
  /**
   * Base directory scanned recursively.
   */
  root: string
  /**
   * Include glob patterns matched against relative paths.
   */
  include: readonly string[]
  /**
   * Exclude glob patterns matched against relative paths.
   */
  exclude: readonly string[]
}

/**
 * Discovers eval files using include/exclude globs relative to project root.
 *
 * Before:
 * - Absolute path file list from recursive filesystem walk
 *
 * After:
 * - Filtered absolute path list matching include/exclude rules
 */
export async function discoverEvalFiles(options: DiscoverEvalFilesOptions): Promise<string[]> {
  const discoveredFilePaths = await glob([...options.include], {
    absolute: true,
    cwd: options.root,
    ignore: [...options.exclude],
    onlyFiles: true,
  })

  return uniq(discoveredFilePaths).sort((left, right) => left.localeCompare(right))
}
