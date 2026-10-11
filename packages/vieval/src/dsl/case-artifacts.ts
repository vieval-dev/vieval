import type { ArtifactRecordedData } from '../events'

import { mkdirSync, mkdtempSync } from 'node:fs'
import { copyFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

/**
 * Artifact storage of one case.
 */
export interface CaseArtifacts {
  /**
   * Absolute case artifacts directory; created when read.
   */
  readonly directory: string
  /**
   * Stores or references one artifact and describes it.
   */
  record: (name: string, options: RecordArtifactOptions) => Promise<ArtifactRecordedData>
}

/**
 * Options for recording one case artifact.
 */
export interface RecordArtifactOptions {
  /**
   * Content to write into the case artifacts directory as `<name>`.
   *
   * Exactly one of `body` or `path` is required.
   */
  body?: string | Uint8Array
  /**
   * MIME type of the artifact, for example `image/webp` or `application/json`.
   */
  contentType: string
  /**
   * Existing file to record. A file inside the case artifacts directory is recorded by reference;
   * a file outside it is copied in as `<name>`, so the report directory stays self-contained.
   *
   * Exactly one of `body` or `path` is required.
   */
  path?: string
  /**
   * Producer-defined role of the artifact, for example `auv.driver.display_capture`.
   */
  purpose?: string
}

/**
 * Root used when a task runs outside `vieval run`, created once per process on first use.
 */
let localArtifactsRoot: string | undefined

/**
 * Creates the artifact storage of one case.
 *
 * Use when:
 * - the DSL builds the context of one case execution
 *
 * Expects:
 * - `artifactsRoot` is the run's artifacts root, or `undefined` outside `vieval run`
 *
 * Returns:
 * - storage rooted at `<artifactsRoot>/<taskId>/<caseId>/`, with ids normalized into safe path segments
 */
export function createCaseArtifacts(artifactsRoot: string | undefined, taskId: string, caseId: string): CaseArtifacts {
  // Outside `vieval run` nobody owns a report directory, so artifacts go to a temporary root.
  const root = () => artifactsRoot ?? (localArtifactsRoot ??= mkdtempSync(join(tmpdir(), 'vieval-artifacts-')))
  const resolveDirectory = (): string => {
    const directory = join(root(), normalizePathSegment(taskId), normalizePathSegment(caseId))
    mkdirSync(directory, { recursive: true })
    return directory
  }

  return {
    get directory() {
      return resolveDirectory()
    },
    async record(name, options) {
      if ((options.body == null) === (options.path == null)) {
        throw new TypeError(`recordArtifact("${name}") needs exactly one of \`body\` or \`path\`.`)
      }

      const directory = resolveDirectory()
      const target = join(directory, normalizePathSegment(name))
      let filePath = target

      if (options.body != null) {
        await writeFile(target, options.body)
      }
      else if (options.path != null) {
        const source = resolve(options.path)
        const relativeToDirectory = relative(directory, source)
        const isInsideDirectory = relativeToDirectory.length > 0 && !relativeToDirectory.startsWith('..') && !isAbsolute(relativeToDirectory)

        if (isInsideDirectory) {
          filePath = source
        }
        else {
          await copyFile(source, target)
        }
      }

      return {
        contentType: options.contentType,
        name,
        path: relative(root(), filePath).split('\\').join('/'),
        ...(options.purpose == null ? {} : { purpose: options.purpose }),
        size: (await stat(filePath)).size,
      }
    },
  }
}

/**
 * Normalizes an id or artifact name into one safe path segment.
 *
 * Before:
 * - "0:chrome%2Fopen-settings"
 * - "examples%2Fepisodes::default::run=repeat%3D1"
 * - ".."
 *
 * After:
 * - "0-chrome-2Fopen-settings"
 * - "examples-2Fepisodes-default-run-repeat-3D1"
 * - "-"
 */
function normalizePathSegment(value: string): string {
  const segment = value.replace(/[^\w.-]+/g, '-')
  // `.` and `..` would point at the current or parent directory.
  return /^\.*$/.test(segment) ? '-' : segment
}
