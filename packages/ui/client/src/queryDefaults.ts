import type { PiniaColadaOptions } from '@pinia/colada'

/**
 * Query defaults of the viewer, shared by the app (`main.ts`) and component tests (`test-setup.ts`).
 */
export const queryDefaults: NonNullable<PiniaColadaOptions['queryOptions']> = {
  // A tab brought back to the front catches up through the catalog poll and the live stream already.
  refetchOnWindowFocus: false,
  // Report files of a finished run never change, and live views refetch on their own when the run advances
  // (`useRunLive().refreshKey`); revisiting a view shows the cached response at once instead of a skeleton.
  staleTime: 30_000,
}
