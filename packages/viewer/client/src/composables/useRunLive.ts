import type { Ref } from 'vue'

import type { ProgressResponse, RunSnapshot } from '../../../src/shared/contract'

import { refThrottled } from '@vueuse/core'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import { api, ApiError, openRunStream } from '../api'
import { runStatesChanged } from '../runInfo'

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
 * Keeps a run snapshot current: `GET /snapshot`, then the SSE stream after `snapshot.seq`.
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
 * - `refreshKey`: `snapshot.seq`, changed at most once per refetch interval; views that load their own data when
 *   the run advanced (scores, OTEL, task and case pages) watch it instead of `seq`
 */
export function useRunLive(runKey: Ref<string>) {
  const snapshot = shallowRef<RunSnapshot>()
  const error = shallowRef<ApiError>()
  const connection = shallowRef<LiveConnection>('closed')
  const receivedAt = shallowRef(Date.now())
  const eventCount = shallowRef(0)
  let source: EventSource | undefined
  let refetchTimer: ReturnType<typeof setTimeout> | undefined
  let lastFetch = 0
  let generation = 0

  function close(): void {
    source?.close()
    source = undefined
    clearTimeout(refetchTimer)
    refetchTimer = undefined
  }

  async function fetchSnapshot(mine: number): Promise<RunSnapshot | undefined> {
    lastFetch = Date.now()
    try {
      const next = await api.snapshot(runKey.value)
      if (mine !== generation)
        return undefined
      snapshot.value = next
      receivedAt.value = Date.now()
      error.value = undefined
      return next
    }
    catch (caught) {
      if (mine === generation)
        error.value = caught instanceof ApiError ? caught : new ApiError(0, String(caught))
      return undefined
    }
  }

  function scheduleRefetch(mine: number): void {
    if (refetchTimer != null)
      return
    const wait = Math.max(0, refetchIntervalMs - (Date.now() - lastFetch))
    refetchTimer = setTimeout(() => {
      refetchTimer = undefined
      void fetchSnapshot(mine)
    }, wait)
  }

  function connect(mine: number, after: number): void {
    connection.value = 'connecting'
    const stream = openRunStream(runKey.value, after)
    source = stream
    stream.addEventListener('open', () => (connection.value = 'open'))
    stream.addEventListener('run-event', () => {
      eventCount.value += 1
      scheduleRefetch(mine)
    })
    stream.addEventListener('progress', (message) => {
      const update = JSON.parse((message as MessageEvent<string>).data) as ProgressResponse
      if (snapshot.value == null || mine !== generation)
        return
      snapshot.value = { ...snapshot.value, current: update.current, progress: update.progress, seq: Math.max(snapshot.value.seq, update.seq), state: update.state }
      receivedAt.value = Date.now()
    })
    stream.addEventListener('reset', () => void fetchSnapshot(mine))
    stream.addEventListener('end', () => {
      close()
      connection.value = 'ended'
      runStatesChanged.value += 1
      void fetchSnapshot(mine)
    })
    // EventSource reconnects by itself (server sends `retry: 2000`); only report the gap.
    stream.addEventListener('error', () => {
      if (source === stream && connection.value !== 'ended')
        connection.value = stream.readyState === EventSource.CLOSED ? 'error' : 'connecting'
    })
  }

  async function start(): Promise<void> {
    close()
    const mine = ++generation
    snapshot.value = undefined
    error.value = undefined
    connection.value = 'closed'
    const first = await fetchSnapshot(mine)
    if (first == null || mine !== generation)
      return
    if (first.state === 'running' || first.state === 'stale')
      connect(mine, first.seq)
    else
      connection.value = 'ended'
  }

  // NOTICE: `progress` events move `seq` about every 500 ms (the server throttle). Watching `seq` directly would
  // refetch every dependent view at that rate, bypassing `refetchIntervalMs` that bounds the snapshot refetch.
  const refreshKey = refThrottled(computed(() => snapshot.value?.seq), refetchIntervalMs)

  const stop = watch(runKey, () => void start(), { immediate: true })
  onScopeDispose(() => {
    stop()
    generation += 1
    close()
  })

  return { connection, error, eventCount, receivedAt, refreshKey, reload: start, snapshot }
}
