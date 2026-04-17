import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadVievalComparisonConfig } from './comparison-config'

const temporaryDirectories: string[] = []

describe('loadVievalComparisonConfig', () => {
  afterEach(async () => {
    const { rm } = await import('node:fs/promises')
    await Promise.all(temporaryDirectories.map(async directory => rm(directory, { force: true, recursive: true })))
    temporaryDirectories.length = 0
  })

  it('loads vieval.config.ts comparison entry and discovers workspace project methods', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vieval-cmp-'))
    temporaryDirectories.push(directory)

    await mkdir(join(directory, 'eval', 'test-objects', 'mem9'), { recursive: true })
    await mkdir(join(directory, 'eval', 'test-objects', 'lobehub'), { recursive: true })
    await writeFile(join(directory, 'eval', 'test-objects', 'mem9', 'vieval.config.json'), JSON.stringify({
      projects: [{ name: 'locomo-mem9' }],
    }), 'utf-8')
    await writeFile(join(directory, 'eval', 'test-objects', 'lobehub', 'vieval.config.json'), JSON.stringify({
      projects: [{ name: 'locomo-lobehub' }],
    }), 'utf-8')

    await writeFile(join(directory, 'vieval.config.ts'), `
export default {
  comparisons: [
    {
      id: 'agent-memory',
      benchmark: {
        id: 'locomo',
        sharedCaseNamespace: 'locomo-cases-v1',
      },
      includesWorkspaces: ['eval/test-objects/*'],
    },
  ],
}
`, 'utf-8')

    const loaded = await loadVievalComparisonConfig({ comparisonId: 'agent-memory', cwd: directory })

    expect(loaded.config.benchmark.id).toBe('locomo')
    expect(loaded.config.methods).toHaveLength(2)
    expect(loaded.config.methods.map(method => method.id)).toEqual([
      'eval/test-objects/lobehub:locomo-lobehub',
      'eval/test-objects/mem9:locomo-mem9',
    ])
  })

  it('rejects duplicate comparison method ids', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vieval-cmp-'))
    temporaryDirectories.push(directory)

    await writeFile(join(directory, 'vieval.config.ts'), `
export default {
  comparisons: [
    {
      id: 'agent-memory',
      benchmark: {
        id: 'locomo',
        sharedCaseNamespace: 'locomo-cases-v1',
      },
      methods: [
        { id: 'mem9', project: 'locomo-mem9', workspace: 'eval/test-objects/mem9' },
        { id: 'mem9', project: 'locomo-lobehub', workspace: 'eval/test-objects/lobehub' },
      ],
    },
  ],
}
`, 'utf-8')

    await expect(loadVievalComparisonConfig({ comparisonId: 'agent-memory', cwd: directory })).rejects.toThrow('Duplicate comparison method id "mem9".')
  })
})
