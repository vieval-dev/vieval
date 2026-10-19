import { describe, expect, it, vi } from 'vitest'

import { createRetryPolicy, isRetriableProviderError, readRetryAfter, runWithRetry } from './retry-policy'

type RetryableError = Error & {
  response?: { status?: number }
  status?: number
  statusCode?: number
}

function createResponseStatusError(statusCode: number, message: string): RetryableError {
  const error = new Error(message) as RetryableError
  error.name = 'APICallError'
  error.response = { status: statusCode }
  return error
}

function createRetryableError(statusCode: number, message: string): RetryableError {
  const error = new Error(message) as RetryableError
  error.name = 'APICallError'
  error.statusCode = statusCode
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
      shouldRetry: () => false,
      sleep,
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
    expect(sleep).toHaveBeenCalledWith(10, undefined)
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

  /**
   * @example
   * runWithRetry(op, policy, { signal }) rejects with the abort reason while it waits.
   */
  it('stops waiting and does not retry once the signal aborts', async () => {
    const controller = new AbortController()
    // The abort lands after the 60s wait has started, so only an abortable sleep settles this test in time.
    const policy = createRetryPolicy({
      delayMs: () => 60_000,
      maxAttempts: 3,
      onRetry: () => setTimeout(() => controller.abort(new Error('run interrupted')), 0),
    })
    let attempts = 0

    await expect(runWithRetry(async () => {
      attempts += 1
      throw createRetryableError(429, 'rate limited')
    }, policy, { signal: controller.signal })).rejects.toThrow('run interrupted')
    expect(attempts).toBe(1)
  })

  /**
   * @example
   * an operation that fails because the signal aborted is not retried.
   */
  it('does not retry a failure raised after the signal aborted', async () => {
    const controller = new AbortController()
    const sleep = vi.fn(async () => undefined)
    let attempts = 0

    await expect(runWithRetry(async () => {
      attempts += 1
      controller.abort()
      throw createRetryableError(503, 'aborted mid request')
    }, createRetryPolicy({ maxAttempts: 3, sleep }), { signal: controller.signal })).rejects.toThrow('aborted mid request')

    expect(attempts).toBe(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  /**
   * @example
   * onRetry receives { attempt: 1, delayMs: 25, error } before the wait.
   */
  it('reports each retry with its delay and error', async () => {
    const retries: unknown[] = []
    const failure = createRetryableError(503, 'unavailable')
    let attempts = 0

    await runWithRetry(async () => {
      attempts += 1
      if (attempts === 1) {
        throw failure
      }
      return 'ok'
    }, createRetryPolicy({
      delayMs: () => 25,
      onRetry: retry => retries.push(retry),
      sleep: async () => undefined,
    }))

    expect(retries).toEqual([{ attempt: 1, delayMs: 25, error: failure }])
  })

  /**
   * @example
   * a 429 with `retry-after: 7` waits 7000ms instead of the 500ms backoff.
   */
  it('waits for the provider retry-after by default, capped at maxDelayMs', async () => {
    const sleepDurations: number[] = []
    const rateLimited = (retryAfter: string) => Object.assign(createRetryableError(429, 'rate limited'), { responseHeaders: { 'retry-after': retryAfter } })
    let attempts = 0

    await runWithRetry(async () => {
      attempts += 1
      if (attempts === 1) {
        throw rateLimited('7')
      }
      if (attempts === 2) {
        throw rateLimited('3600')
      }
      return 'ok'
    }, createRetryPolicy({
      maxAttempts: 3,
      maxDelayMs: 30_000,
      sleep: async (milliseconds) => {
        sleepDurations.push(milliseconds)
      },
    }))

    expect(sleepDurations).toEqual([7000, 30_000])
  })

  /**
   * @example
   * default backoff for retry 2 lies in [1000, 1250).
   */
  it('adds up to a quarter of jitter to the default backoff', async () => {
    const sleepDurations: number[] = []
    let attempts = 0

    await runWithRetry(async () => {
      attempts += 1
      if (attempts < 3) {
        throw createRetryableError(503, 'unavailable')
      }
      return 'ok'
    }, createRetryPolicy({
      sleep: async (milliseconds) => {
        sleepDurations.push(milliseconds)
      },
    }))

    expect(sleepDurations[0]).toBeGreaterThanOrEqual(500)
    expect(sleepDurations[0]).toBeLessThan(625)
    expect(sleepDurations[1]).toBeGreaterThanOrEqual(1000)
    expect(sleepDurations[1]).toBeLessThan(1250)
  })

  /**
   * @example
   * readRetryAfter({ responseHeaders: { 'retry-after': '7' } }) -> 7000.
   */
  it('reads retry-after from header seconds, milliseconds, and HTTP dates', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-10-21T07:27:50Z'))

    try {
      expect(readRetryAfter({ responseHeaders: { 'retry-after': '7' } })).toBe(7000)
      expect(readRetryAfter({ response: { headers: new Headers({ 'retry-after-ms': '1500' }) } })).toBe(1500)
      expect(readRetryAfter({ headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' } })).toBe(10_000)
      expect(readRetryAfter({ responseHeaders: { 'retry-after': 'soon' } })).toBeUndefined()
      expect(readRetryAfter(new Error('no headers'))).toBeUndefined()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('fails fast for invalid maxAttempts values', () => {
    expect(() => createRetryPolicy({ maxAttempts: 0 })).toThrow(RangeError)
    expect(() => createRetryPolicy({ maxAttempts: -1 })).toThrow(RangeError)
    expect(() => createRetryPolicy({ maxAttempts: 1.5 })).toThrow(RangeError)
    expect(() => createRetryPolicy({ maxAttempts: Number.NaN })).toThrow(RangeError)
    expect(() => createRetryPolicy({ maxAttempts: Number.POSITIVE_INFINITY })).toThrow(RangeError)
  })
})
