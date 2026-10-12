import type { CaseCounts, RunListItem, RunSnapshot } from '../../src/shared/contract'
import type { HierarchyPosition } from './hierarchy'
import type { MatrixChip } from './labels'

import { formatDuration } from './format'
import { attemptDate, attemptLabel, experimentLabel, mergeMatrices, runLabel } from './labels'
import { href } from './router'

/** Levels whose breadcrumb segment can switch to a sibling. */
export type SwitchableLevel = 'attempt' | 'experiment' | 'project' | 'run' | 'workspace'

/** One sibling a breadcrumb switcher offers, with enough facts to choose without opening it. */
export interface SwitcherOption {
  chips?: MatrixChip[]
  counts?: CaseCounts
  /** Short facts, for example "3 experiments · 12 runs". */
  detail?: string
  exact?: null | number
  href: string
  /** Full id; searchable and shown as the tooltip. */
  id: string
  /** Readable name (`labels.ts`). */
  label: string
  /** State of the newest run below the option. */
  state?: string
  /** Start of the newest run below the option (ISO). */
  time?: string
}

/**
 * Filters switcher options by every word of a query, matching the readable name, the id, chips, and facts.
 *
 * Before:
 * - query "gpt rep 3" over options labelled "model gpt-5.5 · repeat 1–3" and "auv-c759d695"
 *
 * After:
 * - only "model gpt-5.5 · repeat 1–3"
 */
export function filterOptions(options: readonly SwitcherOption[], query: string): SwitcherOption[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0)
    return [...options]
  return options.filter((option) => {
    const text = [option.label, option.id, option.detail, ...(option.chips ?? []).map(chip => `${chip.axis} ${chip.values}`)].join(' ').toLowerCase()
    return words.every(word => text.includes(word))
  })
}

/**
 * Builds the siblings of a task or a case from the run's snapshot, for the breadcrumb switchers below the run level.
 *
 * Use when:
 * - a task page (siblings: the tasks of the run) or a case page (siblings: the cases of its task) renders its header
 *
 * Expects:
 * - the snapshot the page already holds (`useRunLive`); no request is made
 *
 * Returns:
 * - tasks in run order, or the cases of `taskId` in case order; `undefined` without a snapshot
 */
export function runSwitcherOptions(snapshot: RunSnapshot | undefined, level: 'case' | 'task', taskId?: string): SwitcherOption[] | undefined {
  if (snapshot == null)
    return undefined
  if (level === 'task') {
    return snapshot.tasks.map(task => ({
      counts: task.caseCounts,
      exact: task.scores.exact,
      href: href({ name: 'task', runKey: snapshot.runKey, taskId: task.id }),
      id: task.id,
      label: task.displayName,
      state: task.state,
      time: task.startedAt,
    }))
  }
  return snapshot.tasks.find(task => task.id === taskId)?.cases.map(node => ({
    detail: [`#${node.index + 1}`, node.durationMs == null ? undefined : formatDuration(node.durationMs)].filter(Boolean).join(' · '),
    exact: node.scores.exact,
    href: href({ caseId: node.caseId, name: 'case', runKey: snapshot.runKey, taskId: node.taskId }),
    id: node.caseId,
    label: node.name,
    state: node.state,
  }))
}

/**
 * Builds the siblings of every level of a position, for the breadcrumb switchers.
 *
 * Use when:
 * - a page header renders its breadcrumb; siblings are the items one level up contains (projects of the workspace,
 *   experiments of the project, attempts and runs of the experiment)
 *
 * Expects:
 * - `runs` newest first (`useCatalog().runs`); no request is made
 *
 * Returns:
 * - options per level of `position`, newest first; levels the position does not reach are absent
 */
export function switcherOptions(position: HierarchyPosition, runs: readonly RunListItem[]): Partial<Record<SwitchableLevel, SwitcherOption[]>> {
  const { attempt, experiment, project, runKey, workspace } = position
  const result: Partial<Record<SwitchableLevel, SwitcherOption[]>> = {}

  if (workspace != null) {
    result.workspace = group(runs, run => run.workspaceId).map(([id, list]) => ({
      detail: `${new Set(list.map(run => run.projectSegment)).size} project(s) · ${list.length} run(s)`,
      href: href({ name: 'scope', workspace: id }),
      id,
      label: id,
      state: list[0]!.state,
      time: list[0]!.startedAt,
    }))
  }
  const inWorkspace = runs.filter(run => run.workspaceId === workspace)
  if (workspace != null && project != null) {
    result.project = group(inWorkspace, run => run.projectSegment).map(([id, list]) => ({
      detail: `${new Set(list.map(run => run.experimentId)).size} experiment(s) · ${list.length} run(s)`,
      exact: list[0]!.exactAverage,
      href: href({ name: 'scope', project: id, workspace }),
      id,
      label: id,
      state: list[0]!.state,
      time: list[0]!.startedAt,
    }))
  }
  const inProject = inWorkspace.filter(run => run.projectSegment === project)
  if (workspace != null && project != null && experiment != null) {
    result.experiment = group(inProject, run => run.experimentId).map(([id, list]) => {
      const label = experimentLabel(id, mergeMatrices(list.map(run => run.matrix)))
      return {
        chips: label.textIsMatrix ? undefined : label.chips,
        detail: `${new Set(list.map(run => run.attemptId)).size} attempt(s)`,
        exact: list[0]!.exactAverage,
        href: href({ experiment: id, name: 'scope', project, workspace }),
        id,
        label: label.text,
        state: list[0]!.state,
        time: list[0]!.startedAt,
      }
    })
  }
  const inExperiment = inProject.filter(run => run.experimentId === experiment)
  if (workspace != null && project != null && experiment != null && attempt != null) {
    result.attempt = group(inExperiment, run => run.attemptId).map(([id, list]) => ({
      counts: list[0]!.counts,
      exact: list[0]!.exactAverage,
      href: href({ attempt: id, experiment, name: 'scope', project, workspace }),
      id,
      label: attemptLabel(id),
      state: list[0]!.state,
      time: attemptDate(id)?.toISOString() ?? list[0]!.startedAt,
    }))
  }
  if (runKey != null) {
    // Siblings of a run: the runs of its experiment (an attempt usually holds one run).
    const siblings = experiment == null ? runs.filter(run => run.runKey === runKey) : inExperiment
    result.run = siblings.map(run => ({
      counts: run.counts,
      detail: attemptLabel(run.attemptId),
      exact: run.exactAverage,
      href: href({ name: 'run', runKey: run.runKey }),
      id: run.runKey,
      label: runLabel(run),
      state: run.state,
      time: run.startedAt,
    }))
  }
  return result
}

/** Groups runs by a key in first-seen order, so newest-first input gives newest-first groups. */
function group(runs: readonly RunListItem[], key: (run: RunListItem) => string): [string, RunListItem[]][] {
  const groups = new Map<string, RunListItem[]>()
  for (const run of runs) {
    const list = groups.get(key(run))
    if (list == null)
      groups.set(key(run), [run])
    else
      list.push(run)
  }
  return [...groups.entries()]
}
