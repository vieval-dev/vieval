// @unocss-include
// NOTICE:
// `levelIcons` holds UnoCSS icon classes, but the UnoCSS Vite plugin does not scan plain `.ts` modules by default
// (`pipeline.include` matches `.vue`, `.tsx`, … only), so without this magic comment the icons are never generated.
// Removal condition: when the icon classes move into a `.vue` file or `pipeline.include` covers `.ts`.
import type { Crumb } from './components/Breadcrumbs.vue'

import { shortTaskId } from './format'
import { href } from './router'

/**
 * Levels of the report hierarchy, outermost first, then the execution tree inside a run.
 *
 * `round` is one auto attempt of a task (every case runs again); `try` is one immediate retry of a case.
 */
export type HierarchyLevel = 'attempt' | 'case' | 'comparison' | 'experiment' | 'home' | 'project' | 'round' | 'run' | 'task' | 'try' | 'workspace'

/**
 * Icon of every hierarchy level (MingCute, `-line`), so a level looks the same in breadcrumbs, the sidebar, the
 * execution tree, page titles, and comparisons.
 */
export const levelIcons: Record<HierarchyLevel, string> = {
  attempt: 'i-mingcute-tag-line',
  case: 'i-mingcute-file-check-line',
  comparison: 'i-mingcute-git-compare-line',
  experiment: 'i-mingcute-flask-line',
  home: 'i-mingcute-home-4-line',
  project: 'i-mingcute-folder-line',
  round: 'i-mingcute-repeat-line',
  run: 'i-mingcute-play-circle-line',
  task: 'i-mingcute-list-check-2-line',
  try: 'i-mingcute-history-anticlockwise-line',
  workspace: 'i-mingcute-box-3-line',
}

/** Name of every hierarchy level for labels and tooltips. */
export const levelLabels: Record<HierarchyLevel, string> = {
  attempt: 'Attempt',
  case: 'Case',
  comparison: 'Comparison',
  experiment: 'Experiment',
  home: 'Projects',
  project: 'Project',
  round: 'Round',
  run: 'Run',
  task: 'Task',
  try: 'Try',
  workspace: 'Workspace',
}

/** Readable names of the levels of a {@link HierarchyPosition} (`labels.ts`); ids are used where a name is missing. */
export interface HierarchyNames {
  attempt?: string
  experiment?: string
  run?: string
}

/** Position of a view in the report hierarchy; every level is optional below the ones that are set. */
export interface HierarchyPosition {
  attempt?: string
  caseId?: string
  caseName?: string
  experiment?: string
  project?: string
  runKey?: string
  taskId?: string
  taskName?: string
  workspace?: string
}

/**
 * Builds the breadcrumb of a view: projects → workspace → project → experiment → attempt → run → task → case.
 *
 * Every level links to its own page; the last one is the current page (no link). Experiment, attempt, and run show
 * their readable name with the full id kept on the crumb (tooltip). Comparisons are not a level: they are reached from
 * the header menu.
 *
 * With `pageLevel`, the breadcrumb ends at that level even when the position goes deeper (the experiment page of an
 * address with `attempt` highlights the attempt but is still the experiment page).
 */
export function hierarchyCrumbs(position: HierarchyPosition, names: HierarchyNames = {}, pageLevel?: HierarchyLevel): Crumb[] {
  const { attempt, caseId, caseName, experiment, project, runKey, taskId, taskName, workspace } = position
  const crumbs: Crumb[] = [{ href: href({ name: 'scope' }), label: 'Projects', level: 'home' }]
  if (workspace != null)
    crumbs.push({ href: href({ name: 'scope', workspace }), id: workspace, label: workspace, level: 'workspace' })
  if (workspace != null && project != null)
    crumbs.push({ href: href({ name: 'scope', project, workspace }), id: project, label: project, level: 'project' })
  if (workspace != null && project != null && experiment != null)
    crumbs.push({ href: href({ experiment, name: 'scope', project, workspace }), id: experiment, label: names.experiment ?? experiment, level: 'experiment' })
  if (workspace != null && project != null && experiment != null && attempt != null)
    crumbs.push({ href: href({ attempt, experiment, name: 'scope', project, workspace }), id: attempt, label: names.attempt ?? attempt, level: 'attempt' })
  if (runKey != null)
    crumbs.push({ href: href({ name: 'run', runKey }), id: runKey, label: names.run ?? runKey, level: 'run' })
  if (runKey != null && taskId != null)
    crumbs.push({ href: href({ name: 'task', runKey, taskId }), id: taskId, label: taskName ?? shortTaskId(taskId), level: 'task' })
  if (runKey != null && taskId != null && caseId != null)
    crumbs.push({ href: href({ caseId, name: 'case', runKey, taskId }), id: caseId, label: caseName ?? caseId, level: 'case' })
  const end = pageLevel == null ? -1 : crumbs.findIndex(crumb => crumb.level === pageLevel)
  const shown = end < 0 ? crumbs : crumbs.slice(0, end + 1)
  const last = shown.at(-1)
  if (last != null && shown.length > 1)
    delete last.href
  return shown
}
