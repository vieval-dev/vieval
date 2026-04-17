import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createFilesystemTaskCacheRuntime, normalizeCacheFilePathSegments } from './filesystem'

describe('filesystem cache runtime', () => {
  it('writes and reads json by deterministic key path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vieval-cache-'))
    const cache = createFilesystemTaskCacheRuntime({
      cacheRootDirectory: root,
      projectName: 'project-a',
      workspaceId: 'workspace-a',
    })

    const entry = cache.namespace('locomo').file({
      ext: 'json',
      key: ['cases', 'hash-1', 'v1'],
    })

    await entry.writeJson([{ id: 'c1' }])
    const loaded = await entry.readJson<Array<{ id: string }>>()

    expect(loaded).toEqual([{ id: 'c1' }])
    expect(entry.path).toContain('workspace-a')
    expect(entry.path).toContain('project-a')
    expect(entry.path).toContain('locomo')
    expect(entry.path).toContain('v1.json')
  })

  it('uses atomic write and leaves final content readable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vieval-cache-'))
    const cache = createFilesystemTaskCacheRuntime({
      cacheRootDirectory: root,
      projectName: 'project-b',
      workspaceId: 'workspace-b',
    })

    const entry = cache.namespace('raw').file({
      ext: 'txt',
      key: ['artifact', 'sample-1'],
    })

    await entry.writeText('hello-cache')
    const content = await readFile(entry.path, 'utf-8')
    expect(content).toBe('hello-cache')
  })

  it('normalizes path segments and typed cache loaders', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vieval-cache-'))
    const cache = createFilesystemTaskCacheRuntime({
      cacheRootDirectory: root,
      projectName: 'project-c',
      workspaceId: 'workspace-c',
    })
    const normalized = normalizeCacheFilePathSegments({
      ext: 'json',
      key: ['cases', 'hash with spaces', 'v1'],
    })

    expect(normalized).toEqual(['cases', 'hash-with-spaces', 'v1.json'])

    const casesEntry = cache.namespace('locomo').file({
      key: ['fixtures', 'cases'],
      mediaType: 'application/json',
    })
    await casesEntry.writeJson([{ id: 'case-1' }])
    const cases = await casesEntry.loadAsCasesInput<{ id: string }>()
    expect(cases).toEqual([{ id: 'case-1' }])

    const fixtureEntry = cache.namespace('locomo').file({
      key: ['fixtures', 'expected'],
      mediaType: 'application/json',
    })
    await fixtureEntry.writeJson({ score: 1 })
    const fixture = await fixtureEntry.loadAsExpectFixture<{ score: number }>()
    expect(fixture).toEqual({ score: 1 })
  })
})
