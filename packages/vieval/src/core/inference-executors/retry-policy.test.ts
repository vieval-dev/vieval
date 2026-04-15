import { describe, expect, it, vi } from 'vitest'

import { createRetryPolicy, isRetriableProviderError, runWithRetry } from './retry-policy'

type RetryableError = Error & {
  response?: { status?: number }
  status?: number
  statusCode?: number
}

function createRetryableError(statusCode: number, message: string): RetryableError {
  const error = new Error(message) as RetryableError
  error.name = 'APICallError'
  error.statusCode = statusCode
  return error
}

function createResponseStatusError(statusCode: number, message: string): RetryableError {
  const error = new Error(message) as RetryableError
  error.name = 'APICallError'
  error.response = { status: statusCode }
  return error
}

function createStatusError(statusCode: number, message: string): RetryableError {
  const error = new Error(message) as RetryableError
  error.name = 'APICallError'
  error.status = statusCode
  return error
}

describe('retry policy', () => {
  it('retries retriable failures until the operation succeeds', async () => {
    const sleepDurations: number[] = []
    const policy = createRetryPolicy({
      delayMs: attempt => attempt * 10,
      maxAttempts: 3,
      sleep: async (milliseconds) => {
        sleepDurations.push(milliseconds)
      },
    })

    let attempts = 0
    const result = await runWithRetry(async () => {
      attempts += 1

      if (attempts < 3) {
        throw createRetryableError(503, 'upstream returned 503')
      }

      return 'ok'
    }, policy)

    expect(result).toBe('ok')
    expect(attempts).toBe(3)
    expect(sleepDurations).toEqual([10, 20])
  })

  it('throws immediately for non-retriable failures', async () => {
    const sleep = vi.fn(async () => undefined)
    const policy = createRetryPolicy({
      delayMs: () => 10,
      maxAttempts: 3,
      sleep,
      shouldRetry: () => false,
    })

    let attempts = 0

    await expect(runWithRetry(async () => {
      attempts += 1
      throw new Error('bad request')
    }, policy)).rejects.toThrow('bad request')

    expect(attempts).toBe(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('throws the terminal failure after the last retry attempt', async () => {
    const sleep = vi.fn(async () => undefined)
    const policy = createRetryPolicy({
      delayMs: () => 10,
      maxAttempts: 2,
      sleep,
    })

    let attempts = 0

    await expect(runWithRetry(async () => {
      attempts += 1
      throw createRetryableError(503, 'upstream still unavailable')
    }, policy)).rejects.toThrow('upstream still unavailable')

    expect(attempts).toBe(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(10)
  })

  it('classifies response status and status code based provider errors as retriable or not', () => {
    expect(isRetriableProviderError(createResponseStatusError(429, 'response status limited'))).toBe(true)
    expect(isRetriableProviderError(createStatusError(503, 'status limited'))).toBe(true)
    expect(isRetriableProviderError(createResponseStatusError(400, 'response status bad request'))).toBe(false)
    expect(isRetriableProviderError(createStatusError(404, 'status not found'))).toBe(false)
  })

  it('classifies message and name based provider errors as retriable', () => {
    expect(isRetriableProviderError(new Error('request timed out while waiting for upstream'))).toBe(true)

    const timeoutError = new Error('socket stalled')
    timeoutError.name = 'TimeoutError'
    expect(isRetriableProviderError(timeoutError)).toBe(true)
  })

  it('skips sleeping when the retry delay is not positive', async () => {
    const sleep = vi.fn(async () => undefined)
    const policy = createRetryPolicy({
      delayMs: attempt => (attempt === 1 ? 0 : -10),
      maxAttempts: 3,
      sleep,
    })

    let attempts = 0

    await expect(runWithRetry(async () => {
      attempts += 1
      if (attempts < 3) {
        throw createRetryableError(503, 'still unavailable')
      }

      return 'done'
    }, policy)).resolves.toBe('done')

    expect(attempts).toBe(3)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('fails fast for invalid maxAttempts values', () => {
    expect(() => createRetryPolicy({ maxAttempts: 0 })).toThrow(RangeError)
    expect(() => createRetryPolicy({ maxAttempts: -1 })).toThrow(RangeError)
    expect(() => createRetryPolicy({ maxAttempts: 1.5 })).toThrow(RangeError)
    expect(() => createRetryPolicy({ maxAttempts: Number.NaN })).toThrow(RangeError)
    expect(() => createRetryPolicy({ maxAttempts: Number.POSITIVE_INFINITY })).toThrow(RangeError)
  })
})
