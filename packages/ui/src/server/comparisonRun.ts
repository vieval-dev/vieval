import type { ComparisonRun } from '../shared/compare'
import type { ReducedCase } from '../shared/reduce'
import type { RunHandle } from './store'

import { buildTaskNodes } from '../shared/reduce'
import { toRunListItem } from './store'

/**
 * Projects a run's reduced state into the data used by matrix and case comparisons.
 *
 * Use when:
 * - a live request or a static export needs to compare this run
 *
 * Returns:
 * - serializable task and case results with the definitions needed to score them
 */
export function projectComparisonRun(handle: RunHandle, now: number): ComparisonRun {
  const reducer = handle.reducer()
  const tasks = buildTaskNodes(reducer, () => 0)
  return {
    item: toRunListItem(handle, now, tasks),
    metricDefinitions: [...reducer.metricDefinitions.values()],
    scoreDefinitions: [...reducer.scoreDefinitions.values()],
    tasks: tasks.map(({ caseCounts, cases, caseTotal, displayName, entryId, id, matrix, scoreGraders, scoring, state }) => ({
      caseCounts,
      cases: cases.map(({ durationMs, identity, key, name, rounds, scores, state }) => {
        const round = rounds.at(-1)
        return {
          durationMs,
          identity,
          latest: round == null ? undefined : { scores: round.scores, state: round.state },
          metrics: numericMetrics(reducer.cases.get(key), round?.roundIndex),
          name,
          roundCount: rounds.length,
          scores,
          state,
        }
      }),
      caseTotal,
      displayName,
      entryId,
      id,
      matrix,
      scoreDefinitions: [...reducer.tasks.get(id)?.scoreDefinitions.values() ?? []],
      scoreGraders,
      scoring,
      state,
    })),
  }
}

/** Last finite number each metric recorded for the case in the given round (or without a round). */
function numericMetrics(reduced: ReducedCase | undefined, roundIndex: number | undefined): Record<string, number> {
  const values: Record<string, number> = {}
  for (const entry of reduced?.metrics ?? []) {
    if (entry.roundIndex != null && roundIndex != null && entry.roundIndex !== roundIndex)
      continue
    if (typeof entry.value === 'number' && Number.isFinite(entry.value))
      values[entry.name] = entry.value
  }
  return values
}
