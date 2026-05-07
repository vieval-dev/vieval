import type { LoCoMoAnswerGeneratorAdapter } from '../contracts.ts'

import { describe, expect, it, vi } from 'vitest'

import { createCachedLoCoMoAnswerGenerator } from './cached-answer-generator.ts'

function createMemoryCache() {
  const files = new Map<string, unknown>()

  return {
    files,
    runtime: {
      namespace(name: string) {
        return {
          file(options: { key: readonly string[] }) {
            const key = `${name}/${options.key.join('/')}`

            return {
              async exists() {
                return files.has(key)
              },
              async loadAsExpectFixture<T>() {
                return files.get(key) as T
              },
              async writeJson(value: unknown) {
                files.set(key, value)
              },
            }
          },
        }
      },
    },
  }
}

const input = {
  caseId: 'conv-26::1',
  category: 2 as const,
  contextText: 'Caroline went to the LGBTQ support group on 7 May 2023.',
  goldAnswer: '7 May 2023',
  question: 'When did Caroline go to the LGBTQ support group?',
  sampleId: 'conv-26',
}

describe('createCachedLoCoMoAnswerGenerator', () => {
  it('uses cached predictions without calling the wrapped answer generator', async () => {
    const { runtime } = createMemoryCache()
    const generator: LoCoMoAnswerGeneratorAdapter = {
      generateAnswer: vi.fn(async () => 'fresh answer'),
      id: 'generator-a',
    }
    const cached = createCachedLoCoMoAnswerGenerator({
      cache: runtime,
      generator,
      mode: 'read-write',
      namespaceParts: {
        datasetHash: 'dataset-a',
        promptVersion: 'prompt-v1',
        retrieverId: 'retriever-a',
        topK: 3,
      },
    })

    await runtime.namespace('locomo-answer-predictions').file({
      key: [
        'dataset-a',
        'prompt-v1',
        'retriever-a',
        'generator-a',
        'top-k-3',
        'conv-26--1',
        '2bd7ad9004de5e33',
      ],
    }).writeJson({
      prediction: 'cached answer',
    })

    await expect(cached.generateAnswer(input)).resolves.toBe('cached answer')
    expect(generator.generateAnswer).not.toHaveBeenCalled()
  })

  it('writes generated predictions on cache miss in read-write mode', async () => {
    const { files, runtime } = createMemoryCache()
    const generator: LoCoMoAnswerGeneratorAdapter = {
      generateAnswer: vi.fn(async () => 'fresh answer'),
      id: 'generator-a',
    }
    const cached = createCachedLoCoMoAnswerGenerator({
      cache: runtime,
      generator,
      mode: 'read-write',
      namespaceParts: {
        datasetHash: 'dataset-a',
        promptVersion: 'prompt-v1',
        retrieverId: 'retriever-a',
        topK: 3,
      },
    })

    await expect(cached.generateAnswer(input)).resolves.toBe('fresh answer')
    expect(generator.generateAnswer).toHaveBeenCalledTimes(1)
    expect([...files.values()]).toContainEqual({
      prediction: 'fresh answer',
    })
  })

  it('fails on cache miss in read-only mode', async () => {
    const { runtime } = createMemoryCache()
    const generator: LoCoMoAnswerGeneratorAdapter = {
      generateAnswer: vi.fn(async () => 'fresh answer'),
      id: 'generator-a',
    }
    const cached = createCachedLoCoMoAnswerGenerator({
      cache: runtime,
      generator,
      mode: 'read-only',
      namespaceParts: {
        datasetHash: 'dataset-a',
        promptVersion: 'prompt-v1',
        retrieverId: 'retriever-a',
        topK: 3,
      },
    })

    await expect(cached.generateAnswer(input)).rejects.toThrow('Missing cached LoCoMo answer prediction')
    expect(generator.generateAnswer).not.toHaveBeenCalled()
  })
})
