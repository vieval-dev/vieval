import { errorMessageFrom, errorNameFrom } from '@moeru/std'

/**
 * One retry that {@link runWithRetry} is about to wait for.
 */
export interface RetryEvent {
  /**
   * Retry number, where `1` is the first retry after the initial failure.
   */
  attempt: number
  /**
   * Wait in milliseconds before the retry starts.
   */
  delayMs: number
  /**
   * The failure that caused the retry.
   */
  error: unknown
}

/**
 * Describes how provider retries should behave.
 *
 * ASCII flow:
 * attempt -> run request -> success return
 * attempt -> run request -> retriable failure -> onRetry -> sleep -> next attempt
 * attempt -> run request -> non-retriable failure, last attempt, or aborted signal -> throw
 */
export interface RetryPolicy {
  /**
   * Returns the wait time before retry `attempt` (`1` is the first retry) after `error`.
   */
  delayMs: (attempt: number, error: unknown) => number
  /**
   * Maximum number of total attempts, including the first try.
   */
  maxAttempts: number
  /**
   * Observes each retry before its wait starts.
   */
  onRetry?: (retry: RetryEvent) => void
  /**
   * Determines whether an error can be retried safely.
   */
  shouldRetry: (error: unknown) => boolean
  /**
   * Suspends execution between retries. It rejects with the abort reason when `signal` aborts.
   */
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>
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
   * Computes the delay for a retry attempt from the attempt number (`1` for the first retry) and the failure.
   *
   * @default the longer of the provider's `Retry-After` ({@link readRetryAfter}) and an exponential backoff of
   * `500 * 2 ** (attempt - 1)` ms plus up to a quarter of random jitter, capped at `maxDelayMs`
   */
  delayMs?: (attempt: number, error: unknown) => number
  /**
   * Maximum total attempts, including the first request.
   *
   * @default 3
   */
  maxAttempts?: number
  /**
   * Upper bound of the default delay, so a far `Retry-After` does not hold a run for minutes.
   * Ignored when `delayMs` is given.
   *
   * @default 60_000
   */
  maxDelayMs?: number
  /**
   * Observes each retry before its wait starts, for example to log or record it.
   */
  onRetry?: (retry: RetryEvent) => void
  /**
   * Overrides the retry classifier.
   *
   * @default isRetriableProviderError
   */
  shouldRetry?: (error: unknown) => boolean
  /**
   * Overrides the sleeper used between attempts.
   */
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
}

/**
 * Options of one {@link runWithRetry} call.
 */
export interface RunWithRetryOptions {
  /**
   * Stops the retries: an aborted signal fails the call with its reason instead of starting or waiting for an attempt.
   * Pass the case or request signal so that an interrupted run does not keep waiting.
   */
  signal?: AbortSignal
}

const retryableStatusCodes = new Set([408, 425, 429, 500, 502, 503, 504])
const retryableErrorNames = new Set(['FetchError', 'TimeoutError'])
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

export function createRetryPolicy(options: RetryPolicyOptions = {}): RetryPolicy {
  const maxAttempts = assertValidMaxAttempts(options.maxAttempts ?? 3)
  const maxDelayMs = options.maxDelayMs ?? 60_000

  return {
    delayMs: options.delayMs ?? ((attempt, error) => defaultDelayMs(attempt, error, maxDelayMs)),
    maxAttempts,
    onRetry: options.onRetry,
    shouldRetry: options.shouldRetry ?? isRetriableProviderError,
    sleep: options.sleep ?? abortableSleep,
  }
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

/**
 * Reads how long a provider asked the caller to wait before the next request.
 *
 * Use when:
 * - a custom retry delay, such as a case `autoRetryDelay`, should respect the provider's rate limit window
 *
 * Expects:
 * - the error to carry response headers as `responseHeaders` (xsai `APICallError`), `headers`, or `response.headers`,
 *   either as a `Headers` instance or as a plain object
 *
 * Returns:
 * - milliseconds from `retry-after-ms`, else from `retry-after` (seconds or an HTTP date), else `undefined`
 *
 * Before:
 * - `{ responseHeaders: { 'retry-after': '7' } }`
 * - `{ response: { headers: new Headers({ 'retry-after-ms': '1500' }) } }`
 * - `{ responseHeaders: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' } }` (10 seconds from now)
 *
 * After:
 * - `7000`
 * - `1500`
 * - `10000`
 */
export function readRetryAfter(error: unknown): number | undefined {
  const retryAfterMs = Number.parseFloat(readHeader(error, 'retry-after-ms') ?? '')
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return retryAfterMs
  }

  const retryAfter = readHeader(error, 'retry-after')?.trim()
  if (retryAfter == null || retryAfter === '') {
    return undefined
  }

  // RFC 9110 §10.2.3: `Retry-After` is either delay-seconds or an HTTP date.
  if (/^\d+(?:\.\d+)?$/.test(retryAfter)) {
    return Number.parseFloat(retryAfter) * 1000
  }

  const date = Date.parse(retryAfter)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
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
 * - `options.signal`, when given, to be the signal that cancels the surrounding work
 *
 * Returns:
 * - the first successful result; otherwise rejects with the last failure, or with the abort reason once `signal` aborts
 */
export async function runWithRetry<T>(operation: () => Promise<T>, policy: RetryPolicy = createRetryPolicy(), options: RunWithRetryOptions = {}): Promise<T> {
  const { signal } = options

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    signal?.throwIfAborted()

    try {
      return await operation()
    }
    catch (error) {
      // A failure caused by the abort is not a provider failure, so it is not retried.
      if (signal?.aborted === true || attempt >= policy.maxAttempts || !policy.shouldRetry(error)) {
        throw error
      }

      const delayMilliseconds = policy.delayMs(attempt, error)
      policy.onRetry?.({ attempt, delayMs: Math.max(0, delayMilliseconds), error })
      if (delayMilliseconds > 0) {
        await policy.sleep(delayMilliseconds, signal)
      }
    }
  }

  throw new Error('Retry loop exited without returning a value.')
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason)
      return
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal!.reason)
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
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

/**
 * Waits for the provider's `Retry-After` when it is longer than the backoff.
 * The jitter spreads callers that one rate limit stopped together, so they do not all call again at the same moment.
 */
function defaultDelayMs(attempt: number, error: unknown, maxDelayMs: number): number {
  const backoffMs = 500 * 2 ** (attempt - 1)
  const jitteredBackoffMs = backoffMs + Math.random() * backoffMs / 4
  return Math.min(maxDelayMs, Math.max(readRetryAfter(error) ?? 0, jitteredBackoffMs))
}

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

function readHeader(error: unknown, name: string): string | undefined {
  if (error == null || typeof error !== 'object') {
    return undefined
  }

  const response = (error as { response?: unknown }).response
  const sources = [
    (error as { responseHeaders?: unknown }).responseHeaders,
    (error as { headers?: unknown }).headers,
    response != null && typeof response === 'object' ? (response as { headers?: unknown }).headers : undefined,
  ]

  for (const headers of sources) {
    if (headers instanceof Headers) {
      const value = headers.get(name)
      if (value != null) {
        return value
      }
      continue
    }

    if (headers != null && typeof headers === 'object') {
      const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name)
      if (typeof entry?.[1] === 'string') {
        return entry[1]
      }
    }
  }

  return undefined
}
