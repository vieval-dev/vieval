import type { Buffer } from 'node:buffer'
import type { ReadStream, WriteStream } from 'node:fs'

/**
 * Cache entry options used to derive one deterministic cache file path.
 */
export interface CacheFileOptions {
  /**
   * Optional file extension for the cache artifact (for example: `json`, `txt`, `wav`).
   */
  ext?: string
  /**
   * Deterministic key segments used to build the relative cache path.
   */
  key: readonly string[]
  /**
   * Optional media type hint used by adapters when extension is omitted.
   */
  mediaType?: string
}

/**
 * One cache file handle exposed to task code.
 *
 * Use when:
 * - benchmark setup needs deterministic artifact storage
 * - task runtime needs typed file helpers for text/json/binary payloads
 *
 * Expects:
 * - `path` to be stable for the same namespace + key
 * - read helpers to throw when the file does not exist or payload is invalid
 *
 * Returns:
 * - read/write helpers over one deterministic cache artifact path
 */
export interface CacheFileHandle {
  path: string
  exists: () => Promise<boolean>
  openReadStream: () => ReadStream
  openWriteStream: () => Promise<WriteStream>
  readBuffer: () => Promise<Buffer>
  writeBuffer: (value: Buffer) => Promise<void>
  readText: (encoding?: BufferEncoding) => Promise<string>
  writeText: (value: string, encoding?: BufferEncoding) => Promise<void>
  readJson: <T>() => Promise<T>
  writeJson: (value: unknown) => Promise<void>
  loadAsCasesInput: <T>() => Promise<T[]>
  loadAsExpectFixture: <T>() => Promise<T>
}

/**
 * Namespaced cache accessor for deterministic cache artifacts.
 */
export interface CacheNamespace {
  file: (options: CacheFileOptions) => CacheFileHandle
}

/**
 * Task-scoped cache runtime injected into `TaskRunContext`.
 */
export interface TaskCacheRuntime {
  namespace: (name: string) => CacheNamespace
}
