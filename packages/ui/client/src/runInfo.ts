import type { RunListItem } from '../../src/shared/contract'

import { shallowRef } from 'vue'

import { api } from './api'

const cache = new Map<string, Promise<RunListItem>>()

/**
 * Report identity of a run (workspace, project segment, experiment, attempt), cached per run key.
 *
 * The labels of a run never change, so one request per run is enough for breadcrumbs and the sidebar.
 */
export function runInfo(runKey: string): Promise<RunListItem> {
  let pending = cache.get(runKey)
  if (pending == null) {
    pending = api.run(runKey)
    pending.catch(() => cache.delete(runKey))
    cache.set(runKey, pending)
  }
  return pending
}

/**
 * Bumped when a run shown on screen reached a terminal state, so the sidebar re-reads the hierarchy at once
 * instead of at its next 10 s refresh.
 */
export const runStatesChanged = shallowRef(0)
