import { describe, expect, it, vi } from 'vitest'

import { loadOrDeriveLoCoMoCases } from './load-or-derive'

describe('loadOrDeriveLoCoMoCases', () => {
  it('reuses cached cases for same dataset hash and schema version', async () => {
    const stored: Record<string, unknown> = {}
    const derive = vi.fn(async () => [{
      caseId: 'sample::1',
      category: 1 as const,
      evidence: [],
      goldAnswer: 'answer',
      question: 'question',
      sampleId: 'sample',
    }])
    const cache = {
      namespace() {
        return {
          file({ key }: { key: string[] }) {
            const path = key.join('/')
            return {
              async exists() {
                return stored[path] != null
              },
              async loadAsCasesInput<T>() {
                return stored[path] as T[]
              },
              async writeJson(value: unknown) {
                stored[path] = value
              },
            }
          },
        }
      },
    } as any

    const first = await loadOrDeriveLoCoMoCases({
      cache,
      datasetHash: 'hash-1',
      derive,
      schemaVersion: 'v1',
    })
    const second = await loadOrDeriveLoCoMoCases({
      cache,
      datasetHash: 'hash-1',
      derive,
      schemaVersion: 'v1',
    })

    expect(first).toEqual(second)
    expect(derive).toHaveBeenCalledTimes(1)
  })
})
