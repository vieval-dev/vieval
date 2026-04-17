import type { TaskRunContext } from 'vieval/config'

import type { LoCoMoCase } from '../types.ts'

import { createLoCoMoCaseCacheKey } from './cache-keys.ts'

/**
 * Loads LoCoMo cases from deterministic cache or derives and writes them once.
 *
 * Use when:
 * - case derivation is deterministic but expensive
 * - multi-backend runs must reuse exactly the same case list
 *
 * Expects:
 * - datasetHash and schemaVersion to remain stable for comparable runs
 *
 * Returns:
 * - cached or freshly-derived LoCoMo cases
 */
export async function loadOrDeriveLoCoMoCases(args: {
  cache: TaskRunContext['cache']
  datasetHash: string
  derive: () => Promise<LoCoMoCase[]>
  schemaVersion: string
}): Promise<LoCoMoCase[]> {
  const entry = args.cache.namespace('locomo').file({
    ext: 'json',
    key: createLoCoMoCaseCacheKey(args.datasetHash, args.schemaVersion),
  })

  if (await entry.exists()) {
    return await entry.loadAsCasesInput<LoCoMoCase>()
  }

  const derived = await args.derive()
  await entry.writeJson(derived)
  return derived
}
