import type { WatchSource } from 'vue'

import { onScopeDispose, shallowRef, watch } from 'vue'

import { ApiError } from '../api'

/**
 * State of one async request bound to reactive inputs.
 *
 * @param T Response type.
 */
export interface Resource<T> {
  data: Readonly<{ value: T | undefined }>
  error: Readonly<{ value: ApiError | undefined }>
  /** `true` only while there is no data yet; refreshes keep the previous data on screen. */
  loading: Readonly<{ value: boolean }>
  reload: () => Promise<void>
}

/**
 * Loads `load()` whenever `source` changes and exposes loading, error, and data.
 *
 * Use when:
 * - a view shows the response of one API route that depends on route parameters
 *
 * Expects:
 * - `load` throws {@link ApiError} (other errors are wrapped)
 *
 * Returns:
 * - refs that the shared `StateView` renders; responses of outdated inputs are discarded
 * - with `keepData`, a change of `source` reloads without clearing the data on screen
 */
export function useResource<T, S>(source: WatchSource<S>, load: (value: S) => Promise<T>, options: { keepData?: boolean } = {}): Resource<T> {
  const data = shallowRef<T>()
  const error = shallowRef<ApiError>()
  const loading = shallowRef(true)
  let generation = 0
  let current: S | undefined

  async function run(value: S, keepData: boolean): Promise<void> {
    const mine = ++generation
    current = value
    if (!keepData) {
      data.value = undefined
      loading.value = true
    }
    try {
      const result = await load(value)
      if (mine !== generation)
        return
      data.value = result
      error.value = undefined
    }
    catch (caught) {
      if (mine !== generation)
        return
      error.value = caught instanceof ApiError ? caught : new ApiError(0, String(caught))
    }
    finally {
      if (mine === generation)
        loading.value = false
    }
  }

  // `keepData`: inputs such as a live run's `seq` only refresh the same view; keep showing it while reloading.
  const stop = watch(source, value => void run(value, options.keepData === true && data.value != null), { immediate: true })
  onScopeDispose(stop)

  return { data, error, loading, reload: () => run(current as S, true) }
}
