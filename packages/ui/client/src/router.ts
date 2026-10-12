import { computed, shallowRef } from 'vue'

/**
 * One screen of the viewer, decoded from the location hash.
 *
 * Ids travel as query parameters because task and case ids contain `/` and `%` themselves.
 */
export type Route
  = | { attempt?: string, experiment?: string, name: 'scope', project?: string, tab?: string, workspace?: string }
    | { caseId: string, name: 'case', runKey: string, tab?: string, taskId: string }
    | { name: 'compare', query: Record<string, string> }
    | { name: 'run', runKey: string, tab?: string }
    | { name: 'task', runKey: string, taskId: string }

/**
 * Encodes a {@link Route} as a location hash; the inverse of {@link parseRoute}.
 */
export function href(route: Route): string {
  const query = (entries: Record<string, string | undefined>) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(entries)) {
      if (value != null && value !== '')
        params.set(key, value)
    }
    const text = params.toString()
    return text === '' ? '' : `?${text}`
  }
  switch (route.name) {
    case 'case':
      return `#/runs/${encodeURIComponent(route.runKey)}/case${query({ caseId: route.caseId, tab: route.tab, taskId: route.taskId })}`
    case 'compare':
      return `#/compare${query(route.query)}`
    case 'run':
      return `#/runs/${encodeURIComponent(route.runKey)}${query({ tab: route.tab })}`
    case 'scope':
      return `#/${query({ attempt: route.attempt, experiment: route.experiment, project: route.project, tab: route.tab, workspace: route.workspace })}`
    case 'task':
      return `#/runs/${encodeURIComponent(route.runKey)}/task${query({ taskId: route.taskId })}`
  }
}

/**
 * Decodes a location hash into a {@link Route}.
 *
 * Before:
 * - "#/runs/run-1-a/case?taskId=t%3A%3Ax&caseId=1%3Aa"
 *
 * After:
 * - { name: 'case', runKey: 'run-1-a', taskId: 't::x', caseId: '1:a' }
 */
export function parseRoute(hash: string): Route {
  const [rawPath = '', rawQuery = ''] = hash.replace(/^#/, '').split('?')
  const query = Object.fromEntries(new URLSearchParams(rawQuery))
  const segments = rawPath.split('/').filter(Boolean).map(decodeURIComponent)

  if (segments[0] === 'compare')
    return { name: 'compare', query }
  if (segments[0] === 'runs' && segments[1] != null) {
    const runKey = segments[1]
    if (segments[2] === 'case' && query.taskId != null && query.caseId != null)
      return { caseId: query.caseId, name: 'case', runKey, tab: query.tab, taskId: query.taskId }
    if (segments[2] === 'task' && query.taskId != null)
      return { name: 'task', runKey, taskId: query.taskId }
    return { name: 'run', runKey, tab: query.tab }
  }
  return { attempt: query.attempt, experiment: query.experiment, name: 'scope', project: query.project, tab: query.tab, workspace: query.workspace }
}

const hash = shallowRef(typeof location === 'undefined' ? '' : location.hash)
if (typeof window !== 'undefined')
  window.addEventListener('hashchange', () => (hash.value = location.hash))

/** The current route, reactive to `hashchange`. */
export const currentRoute = computed(() => parseRoute(hash.value))

/** Navigates to a route (adds a history entry). */
export function navigate(route: Route): void {
  location.hash = href(route)
}
