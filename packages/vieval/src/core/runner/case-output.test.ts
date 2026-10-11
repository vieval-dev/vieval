import type { CaseOutputStream } from './case-output'

import process from 'node:process'

import { setTimeout as delay } from 'node:timers/promises'

import { describe, expect, it } from 'vitest'

import { createProcessOutputInterceptor, runWithCaseOutput } from './case-output'

interface CapturedChunk {
  content: string
  owner: string
  stream: CaseOutputStream
}

/**
 * @example
 * describe('createProcessOutputInterceptor', () => {})
 */
describe('createProcessOutputInterceptor', () => {
  /**
   * @example
   * it('attributes interleaved writes of concurrent scopes to their own sink', async () => {})
   */
  it('attributes interleaved writes of concurrent scopes to their own sink', async () => {
    const chunks: CapturedChunk[] = []
    const interception = createProcessOutputInterceptor()
    interception.start((stream, content) => chunks.push({ content, owner: 'unscoped', stream }))

    try {
      await Promise.all(['alpha', 'beta'].map(async owner => await runWithCaseOutput(
        (stream, content) => chunks.push({ content, owner, stream }),
        async () => {
          process.stdout.write(`${owner} 1\n`)
          await delay(10)
          process.stderr.write(`${owner} 2\n`)
        },
      )))
      process.stdout.write('outside\n')
    }
    finally {
      interception.restore()
    }

    /**
     * @example
     * expect(chunks.filter(chunk => chunk.owner === 'alpha')).toEqual([...])
     */
    expect(chunks.filter(chunk => chunk.owner === 'alpha')).toEqual([
      { content: 'alpha 1\n', owner: 'alpha', stream: 'stdout' },
      { content: 'alpha 2\n', owner: 'alpha', stream: 'stderr' },
    ])
    expect(chunks.filter(chunk => chunk.owner === 'beta')).toEqual([
      { content: 'beta 1\n', owner: 'beta', stream: 'stdout' },
      { content: 'beta 2\n', owner: 'beta', stream: 'stderr' },
    ])
    /**
     * @example
     * expect(chunks.at(-1)).toEqual({ content: 'outside\n', owner: 'unscoped', stream: 'stdout' })
     */
    expect(chunks.at(-1)).toEqual({ content: 'outside\n', owner: 'unscoped', stream: 'stdout' })
  })

  /**
   * @example
   * it('decodes buffer chunks and still invokes the write callback', async () => {})
   */
  it('decodes buffer chunks and still invokes the write callback', async () => {
    const contents: string[] = []
    const interception = createProcessOutputInterceptor()
    interception.start((_stream, content) => contents.push(content))

    try {
      await new Promise<void>((resolve) => {
        process.stdout.write(new TextEncoder().encode('bytes\n'), () => resolve())
      })
    }
    finally {
      interception.restore()
    }

    /**
     * @example
     * expect(contents).toEqual(['bytes\n'])
     */
    expect(contents).toEqual(['bytes\n'])
  })

  /**
   * @example
   * it('restores the original stream writers', () => {})
   */
  it('restores the original stream writers', () => {
    const originalStdoutWrite = process.stdout.write
    const originalStderrWrite = process.stderr.write
    const interception = createProcessOutputInterceptor()
    interception.start(() => {})

    interception.restore()
    interception.restore()

    /**
     * @example
     * expect(process.stdout.write).toBe(originalStdoutWrite)
     */
    expect(process.stdout.write).toBe(originalStdoutWrite)
    expect(process.stderr.write).toBe(originalStderrWrite)
  })
})
