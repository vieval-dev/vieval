import type { RetryPolicy, RetryPolicyOptions } from './retry-policy'

import { createRetryPolicy, runWithRetry } from './retry-policy'

/**
 * Bundles a provider with the retry policy used to call it.
 *
 * Use when:
 * - a provider instance should travel with the retry runner that governs it
 * - you want call sites to share one retry configuration object
 */
export interface ProviderAdapter<TProvider> {
  /**
   * The underlying provider instance.
   */
  provider: TProvider
  /**
   * The retry policy used for provider calls.
   */
  retryPolicy: RetryPolicy
  /**
   * Runs a provider-dependent operation with the adapter retry policy.
   */
  runWithRetry: <TResult>(operation: () => Promise<TResult>) => Promise<TResult>
}

/**
 * Creates a provider adapter with the default retry policy.
 *
 * Use when:
 * - you have a provider instance and want a consistent retry wrapper
 *
 * Expects:
 * - the provider to be safe to reuse across attempts
 */
export function createProviderAdapter<TProvider>(provider: TProvider, options: RetryPolicyOptions = {}): ProviderAdapter<TProvider> {
  const retryPolicy = createRetryPolicy(options)

  return {
    provider,
    retryPolicy,
    runWithRetry: operation => runWithRetry(operation, retryPolicy),
  }
}
