import { describe, expect, it } from 'vitest'

import { href, parseRoute } from './router'

describe('router', () => {
  /**
   * @example
   * expect(parseRoute(href(route))).toEqual(route)
   */
  it('round-trips task and case ids that contain encoded characters', () => {
    // Real OSWorld ids: the task id contains `%2F`, `::` and `=`; the case id contains `%2F` and `:`.
    const route = {
      caseId: '0:chrome%2F7b6c7e24-c58a-49fc-a5bb-d57b80e5b4c3',
      name: 'case',
      runKey: 'run-1791746045991-a77ba0a4',
      tab: 'evidence',
      taskId: 'evals%2Fosworld%2Feval%2Fosworld::default::run=model%3Dgpt-5.5%26repeat%3D1::eval=default',
    } as const
    expect(parseRoute(href(route))).toEqual(route)
  })

  /**
   * @example
   * expect(parseRoute('#/?workspace=w&project=p')).toEqual({ name: 'scope', workspace: 'w', project: 'p', … })
   */
  it('decodes hierarchy scopes and comparisons', () => {
    expect(parseRoute('#/?workspace=w&project=p&experiment=e')).toEqual({ attempt: undefined, experiment: 'e', name: 'scope', project: 'p', tab: undefined, workspace: 'w' })
    expect(parseRoute('#/compare?view=attempts&experiment=e')).toEqual({ name: 'compare', query: { experiment: 'e', view: 'attempts' } })
    expect(parseRoute('')).toEqual({ attempt: undefined, experiment: undefined, name: 'scope', project: undefined, tab: undefined, workspace: undefined })
  })
})
