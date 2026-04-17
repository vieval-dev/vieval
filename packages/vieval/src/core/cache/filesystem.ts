import type { CacheFileHandle, CacheFileOptions, CacheNamespace, TaskCacheRuntime } from './types'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Options for creating the filesystem-backed task cache runtime.
 */
export interface CreateFilesystemTaskCacheRuntimeOptions {
  /**
   * Absolute cache root directory.
   */
  cacheRootDirectory: string
  /**
   * Project identifier under one workspace cache scope.
   */
  projectName: string
  /**
   * Workspace identifier used to share cache roots across projects.
   */
  workspaceId: string
}

function sanitizePathSegment(value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) {
    return 'default'
  }

  return normalized.replace(/[^\w.-]+/g, '-')
}

function normalizeExtension(extension: string | undefined, mediaType: string | undefined): string | undefined {
  if (extension != null && extension.length > 0) {
    return extension.startsWith('.') ? extension.slice(1) : extension
  }

  if (mediaType == null || mediaType.length === 0) {
    return undefined
  }

  if (mediaType === 'application/json') {
    return 'json'
  }

  if (mediaType === 'text/plain') {
    return 'txt'
  }

  if (mediaType === 'audio/wav') {
    return 'wav'
  }

  return undefined
}

/**
 * Normalizes cache file options into deterministic relative path segments.
 *
 * Before:
 * - `{ key: ['cases', 'dataset hash', 'v1'], ext: 'json' }`
 *
 * After:
 * - `['cases', 'dataset-hash', 'v1.json']`
 */
export function normalizeCacheFilePathSegments(options: CacheFileOptions): string[] {
  const sanitizedKey = options.key.map(segment => sanitizePathSegment(segment))
  const extension = normalizeExtension(options.ext, options.mediaType)

  if (sanitizedKey.length === 0) {
    return extension == null ? ['artifact'] : [`artifact.${extension}`]
  }

  if (extension == null) {
    return sanitizedKey
  }

  const withoutTail = sanitizedKey.slice(0, Math.max(0, sanitizedKey.length - 1))
  const tail = sanitizedKey[sanitizedKey.length - 1] ?? 'artifact'
  return [...withoutTail, `${tail}.${extension}`]
}

async function writeAtomically(path: string, content: Buffer | string): Promise<void> {
  const directory = dirname(path)
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  await mkdir(directory, { recursive: true })
  await writeFile(temporaryPath, content)
  await rename(temporaryPath, path)
}

function createCacheFileHandle(path: string): CacheFileHandle {
  return {
    path,
    async exists() {
      try {
        await access(path)
        return true
      }
      catch {
        return false
      }
    },
    openReadStream() {
      return createReadStream(path)
    },
    async openWriteStream() {
      await mkdir(dirname(path), { recursive: true })
      return createWriteStream(path)
    },
    async readBuffer() {
      return await readFile(path)
    },
    async writeBuffer(value) {
      await writeAtomically(path, value)
    },
    async readText(encoding = 'utf-8') {
      return await readFile(path, encoding)
    },
    async writeText(value, encoding = 'utf-8') {
      await writeAtomically(path, Buffer.from(value, encoding))
    },
    async readJson<T>() {
      return JSON.parse(await readFile(path, 'utf-8')) as T
    },
    async writeJson(value) {
      await writeAtomically(path, `${JSON.stringify(value, null, 2)}\n`)
    },
    async loadAsCasesInput<T>() {
      return await this.readJson<T[]>()
    },
    async loadAsExpectFixture<T>() {
      return await this.readJson<T>()
    },
  }
}

function createCacheNamespace(baseDirectory: string, namespace: string): CacheNamespace {
  return {
    file(options) {
      const relativePathSegments = normalizeCacheFilePathSegments(options)
      return createCacheFileHandle(join(baseDirectory, sanitizePathSegment(namespace), ...relativePathSegments))
    },
  }
}

/**
 * Creates a deterministic filesystem-backed task cache runtime.
 *
 * Use when:
 * - eval tasks need reproducible cache paths for expensive pre-processing outputs
 * - benchmark adapters need one artifact-oriented API for text/json/binary reads and writes
 *
 * Expects:
 * - `cacheRootDirectory` to be writable by the running process
 * - `workspaceId` + `projectName` to stay stable for reproducible paths
 *
 * Returns:
 * - task cache runtime that resolves namespaced file handles under:
 *   `<cacheRootDirectory>/<workspaceId>/<projectName>/<namespace>/...`
 */
export function createFilesystemTaskCacheRuntime(
  options: CreateFilesystemTaskCacheRuntimeOptions,
): TaskCacheRuntime {
  const workspaceDirectory = sanitizePathSegment(options.workspaceId)
  const projectDirectory = sanitizePathSegment(options.projectName)
  const baseDirectory = join(options.cacheRootDirectory, workspaceDirectory, projectDirectory)

  return {
    namespace(name) {
      return createCacheNamespace(baseDirectory, name)
    },
  }
}
