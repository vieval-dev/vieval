import { appendFile, mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { cleanupTemporaryDirectories, createTemporaryDirectory } from '../../test/helpers'
import { classifyPreview, isAllowedPath, listTree, parseRange, readJsonlPage, resolveInsideRoot, serveFile } from './files'

afterEach(cleanupTemporaryDirectories)

async function createRoot() {
  const base = await createTemporaryDirectory()
  const root = join(base, 'root')
  await mkdir(join(root, 'nested'), { recursive: true })
  await writeFile(join(root, 'nested', 'a.txt'), 'hello world')
  await writeFile(join(base, 'secret.txt'), 'outside')
  await symlink(join(base, 'secret.txt'), join(root, 'escape.txt'))
  await symlink(join(root, 'nested', 'a.txt'), join(root, 'inside-link.txt'))
  return { base, root }
}

describe('resolveInsideRoot', () => {
  it('resolves files inside the root, including symlinks that stay inside', async () => {
    const { root } = await createRoot()
    expect(await resolveInsideRoot(root, 'nested/a.txt')).toMatch(/nested\/a\.txt$/)
    expect(await resolveInsideRoot(root, 'inside-link.txt')).toMatch(/nested\/a\.txt$/)
  })

  it.each([
    ['../secret.txt', 403],
    ['nested/../../secret.txt', 403],
    ['/etc/passwd', 403],
    ['C:\\Windows\\win.ini', 403],
    ['escape.txt', 403],
    ['missing.txt', 404],
    ['', 400],
    ['a\0b', 400],
  ])('rejects %j with %i', async (path, status) => {
    const { root } = await createRoot()
    await expect(resolveInsideRoot(root, path)).rejects.toMatchObject({ status })
  })
})

describe('isAllowedPath', () => {
  it('allows paths under a root and rejects symlinks pointing out of it', async () => {
    const { base, root } = await createRoot()
    expect((await isAllowedPath([root], join(root, 'nested'))).allowed).toBe(true)
    expect((await isAllowedPath([root], join(base, 'secret.txt'))).allowed).toBe(false)
    expect((await isAllowedPath([root], join(root, 'escape.txt'))).allowed).toBe(false)
    expect(await isAllowedPath([root], join(root, 'not-yet'))).toMatchObject({ allowed: true, exists: false })
  })
})

describe('parseRange', () => {
  it.each([
    ['bytes=0-3', 10, { end: 3, start: 0 }],
    ['bytes=5-', 10, { end: 9, start: 5 }],
    ['bytes=-4', 10, { end: 9, start: 6 }],
    ['bytes=8-100', 10, { end: 9, start: 8 }],
    ['bytes=0-1,4-5', 10, { end: 1, start: 0 }],
    ['bytes=10-12', 10, undefined],
    ['bytes=5-2', 10, undefined],
    ['bytes=-0', 10, undefined],
    ['items=0-1', 10, undefined],
    ['bytes=0-1', 0, undefined],
  ])('%s of %i bytes', (header, size, expected) => {
    expect(parseRange(header, size)).toEqual(expected)
  })
})

describe('serveFile', () => {
  it('serves full files, ranges, and 416 for unsatisfiable ranges', async () => {
    const { root } = await createRoot()
    const filePath = join(root, 'nested', 'a.txt')

    const full = await serveFile(new Request('http://localhost/x'), filePath)
    expect(full.status).toBe(200)
    expect(full.headers.get('accept-ranges')).toBe('bytes')
    expect(full.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await full.text()).toBe('hello world')

    const partial = await serveFile(new Request('http://localhost/x', { headers: { range: 'bytes=6-10' } }), filePath)
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 6-10/11')
    expect(partial.headers.get('content-length')).toBe('5')
    expect(await partial.text()).toBe('world')

    const invalid = await serveFile(new Request('http://localhost/x', { headers: { range: 'bytes=50-60' } }), filePath)
    expect(invalid.status).toBe(416)
    expect(invalid.headers.get('content-range')).toBe('bytes */11')
  })

  it('sandboxes HTML and SVG with a Content-Security-Policy', async () => {
    const { root } = await createRoot()
    await writeFile(join(root, 'page.html'), '<script>alert(1)</script>')
    await writeFile(join(root, 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    const html = await serveFile(new Request('http://localhost/x'), join(root, 'page.html'))
    const svg = await serveFile(new Request('http://localhost/x'), join(root, 'image.svg'))
    expect(html.headers.get('content-security-policy')).toMatch(/^sandbox;/)
    expect(svg.headers.get('content-security-policy')).toMatch(/^sandbox;/)
    expect(html.headers.get('content-type')).toBe('text/html; charset=utf-8')
  })

  it('rejects directories and missing files', async () => {
    const { root } = await createRoot()
    await expect(serveFile(new Request('http://localhost/x'), join(root, 'nested'))).rejects.toMatchObject({ status: 400 })
    await expect(serveFile(new Request('http://localhost/x'), join(root, 'nope'))).rejects.toMatchObject({ status: 404 })
  })
})

describe('readJsonlPage', () => {
  it('pages complete lines, reports a growing tail, and keeps invalid lines as raw rows', async () => {
    const directory = await createTemporaryDirectory()
    const filePath = join(directory, 'rows.jsonl')
    await writeFile(filePath, `${Array.from({ length: 25 }, (_, index) => JSON.stringify({ index })).join('\n')}\nnot json\n{"index":`)

    const first = await readJsonlPage(filePath, 0, 10)
    expect(first.totalLines).toBe(26)
    expect(first.partialTail).toBe(true)
    expect(first.rows).toHaveLength(10)
    expect(first.rows[9]).toEqual({ index: 9 })

    const last = await readJsonlPage(filePath, 20, 10)
    expect(last.rows).toHaveLength(6)
    expect(last.rows[5]).toMatchObject({ $raw: 'not json' })

    await appendFile(filePath, '99}\n')
    const grown = await readJsonlPage(filePath, 26, 10)
    expect(grown.totalLines).toBe(27)
    expect(grown.partialTail).toBe(false)
    expect(grown.rows).toEqual([{ index: 99 }])

    expect((await readJsonlPage(filePath, 100, 10)).rows).toEqual([])
  })

  // ROOT CAUSE:
  //
  // `JsonlTable` requests several pages of one file at once. Each `indexLines` call read the shared index's
  // `scannedBytes` before the other call had advanced it, so both scanned the same bytes and both pushed the same
  // line starts:
  //
  // let position = index.scannedBytes   // 0 in both calls
  // index.lineStarts.push(lineStart)    // every line twice
  //
  // We fixed this by joining concurrent index builds of one file into one in-flight scan.
  /**
   * @example
   * expect((await Promise.all([readJsonlPage(f, 0, 10), readJsonlPage(f, 10, 10)])).map(p => p.totalLines)).toEqual([30, 30])
   */
  it('counts every line once when pages of one file are read concurrently', async () => {
    const directory = await createTemporaryDirectory()
    const filePath = join(directory, 'concurrent.jsonl')
    await writeFile(filePath, `${Array.from({ length: 30 }, (_, index) => JSON.stringify({ index })).join('\n')}\n`)

    const pages = await Promise.all([readJsonlPage(filePath, 0, 10), readJsonlPage(filePath, 10, 10), readJsonlPage(filePath, 20, 10)])
    expect(pages.map(page => page.totalLines)).toEqual([30, 30, 30])
    expect(pages[2].rows).toEqual(Array.from({ length: 10 }, (_, index) => ({ index: 20 + index })))
  })

  it.each([[-1, 10], [0, 0], [0, 1001], [1.5, 10]])('rejects offset %d / limit %d', async (offset, limit) => {
    const directory = await createTemporaryDirectory()
    const filePath = join(directory, 'rows.jsonl')
    await writeFile(filePath, '{}\n')
    await expect(readJsonlPage(filePath, offset, limit)).rejects.toMatchObject({ status: 400 })
  })
})

describe('classifyPreview / listTree', () => {
  it.each([
    ['image/webp', 'a.webp', 'image'],
    ['video/mp4', 'a.mp4', 'video'],
    ['audio/wav', 'a.wav', 'audio'],
    ['application/jsonl', 'a.jsonl', 'jsonl'],
    ['application/octet-stream', 'records.jsonl', 'jsonl'],
    ['application/json', 'a.json', 'json'],
    ['application/octet-stream', 'config.yaml', 'yaml'],
    ['application/octet-stream', 'config.toml', 'toml'],
    ['text/html', 'a.html', 'html'],
    ['application/octet-stream', 'bridge.log', 'text'],
    ['application/octet-stream', 'device-profiles.lock', 'text'],
    ['application/octet-stream', 'archive.zip', 'binary'],
  ])('%s %s → %s', (contentType, name, expected) => {
    expect(classifyPreview(contentType, name)).toBe(expected)
  })

  it('lists files recursively without following symlinks', async () => {
    const { root } = await createRoot()
    const tree = await listTree(root)
    expect(tree.entries.map(entry => [entry.path, entry.kind])).toEqual([['nested', 'directory'], ['nested/a.txt', 'file']])
    expect((await listTree(root, { maxEntries: 1 })).truncated).toBe(true)
  })
})
