import { sleep as defaultSleep, errorMessageFrom, errorNameFrom } from '@moeru/std'

/**
 * Describes how provider retries should behave.
 *
 * ASCII flow:
 * attempt -> run request -> success return
 * attempt -> run request -> retriable failure -> sleep -> next attempt
 * attempt -> run request -> non-retriable failure -> throw
 */
export interface RetryPolicy {
  /**
   * Maximum number of total attempts, including the first try.
   */
  maxAttempts: number
  /**
   * Returns the wait time for a retry attempt.
   */
  delayMs: (attempt: number) => number
  /**
   * Determines whether an error can be retried safely.
   */
  shouldRetry: (error: unknown) => boolean
  /**
   * Suspends execution between retries.
   */
  sleep: (milliseconds: number) => Promise<void>
}

/**
 * Configures a retry policy before a provider call is executed.
 *
 * Use when:
 * - you want the default retry classifier but need to tune attempts or delay
 * - you need to replace the sleeper in tests
 *
 * Expects:
 * - `maxAttempts` to be a finite integer greater than or equal to `1`
 * - `delayMs` to return a non-negative wait time in milliseconds
 */
export interface RetryPolicyOptions {
  /**
   * Maximum total attempts, including the first request.
   *
   * @default 3
   */
  maxAttempts?: number
  /**
   * Computes the delay for a retry attempt.
   *
   * The attempt number starts at `1` for the first retry.
   */
  delayMs?: (attempt: number) => number
  /**
   * Overrides the retry classifier.
   */
  shouldRetry?: (error: unknown) => boolean
  /**
   * Overrides the sleeper used between attempts.
   */
  sleep?: (milliseconds: number) => Promise<void>
}

const retryableStatusCodes = new Set([408, 425, 429, 500, 502, 503, 504])
const retryableErrorNames = new Set(['TimeoutError', 'FetchError'])
const retryableMessagePatterns = [
  /rate limit/i,
  /rate-limited/i,
  /temporarily unavailable/i,
  /service unavailable/i,
  /server error/i,
  /fetch failed/i,
  /network error/i,
  /socket hang up/i,
  /econnreset/i,
  /econnrefused/i,
  /eai_again/i,
  /etimedout/i,
  /timed out/i,
  /timeout/i,
]

function getStatusCode(error: unknown): number | undefined {
  if (error == null || typeof error !== 'object') {
    return undefined
  }

  const maybeStatusCode = (error as { statusCode?: unknown }).statusCode
  if (typeof maybeStatusCode === 'number') {
    return maybeStatusCode
  }

  const maybeStatus = (error as { status?: unknown }).status
  if (typeof maybeStatus === 'number') {
    return maybeStatus
  }

  const response = (error as { response?: unknown }).response
  if (response == null || typeof response !== 'object') {
    return undefined
  }

  const responseStatus = (response as { status?: unknown }).status
  return typeof responseStatus === 'number' ? responseStatus : undefined
}

/**
 * Returns true when a provider failure is temporary and a retry is reasonable.
 *
 * Use when:
 * - the upstream failure is a transport problem or a 5xx/429 response
 *
 * Expects:
 * - provider errors to expose a status code, name, or message when possible
 */
export function isRetriableProviderError(error: unknown): boolean {
  const statusCode = getStatusCode(error)

  if (statusCode != null) {
    return retryableStatusCodes.has(statusCode)
  }

  const errorName = errorNameFrom(error)
  if (errorName != null && retryableErrorNames.has(errorName)) {
    return true
  }

  const errorMessage = errorMessageFrom(error)
  if (errorMessage == null) {
    return false
  }

  return retryableMessagePatterns.some(pattern => pattern.test(errorMessage))
}

function defaultDelayMs(attempt: number): number {
  return 500 * 2 ** (attempt - 1)
}

/**
 * Creates a retry policy for provider work.
 *
 * Use when:
 * - you need a reusable retry runner for eval-time provider calls
 * - you want to keep retry behavior deterministic in tests
 *
 * Expects:
 * - callers to treat `maxAttempts` as total attempts, not retries
 *
 * Throws:
 * - `RangeError` when `maxAttempts` is not a finite integer greater than or equal to `1`
 */
function assertValidMaxAttempts(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new RangeError('maxAttempts must be a finite integer greater than or equal to 1.')
  }

  return value
}

export function createRetryPolicy(options: RetryPolicyOptions = {}): RetryPolicy {
  const maxAttempts = assertValidMaxAttempts(options.maxAttempts ?? 3)

  return {
    maxAttempts,
    delayMs: options.delayMs ?? defaultDelayMs,
    shouldRetry: options.shouldRetry ?? isRetriableProviderError,
    sleep: options.sleep ?? defaultSleep,
  }
}

/**
 * Runs an operation with bounded retries.
 *
 * Use when:
 * - you are calling an LLM provider or other temporary upstream dependency
 * - non-retriable failures should bubble immediately
 *
 * Expects:
 * - the operation to be idempotent across attempts
 */
export async function runWithRetry<T>(operation: () => Promise<T>, policy: RetryPolicy = createRetryPolicy()): Promise<T> {
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await operation()
    }
    catch (error) {
      if (attempt >= policy.maxAttempts || !policy.shouldRetry(error)) {
        throw error
      }

      const delayMilliseconds = policy.delayMs(attempt)
      if (delayMilliseconds > 0) {
        await policy.sleep(delayMilliseconds)
      }
    }
  }

  throw new Error('Retry loop exited without returning a value.')
}
