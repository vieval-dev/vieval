import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

  it('uses adversarial answers for category 5 distractor options', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'locomo-adversarial-'))
    const dataFile = join(tempDir, 'locomo.json')
    await writeFile(dataFile, JSON.stringify([{
      qa: [
        {
          adversarial_answer: 'self-care is important',
          category: 5,
          evidence: ['D2:3'],
          question: 'What did Caroline realize after her charity race?',
        },
        {
          category: 5,
          evidence: ['D2:4'],
          question: 'What did Caroline supposedly forget after the race?',
        },
      ],
      sample_id: 'conv-26',
    }]))

    const samples = await loadLoCoMoSamplesFromSnapDataset({ dataFile })
    const cases = deriveLoCoMoCases(samples)
    const adversarialCase = cases[0]
    const fallbackCase = cases[1]

    expect(adversarialCase?.caseId).toBe('conv-26::1')
    expect(adversarialCase?.category).toBe(5)
    expect(adversarialCase?.question).toBe('What did Caroline realize after her charity race?')
    expect(adversarialCase?.goldAnswer).toBe('self-care is important')
    expect(fallbackCase?.caseId).toBe('conv-26::2')
    expect(fallbackCase?.category).toBe(5)
    expect(fallbackCase?.question).toBe('What did Caroline supposedly forget after the race?')
    expect(fallbackCase?.goldAnswer).toBe('Unknown')
  })
})
