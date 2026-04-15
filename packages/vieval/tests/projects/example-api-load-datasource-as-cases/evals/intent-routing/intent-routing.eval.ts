import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect } from '../../../../../src'
import { describeTask } from '../../../../../src/dsl/task'

interface IntentCase {
  input: {
    expectedIntent: 'opening' | 'recap' | 'tactics'
    message: string
  }
  name: string
}

function loadIntentCases(): IntentCase[] {
  const evalDirectory = dirname(fileURLToPath(import.meta.url))
  const caseDirectory = join(evalDirectory, 'cases')
  const caseFiles = readdirSync(caseDirectory)
    .filter(file => file.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right))

  return caseFiles.map((file) => {
    const caseFilePath = join(caseDirectory, file)
    const rawCase = readFileSync(caseFilePath, 'utf-8')
    return JSON.parse(rawCase) as IntentCase
  })
}

function classifyIntent(message: string): 'opening' | 'recap' | 'tactics' {
  const normalizedMessage = message.toLowerCase()

  if (normalizedMessage.includes('opening')) {
    return 'opening'
  }

  if (normalizedMessage.includes('summarize') || normalizedMessage.includes('recap')) {
    return 'recap'
  }

  return 'tactics'
}

const intentCases = loadIntentCases()

describeTask('intent-routing', ({ casesFromInputs }) => {
  casesFromInputs('intent-case', intentCases, ({ matrix }) => {
    expect(classifyIntent(matrix.inputs.input.message)).toBe(matrix.inputs.input.expectedIntent)
  })
})
