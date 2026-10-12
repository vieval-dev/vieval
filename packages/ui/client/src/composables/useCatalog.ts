import type { UseQueryReturn } from '@pinia/colada'

import type { CaseCounts, RunListItem } from '../../../src/shared/contract'
import type { MatrixAxes } from '../labels'

import { defineQuery, useQuery } from '@pinia/colada'
import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { computed, watch } from 'vue'

import { api } from '../api'
import { mergeMatrices } from '../labels'

/** Every run below the viewer's report roots, with the hierarchy and labels derived from it. */
export interface Catalog {
  /** Matrix axes of all runs of an experiment (or a project when `experiment` is omitted). */
  matrixOf: (scope: Scope) => MatrixAxes
  /** The `GET /api/runs` query (key {@link RUNS_KEY}); views pass its state to `StateView`. */
  query: UseQueryReturn<RunListItem[]>
  /** Runs, newest first. */
  runs: Readonly<{ value: RunListItem[] }>
  /** Runs inside a scope, newest first. */
  runsIn: (scope: Scope) => RunListItem[]
  /** Workspaces with their projects and experiments, ordered by their newest run. */
  workspaces: Readonly<{ value: WorkspaceEntry[] }>
}

/** One experiment of the catalog, with its attempts. */
export interface ExperimentEntry {
  /** Attempt ids, newest first. */
  attempts: string[]
  id: string
  latest: RunListItem
  project: string
  runs: RunListItem[]
  workspace: string
}

/** One project of the catalog, with its experiments. */
export interface ProjectEntry {
  experiments: ExperimentEntry[]
  id: string
  /** Newest run of the project. */
  latest: RunListItem
  runs: RunListItem[]
  workspace: string
}

/** A position in the report hierarchy; levels below the set ones are ignored. */
export interface Scope {
  attempt?: string
  experiment?: string
  project?: string
  workspace?: string
}

/** One workspace of the catalog. */
export interface WorkspaceEntry {
  id: string
  projects: ProjectEntry[]
}

/** Interval of the refresh that makes new runs appear without reloading the page. */
const REFRESH_MS = 10_000

/**
 * Query key of the run list. Invalidate it (exactly: per-run keys start with the same segment) to re-read the
 * hierarchy at once, for example when a run shown on screen ended.
 */
export const RUNS_KEY = ['runs'] as const

/**
 * Adds case counts of several runs.
 *
 * Before:
 * - [{ passed: 2, failed: 1, … }, { passed: 3, failed: 0, … }]
 *
 * After:
 * - { passed: 5, failed: 1, … }
 */
export function sumCounts(runs: readonly RunListItem[]): CaseCounts {
  return runs.reduce<CaseCounts>((sum, run) => ({
    failed: sum.failed + run.counts.failed,
    passed: sum.passed + run.counts.passed,
    running: sum.running + run.counts.running,
    skipped: sum.skipped + run.counts.skipped,
    timeout: sum.timeout + run.counts.timeout,
    total: sum.total + run.counts.total,
  }), { failed: 0, passed: 0, running: 0, skipped: 0, timeout: 0, total: 0 })
}

/**
 * Shared list of every run (`GET /api/runs`), refreshed every 10 s while the tab is visible.
 *
 * Use when:
 * - a view needs the hierarchy, labels, or runs of a scope (sidebar, home, project and experiment pages, breadcrumbs)
 *
 * Returns:
 * - one catalog for the whole app (a Pinia Colada `defineQuery`): the first call starts the request and the refresh,
 *   later calls reuse them
 */
export const useCatalog = defineQuery((): Catalog => {
  const query = useQuery({ key: RUNS_KEY, query: () => api.runs() })
  const polling = useIntervalFn(() => void query.refetch(), REFRESH_MS)
  // A hidden tab does not poll; it re-reads the runs once it is shown again.
  watch(useDocumentVisibility(), (visibility) => {
    if (visibility === 'hidden') {
      polling.pause()
      return
    }
    void query.refetch()
    polling.resume()
  })

  const runs = computed(() => (query.data.value ?? []).toSorted((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '')))

  const workspaces = computed<WorkspaceEntry[]>(() => {
    const byWorkspace = new Map<string, Map<string, Map<string, RunListItem[]>>>()
    for (const run of runs.value) {
      const projects = byWorkspace.get(run.workspaceId) ?? new Map<string, Map<string, RunListItem[]>>()
      byWorkspace.set(run.workspaceId, projects)
      const experiments = projects.get(run.projectSegment) ?? new Map<string, RunListItem[]>()
      projects.set(run.projectSegment, experiments)
      const list = experiments.get(run.experimentId)
      if (list == null)
        experiments.set(run.experimentId, [run])
      else
        list.push(run)
    }
    // Runs are newest first, so Map insertion order already sorts every level by its newest run.
    return [...byWorkspace.entries()].map(([workspace, projects]) => ({
      id: workspace,
      projects: [...projects.entries()].map(([project, experiments]) => {
        const entries = [...experiments.entries()].map(([experiment, list]) => ({
          attempts: [...new Set(list.map(run => run.attemptId))],
          id: experiment,
          latest: list[0]!,
          project,
          runs: list,
          workspace,
        }))
        const projectRuns = entries.flatMap(entry => entry.runs).toSorted((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
        return { experiments: entries, id: project, latest: projectRuns[0]!, runs: projectRuns, workspace }
      }),
    }))
  })

  function runsIn(scope: Scope): RunListItem[] {
    return runs.value.filter(run =>
      (scope.workspace == null || run.workspaceId === scope.workspace)
      && (scope.project == null || run.projectSegment === scope.project)
      && (scope.experiment == null || run.experimentId === scope.experiment)
      && (scope.attempt == null || run.attemptId === scope.attempt))
  }

  return {
    matrixOf: scope => mergeMatrices(runsIn(scope).map(run => run.matrix)),
    query,
    runs,
    runsIn,
    workspaces,
  }
})
