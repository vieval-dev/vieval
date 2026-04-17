import process from 'node:process'

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { deriveLoCoMoCases, loadLoCoMoSamplesFromSnapDataset } from './derive-cases'

const SNAP_LOCOMO_DATA_URL = 'https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json'
const SNAP_LOCOMO_FIXTURE_FILE = fileURLToPath(new URL('./fixtures/locomo10-first-sample.json', import.meta.url))

async function resolveSnapLoCoMoDataFile(): Promise<string> {
  const configuredDataFile = process.env.LOCOMO_DATA_FILE
  if (configuredDataFile != null && configuredDataFile.length > 0) {
    return configuredDataFile
  }

  try {
    const response = await fetch(SNAP_LOCOMO_DATA_URL)
    if (!response.ok) {
      throw new Error(`failed to download snap LoCoMo dataset: ${response.status} ${response.statusText}`)
    }

    const content = await response.text()
    const tempDirectory = await mkdtemp(join(tmpdir(), 'locomo-snap-'))
    const dataFile = join(tempDirectory, 'locomo10.json')
    await writeFile(dataFile, content, 'utf8')
    return dataFile
  }
  catch {
    return SNAP_LOCOMO_FIXTURE_FILE
  }
}

describe('deriveLoCoMoCasesFromSnapDataset', () => {
  it('derives canonical cases from the first sample of snap locomo10 dataset', async () => {
    const dataFile = await resolveSnapLoCoMoDataFile()
    try {
      const samples = await loadLoCoMoSamplesFromSnapDataset({
        dataFile,
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
    }
    finally {
      if (dataFile.includes(`${tmpdir()}/locomo-snap-`)) {
        await rm(dirname(dataFile), { force: true, recursive: true })
      }
    }
  })
})
