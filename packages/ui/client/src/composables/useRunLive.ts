import type { Ref } from 'vue'

import type { ProgressResponse, RunSnapshot } from '../../../src/shared/contract'

import { useQuery, useQueryCache } from '@pinia/colada'
import { refThrottled } from '@vueuse/core'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import { api, openRunStream } from '../api'
import { RUNS_KEY } from './useCatalog'

/** State of the live connection of a run view. */
export type LiveConnection = 'closed' | 'connecting' | 'ended' | 'error' | 'open'

/**
 * Minimum time between two snapshot refetches caused by stream events.
 *
 * NOTICE: OSWorld runs emit bursts of ~10 `metric.recorded` events per case start; refetching once per burst keeps
 * the tree current without one request per event.
 */
const refetchIntervalMs = 1500

/**
 * Keeps a run snapshot current: `GET /snapshot` (cached by Pinia Colada under `['runs', runKey, 'snapshot']`), then
 * the SSE stream after `snapshot.seq`, whose `progress` events are written into the same cache entry.
 *
 * Use when:
 * - a view shows a run that may still be executing (`live-bus` or `live-tail`)
 *
 * Expects:
 * - the server protocol of `API.md` "Live updates": `run-event`, `progress`, `reset`, `end`
 *
 * Returns:
 * - `snapshot` replaced on every refetch; `progress` events patch progress, current position, state, and seq in
 *   place between refetches; `receivedAt` is when the last update arrived (drives the local clock of the ETA)
 * - a run opened again shows its cached snapshot at once and catches up from there
 * - `refreshKey`: `snapshot.seq`, changed at most once per refetch interval; views that load their own data when
 *   the run advanced (scores, OTEL, task and case pages) watch it instead of `seq`
 */
export function useRunLive(runKey: Ref<string>) {
  const queryCache = useQueryCache()
  const key = () => ['runs', runKey.value, 'snapshot']
  const query = useQuery({ key, query: () => api.snapshot(runKey.value) })
  const snapshot = computed<RunSnapshot | undefined>(() => (query.data.value?.runKey === runKey.value ? query.data.value : undefined))
  const connection = shallowRef<LiveConnection>('closed')
  const receivedAt = shallowRef(Date.now())
  const eventCount = shallowRef(0)
  let source: EventSource | undefined
  let refetchTimer: ReturnType<typeof setTimeout> | undefined
  let lastFetch = 0

  function close(): void {
    source?.close()
    source = undefined
    clearTimeout(refetchTimer)
    refetchTimer = undefined
  }

  function refetch(): void {
    lastFetch = Date.now()
    void query.refetch()
  }

  function scheduleRefetch(): void {
    if (refetchTimer != null)
      return
    const wait = Math.max(0, refetchIntervalMs - (Date.now() - lastFetch))
    refetchTimer = setTimeout(() => {
      refetchTimer = undefined
      refetch()
    }, wait)
  }

  function connect(after: number): void {
    const mine = runKey.value
    connection.value = 'connecting'
    const stream = openRunStream(mine, after)
    source = stream
    stream.addEventListener('open', () => (connection.value = 'open'))
    stream.addEventListener('run-event', () => {
      eventCount.value += 1
      scheduleRefetch()
    })
    stream.addEventListener('progress', (message) => {
      const update = JSON.parse((message as MessageEvent<string>).data) as ProgressResponse
      const current = queryCache.getQueryData<RunSnapshot>(['runs', mine, 'snapshot'])
      if (current == null)
        return
      queryCache.setQueryData(['runs', mine, 'snapshot'], { ...current, current: update.current, progress: update.progress, seq: Math.max(current.seq, update.seq), state: update.state })
    })
    stream.addEventListener('reset', refetch)
    stream.addEventListener('end', () => {
      close()
      connection.value = 'ended'
      // The run reached a terminal state: the sidebar and lists re-read the hierarchy at once instead of at their
      // next 10 s refresh. Exact: the per-run keys start with the same segment.
      void queryCache.invalidateQueries({ exact: true, key: RUNS_KEY })
      refetch()
    })
    // EventSource reconnects by itself (server sends `retry: 2000`); only report the gap.
    stream.addEventListener('error', () => {
      if (source === stream && connection.value !== 'ended')
        connection.value = stream.readyState === EventSource.CLOSED ? 'error' : 'connecting'
    })
  }

  // Another run: drop the stream of the previous one; the first snapshot of the new run decides whether to stream.
  watch(runKey, () => {
    close()
    connection.value = 'closed'
    eventCount.value = 0
  })
  watch(snapshot, (value) => {
    if (value == null)
      return
    receivedAt.value = Date.now()
    if (source != null || connection.value !== 'closed')
      return
    if (value.state === 'running' || value.state === 'stale')
      connect(value.seq)
    else
      connection.value = 'ended'
  }, { immediate: true })

  // NOTICE: `progress` events move `seq` about every 500 ms (the server throttle). Watching `seq` directly would
  // refetch every dependent view at that rate, bypassing `refetchIntervalMs` that bounds the snapshot refetch.
  const refreshKey = refThrottled(computed(() => snapshot.value?.seq), refetchIntervalMs)

  onScopeDispose(close)

  return { connection, error: query.error, eventCount, receivedAt, refreshKey, reload: refetch, snapshot }
}
