import type { Dirent } from 'node:fs'

import type { FileEntry, FileTreeResponse, JsonlPage, PreviewKind } from '../shared/contract'

import { Buffer } from 'node:buffer'
import { createReadStream } from 'node:fs'
import { open, readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'

import * as v from 'valibot'

import { ViewerError } from './errors'

const CONTENT_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.flac': 'audio/flac',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.jsonl': 'application/jsonl',
  '.log': 'text/plain; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.md': 'text/markdown; charset=utf-8',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ndjson': 'application/jsonl',
  '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.ogv': 'video/ogg',
  '.opus': 'audio/opus',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.toml': 'application/toml',
  '.ts': 'text/plain; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
}

/** Most entries one directory listing returns. */
export const MAX_TREE_ENTRIES = 5000
/** Most rows one JSONL page returns. */
export const MAX_JSONL_LIMIT = 1000

interface LineIndex {
  /** Inode + birth time, to notice a replaced file. */
  identity: string
  /** Byte offset of the start of every complete line. */
  lineStarts: number[]
  /** Byte offset right after the last complete line. */
  scannedBytes: number
}

/**
 * How the viewer previews a file: content type first, file extension second.
 */
export function classifyPreview(contentType: string, name: string): PreviewKind {
  const type = contentType.split(';')[0].trim().toLowerCase()
  const extension = extname(name).toLowerCase()
  if (extension === '.jsonl' || extension === '.ndjson' || type === 'application/jsonl' || type === 'application/x-ndjson') {
    return 'jsonl'
  }
  if (type.startsWith('image/')) {
    return 'image'
  }
  if (type.startsWith('video/')) {
    return 'video'
  }
  if (type.startsWith('audio/')) {
    return 'audio'
  }
  if (type === 'application/json' || type.endsWith('+json') || extension === '.json') {
    return 'json'
  }
  if (type === 'application/yaml' || type === 'text/yaml' || extension === '.yaml' || extension === '.yml') {
    return 'yaml'
  }
  if (type === 'application/toml' || extension === '.toml') {
    return 'toml'
  }
  if (type === 'text/html' || extension === '.html' || extension === '.htm') {
    return 'html'
  }
  if (type.startsWith('text/') || ['.css', '.csv', '.js', '.lock', '.log', '.md', '.ts', '.tsv', '.txt', '.xml'].includes(extension) || type === 'application/xml') {
    return 'text'
  }
  if (type === 'application/octet-stream') {
    // Unknown types: fall back to the extension table once more.
    const byName = contentTypeFromName(name)
    return byName === 'application/octet-stream' ? 'binary' : classifyPreview(byName, name)
  }
  return 'binary'
}

/**
 * Content type from a file name, `application/octet-stream` when unknown.
 */
export function contentTypeFromName(name: string): string {
  return CONTENT_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Whether an absolute path (after symlinks) lies inside one of the roots. Missing paths are checked lexically.
 */
export async function isAllowedPath(roots: readonly string[], absolutePath: string): Promise<{ allowed: boolean, exists: boolean, realPath: string }> {
  let realPath: string
  let exists = true
  try {
    realPath = await realpath(absolutePath)
  }
  catch {
    exists = false
    realPath = await realpathOfMissing(resolve(absolutePath))
  }
  for (const root of roots) {
    let realRoot = resolve(root)
    try {
      realRoot = await realpath(root)
    }
    catch {}
    if (isInside(realRoot, realPath)) {
      return { allowed: true, exists, realPath }
    }
  }
  return { allowed: false, exists, realPath }
}

/**
 * Whether `child` is `root` or inside it (lexically).
 */
export function isInside(root: string, child: string): boolean {
  const rel = relative(root, child)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/**
 * Lists a directory recursively, relative to it.
 */
export async function listTree(directory: string, options: { maxDepth?: number, maxEntries?: number } = {}): Promise<FileTreeResponse> {
  const maxDepth = options.maxDepth ?? 8
  const maxEntries = options.maxEntries ?? MAX_TREE_ENTRIES
  const entries: FileEntry[] = []
  let truncated = false

  async function walk(current: string, depth: number): Promise<void> {
    let names: Dirent[]
    try {
      names = await readdir(current, { withFileTypes: true })
    }
    catch {
      return
    }
    names.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of names) {
      if (entries.length >= maxEntries) {
        truncated = true
        return
      }
      const absolute = join(current, entry.name)
      const path = relative(directory, absolute).split(sep).join('/')
      if (entry.isDirectory()) {
        entries.push({ contentType: 'inode/directory', kind: 'directory', path, size: 0 })
        if (depth < maxDepth) {
          await walk(absolute, depth + 1)
        }
        continue
      }
      if (!entry.isFile()) {
        // Symlinks and special files are not listed: serving them would need another root check.
        continue
      }
      const info = await stat(absolute).catch(() => undefined)
      const contentType = contentTypeFromName(entry.name)
      entries.push({
        contentType,
        kind: 'file',
        path,
        previewKind: classifyPreview(contentType, entry.name),
        size: info?.size ?? 0,
      })
    }
  }

  await walk(directory, 0)
  return { entries, truncated }
}

/**
 * Parses one JSON document (a whole file or one JSONL line) of a report or evidence file, or returns `undefined`
 * when it is not JSON or does not match `schema`. These files can be half-written or come from another version of
 * their writer; the viewer skips such content instead of failing the whole view.
 */
export function parseJsonText<TSchema extends v.GenericSchema>(schema: TSchema, text: string): undefined | v.InferOutput<TSchema> {
  let value: unknown
  try {
    value = JSON.parse(text)
  }
  catch {
    return undefined
  }
  const result = v.safeParse(schema, value)
  return result.success ? result.output : undefined
}

/**
 * Parses a single byte range. Multi-range requests are answered with the first range.
 */
export function parseRange(header: string, size: number): undefined | { end: number, start: number } {
  const match = /^bytes=(\d*)-(\d*)(?:,.*)?$/.exec(header.trim())
  if (match == null || size === 0) {
    return undefined
  }
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') {
    return undefined
  }
  if (rawStart === '') {
    // Suffix range: the last N bytes.
    const suffix = Number(rawEnd)
    if (suffix === 0) {
      return undefined
    }
    return { end: size - 1, start: Math.max(0, size - suffix) }
  }
  const start = Number(rawStart)
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (start >= size || end < start) {
    return undefined
  }
  return { end, start }
}

/**
 * Resolves a client-supplied relative path inside one root.
 *
 * Use when:
 * - serving any file named by a request (`?path=`)
 *
 * Expects:
 * - `requestedPath` relative to `root`, `/`-separated
 *
 * Returns:
 * - the real path of the file, after symlinks
 *
 * Throws:
 * - 400 for an empty path or a NUL byte
 * - 403 when the path leaves the root, lexically (`..`, absolute paths) or through a symlink
 * - 404 when the file does not exist
 */
export async function resolveInsideRoot(root: string, requestedPath: string): Promise<string> {
  if (requestedPath.length === 0) {
    throw new ViewerError(400, 'Missing "path".')
  }
  if (requestedPath.includes('\0')) {
    throw new ViewerError(400, 'Invalid "path".')
  }
  if (isAbsolute(requestedPath) || /^[a-z]:/i.test(requestedPath)) {
    throw new ViewerError(403, 'Absolute paths are not allowed.')
  }
  const lexical = resolve(root, requestedPath)
  if (!isInside(resolve(root), lexical)) {
    throw new ViewerError(403, 'Path is outside the allowed root.')
  }
  let realRoot: string
  let realTarget: string
  try {
    realRoot = await realpath(root)
  }
  catch {
    throw new ViewerError(404, 'Root does not exist.')
  }
  try {
    realTarget = await realpath(lexical)
  }
  catch {
    throw new ViewerError(404, 'File not found.')
  }
  if (!isInside(realRoot, realTarget)) {
    throw new ViewerError(403, 'Path is outside the allowed root.')
  }
  return realTarget
}

/**
 * Content security policy of the viewer's web UI: its own scripts and API only.
 *
 * NOTICE: `style-src 'unsafe-inline'` is needed because Vue binds `style` attributes (virtual list offsets, chart
 * geometry). Artifacts shown in iframes come from `/api/**` and carry their own `sandbox` policy.
 */
const CLIENT_CONTENT_SECURITY_POLICY = 'default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; media-src \'self\' blob:; frame-src \'self\'; connect-src \'self\'; object-src \'none\'; base-uri \'self\'; frame-ancestors \'none\''

/**
 * Streams one file, honoring a single `Range: bytes=` request.
 *
 * Responses always carry `X-Content-Type-Options: nosniff`. HTML and SVG get `Content-Security-Policy: sandbox`,
 * so an artifact can be shown in an iframe but never runs scripts with the viewer's origin.
 *
 * `trusted` is only for the viewer's own web UI bundle: it must run its scripts, so it gets a same-origin CSP
 * instead of `sandbox`. Report and evidence files are never trusted.
 */
export async function serveFile(request: Request, filePath: string, options: { contentType?: string, download?: boolean, trusted?: boolean } = {}): Promise<Response> {
  const info = await stat(filePath).catch(() => undefined)
  if (info == null) {
    throw new ViewerError(404, 'File not found.')
  }
  if (!info.isFile()) {
    throw new ViewerError(400, 'Not a file.')
  }
  const contentType = options.contentType ?? contentTypeFromName(filePath)
  const headers = new Headers({
    'accept-ranges': 'bytes',
    'cache-control': 'no-cache',
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
  })
  const previewKind = classifyPreview(contentType, filePath)
  if (options.trusted === true) {
    headers.set('content-security-policy', CLIENT_CONTENT_SECURITY_POLICY)
  }
  else if (previewKind === 'html' || contentType.startsWith('image/svg')) {
    headers.set('content-security-policy', 'sandbox; default-src \'none\'; img-src data: blob:; media-src data: blob:; style-src \'unsafe-inline\'')
  }
  if (options.download === true) {
    headers.set('content-disposition', `attachment; filename="${encodeURIComponent(filePath.split(sep).at(-1) ?? 'file')}"`)
  }

  const size = info.size
  const rangeHeader = request.headers.get('range')
  let start = 0
  let end = size - 1
  let status = 200
  if (rangeHeader != null) {
    const range = parseRange(rangeHeader, size)
    if (range == null) {
      headers.set('content-range', `bytes */${size}`)
      return new Response(null, { headers, status: 416 })
    }
    start = range.start
    end = range.end
    status = 206
    headers.set('content-range', `bytes ${start}-${end}/${size}`)
  }
  const length = size === 0 ? 0 : end - start + 1
  headers.set('content-length', String(length))
  if (request.method === 'HEAD' || length === 0) {
    return new Response(null, { headers, status })
  }
  const stream = createReadStream(filePath, { end, start })
  return new Response(Readable.toWeb(stream) as ReadableStream, { headers, status })
}

/**
 * Real path of a path that does not exist (yet): the real path of its deepest existing ancestor plus the rest.
 *
 * NOTICE: without this, `/var/x/missing` would not match a root resolved to `/private/var/x` on macOS.
 */
async function realpathOfMissing(path: string): Promise<string> {
  const rest: string[] = []
  let current = path
  while (true) {
    try {
      return join(await realpath(current), ...rest)
    }
    catch {
      const parent = dirname(current)
      if (parent === current) {
        return path
      }
      rest.unshift(basename(current))
      current = parent
    }
  }
}

const lineIndexes = new Map<string, LineIndex>()
/** Index builds in progress, so concurrent readers of one file join one scan instead of scanning it twice. */
const lineIndexBuilds = new Map<string, Promise<{ index: LineIndex, size: number }>>()

/**
 * Indexes complete lines of a file incrementally: a growing file is only scanned past the last indexed byte.
 *
 * Concurrent calls for one file share one scan: the index is mutable state, and two scans that start from the same
 * `scannedBytes` would push every line start twice.
 */
export async function indexLines(filePath: string): Promise<{ index: LineIndex, size: number }> {
  let build = lineIndexBuilds.get(filePath)
  if (build == null) {
    build = scanLines(filePath).finally(() => lineIndexBuilds.delete(filePath))
    lineIndexBuilds.set(filePath, build)
  }
  return build
}

/**
 * Reads a page of a JSONL file by line number.
 *
 * Only complete lines are returned, so a file that is still being written never yields half a record.
 */
export async function readJsonlPage(filePath: string, offset: number, limit: number): Promise<JsonlPage> {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ViewerError(400, '"offset" must be a non-negative integer.')
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_JSONL_LIMIT) {
    throw new ViewerError(400, `"limit" must be an integer from 1 to ${MAX_JSONL_LIMIT}.`)
  }
  const { index, size } = await indexLines(filePath)
  const totalLines = index.lineStarts.length
  const rows: unknown[] = []
  if (offset < totalLines) {
    const last = Math.min(totalLines, offset + limit)
    const from = index.lineStarts[offset]
    const to = last < totalLines ? index.lineStarts[last] : index.scannedBytes
    const handle = await open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(to - from)
      await handle.read(buffer, 0, buffer.length, from)
      for (const line of buffer.toString('utf-8').split('\n')) {
        if (line.trim().length === 0) {
          continue
        }
        try {
          rows.push(JSON.parse(line))
        }
        catch (error) {
          rows.push({ $error: (error as Error).message, $raw: line })
        }
      }
    }
    finally {
      await handle.close()
    }
  }
  return { limit, offset, partialTail: size > index.scannedBytes, rows, totalLines }
}

async function scanLines(filePath: string): Promise<{ index: LineIndex, size: number }> {
  const info = await stat(filePath)
  const identity = `${info.ino}:${info.birthtimeMs}`
  let index = lineIndexes.get(filePath)
  if (index == null || index.identity !== identity || info.size < index.scannedBytes) {
    index = { identity, lineStarts: [], scannedBytes: 0 }
    lineIndexes.set(filePath, index)
  }
  if (info.size > index.scannedBytes) {
    const handle = await open(filePath, 'r')
    try {
      const chunkSize = 1 << 20
      const buffer = Buffer.allocUnsafe(chunkSize)
      let position = index.scannedBytes
      let lineStart = index.scannedBytes
      while (position < info.size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(chunkSize, info.size - position), position)
        if (bytesRead === 0) {
          break
        }
        for (let offset = 0; offset < bytesRead; offset += 1) {
          if (buffer[offset] === 0x0A) {
            const lineEnd = position + offset + 1
            index.lineStarts.push(lineStart)
            lineStart = lineEnd
            index.scannedBytes = lineEnd
          }
        }
        position += bytesRead
      }
    }
    finally {
      await handle.close()
    }
  }
  return { index, size: info.size }
}
