import { setTimeout as delay } from 'node:timers/promises'

import { caseOf, describeTask, expect } from 'vieval'

import { modelOf, nextExecution } from './shared'

// `autoAttempt: 2` runs every case of the task again (up to 3 rounds) while a case still fails.
// Every execution of a case (round or retry) increments its counter, so the outcomes are deterministic.
describeTask('retries', () => {
  caseOf('stable/always-passes', async (context) => {
    const execution = nextExecution(`${context.task.id}::stable`)
    console.info(`execution ${execution}: nothing to retry`)
    await delay(150)
  }, { input: { expect: 'pass every round' } })

  caseOf('flaky/passes-in-round-2', async (context) => {
    const execution = nextExecution(`${context.task.id}::round-2`)
    await delay(200)
    if (execution === 0) {
      console.warn(`execution ${execution}: element not found, failing this round`)
      throw new Error('Flaky: element not found in round 1.')
    }
    console.info(`execution ${execution}: passed`)
  }, { input: { expect: 'fail round 1, pass round 2' } })

  caseOf('flaky/passes-in-round-3', async (context) => {
    const execution = nextExecution(`${context.task.id}::round-3`)
    await delay(250)
    if (execution < 2) {
      console.error(`execution ${execution}: timeout waiting for dialog`)
      throw new Error(`Flaky: dialog did not open (execution ${execution}).`)
    }
    console.info(`execution ${execution}: passed`)
  }, { input: { expect: 'fail rounds 1 and 2, pass round 3' } })

  // Every round: the first try fails, the immediate retry passes.
  caseOf('retry/first-try-fails-each-round', async (context) => {
    const execution = nextExecution(`${context.task.id}::retry-each-round`)
    await delay(120)
    if (execution % 2 === 0) {
      console.warn(`execution ${execution}: transient 503 from mock server, will retry`)
      throw new Error('Transient: mock server returned 503.')
    }
    console.info(`execution ${execution}: passed after retry`)
  }, { autoRetry: 2, autoRetryDelay: 100, input: { expect: 'try 1 fails, try 2 passes, in every round' } })

  // Round 1: tries 1 and 2 fail, try 3 passes.
  caseOf('retry/passes-on-third-try', async (context) => {
    const execution = nextExecution(`${context.task.id}::third-try`)
    await delay(100)
    if (execution < 2) {
      console.warn(`execution ${execution}: rate limited`)
      throw new Error(`Rate limited (execution ${execution}).`)
    }
    console.info(`execution ${execution}: passed`)
  }, { autoRetry: 2, autoRetryDelay: 150, input: { expect: 'pass on the third try of round 1' } })

  // Fails for model-b only: retries are exhausted in every round, so model rows end with different states.
  caseOf('broken/fails-for-model-b', async (context) => {
    const execution = nextExecution(`${context.task.id}::broken`)
    await delay(80)
    const model = modelOf(context)
    console.info(`execution ${execution}: model ${model}`)
    expect(model, 'model-b cannot solve this case').toBe('mock:model-a')
  }, { autoRetry: 1, autoRetryDelay: 50, input: { expect: 'model-a passes, model-b fails every try' } })
}, { autoAttempt: 2 })
