import process from 'node:process'

import { appendFile } from 'node:fs/promises'

import { sleep } from '@moeru/std'

import { caseOf, describeTask } from '../../../../src'

let caseAAttemptIndex = 0
let caseBAttemptIndex = 0

async function appendLog(entry: string): Promise<void> {
  const logFilePath = process.env.VIEVAL_TEST_LOG_PATH
  if (logFilePath == null) {
    throw new Error('Missing VIEVAL_TEST_LOG_PATH.')
  }

  await appendFile(logFilePath, `${entry}\n`, 'utf-8')
}

describeTask('execution-policy-auto-attempt-fixture', () => {
  caseOf('case-a', async () => {
    const attemptIndex = caseAAttemptIndex
    caseAAttemptIndex += 1

    await appendLog(`start:case-a:${attemptIndex}`)
    await sleep(20)
    await appendLog(`end:case-a:${attemptIndex}`)
  }, {
    input: 'case-a',
  })

  caseOf('case-b', async () => {
    const attemptIndex = caseBAttemptIndex
    caseBAttemptIndex += 1

    await appendLog(`start:case-b:${attemptIndex}`)
    await sleep(5)

    if (attemptIndex === 0) {
      await appendLog(`end:case-b:${attemptIndex}:failed`)
      throw new Error('retry-on-next-attempt')
    }

    await appendLog(`end:case-b:${attemptIndex}`)
  }, {
    autoAttempt: 1,
    input: 'case-b',
  })
})
