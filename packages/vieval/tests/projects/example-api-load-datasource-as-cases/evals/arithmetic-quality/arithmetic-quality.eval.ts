import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect } from '../../../../../src'
import { describeTask } from '../../../../../src/dsl/task'

interface ArithmeticCase {
  input: {
    a: number
    b: number
    expected: number
  }
  name: string
}

function loadArithmeticCases(): ArithmeticCase[] {
  const evalDirectory = dirname(fileURLToPath(import.meta.url))
  const caseDirectory = join(evalDirectory, 'cases')
  const caseFiles = readdirSync(caseDirectory)
    .filter(file => file.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right))

  return caseFiles.map((file) => {
    const caseFilePath = join(caseDirectory, file)
    const rawCase = readFileSync(caseFilePath, 'utf-8')
    return JSON.parse(rawCase) as ArithmeticCase
  })
}

const arithmeticCases = loadArithmeticCases()

describeTask('arithmetic-quality', ({ casesFromInputs }) => {
  casesFromInputs('arithmetic-case', arithmeticCases, ({ matrix }) => {
    const result = matrix.inputs.input.a + matrix.inputs.input.b
    expect(result).toBe(matrix.inputs.input.expected)
  })
})
