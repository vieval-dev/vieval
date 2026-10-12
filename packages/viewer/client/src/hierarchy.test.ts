import { describe, expect, it } from 'vitest'

import { hierarchyCrumbs } from './hierarchy'

describe('hierarchyCrumbs', () => {
  /**
   * @example
   * expect(crumbs.at(-1)).toMatchObject({ level: 'experiment' })
   */
  it('ends at the level of the page even when the address goes deeper', () => {
    // ROOT CAUSE:
    //
    // The experiment page of `#/?…&experiment=e&attempt=a` (an attempt highlighted in the list) showed the attempt
    // ("Oct 12, 03:31") as the last breadcrumb, because the breadcrumb followed the deepest level of the address.
    //
    // We fixed this by passing the page's level, so the breadcrumb ends at the page actually shown.
    const position = { attempt: 'attempt-2026-10-12T07-11-52-616Z', experiment: 'matrix-run-model-gpt-5.5-repeat-1', project: 'p', workspace: 'w' }

    const crumbs = hierarchyCrumbs(position, { attempt: 'Oct 12, 07:11', experiment: 'model gpt-5.5 · repeat 1' }, 'experiment')

    expect(crumbs.map(crumb => crumb.level)).toEqual(['home', 'workspace', 'project', 'experiment'])
    expect(crumbs.at(-1)).toMatchObject({ id: 'matrix-run-model-gpt-5.5-repeat-1', label: 'model gpt-5.5 · repeat 1', level: 'experiment' })
    expect(crumbs.at(-1)?.href).toBeUndefined()
    expect(crumbs.at(-2)?.href).toBe('#/?project=p&workspace=w')
  })

  /**
   * @example
   * expect(hierarchyCrumbs(position).map(crumb => crumb.level)).toEqual([...])
   */
  it('shows every level of the position without a page level, with readable names', () => {
    const crumbs = hierarchyCrumbs({ attempt: 'a', experiment: 'e', project: 'p', runKey: 'run-1-abcdef12', workspace: 'w' }, { run: 'Oct 12, 07:11 · abcdef12' })

    expect(crumbs.map(crumb => crumb.level)).toEqual(['home', 'workspace', 'project', 'experiment', 'attempt', 'run'])
    expect(crumbs.at(-1)).toMatchObject({ id: 'run-1-abcdef12', label: 'Oct 12, 07:11 · abcdef12' })
  })
})
