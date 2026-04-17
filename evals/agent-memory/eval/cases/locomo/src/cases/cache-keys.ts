export const LOCOMO_CASES_SCHEMA_VERSION = 'v1'

/**
 * Builds deterministic key segments for LoCoMo case cache artifacts.
 *
 * Before:
 * - datasetHash: "abc123"
 *
 * After:
 * - ["cases", "abc123", "v1"]
 */
export function createLoCoMoCaseCacheKey(datasetHash: string, schemaVersion = LOCOMO_CASES_SCHEMA_VERSION): string[] {
  return ['cases', datasetHash, schemaVersion]
}
