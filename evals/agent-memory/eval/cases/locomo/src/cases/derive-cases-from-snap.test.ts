import { describe, expect, it } from 'vitest'

import { DEFAULT_LOCOMO_DATA_FILE, deriveLoCoMoCases, loadLoCoMoSamplesFromSnapDataset } from './derive-cases'

describe('deriveLoCoMoCasesFromSnapDataset', () => {
  it('derives canonical cases from the first sample of snap locomo10 dataset', async () => {
    const samples = await loadLoCoMoSamplesFromSnapDataset({
      dataFile: DEFAULT_LOCOMO_DATA_FILE,
      maxSamples: 1,
    })
    const cases = deriveLoCoMoCases(samples)

    const firstCase = cases[0]
    expect(firstCase).toBeDefined()
    expect(firstCase?.caseId).toBe('conv-26::1')
    expect(firstCase?.sampleId).toBe('conv-26')
    expect(firstCase?.category).toBe(2)
    expect(firstCase?.question).toBe('When did Caroline go to the LGBTQ support group?')
    expect(firstCase?.goldAnswer).toBe('7 May 2023')
  })
})
