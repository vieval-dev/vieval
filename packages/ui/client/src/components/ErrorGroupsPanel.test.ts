import type { CaseNode } from '../../../src/shared/contract'

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'

import ErrorGroupsPanel from './ErrorGroupsPanel.vue'

import { i18n } from '../i18n'

function caseOf(caseId: string, state: CaseNode['state'], errorMessage?: string): CaseNode {
  return { artifactCount: 0, caseId, errorMessage, errorName: errorMessage == null ? undefined : 'APICallError', evidenceLinkCount: 0, identity: caseId, index: 0, key: `task\u0000${caseId}`, logLineCount: 0, metricCount: 0, name: caseId, rounds: [], scores: { unscored: {}, values: {} }, startedAt: '2026-10-19T06:36:26.000Z', state, taskId: 'task' }
}

describe('errorGroupsPanel', () => {
  /**
   * @example
   * expect(screen.getByTestId('error-group')).toHaveTextContent('2APICallError…')
   */
  it('lists cases without a result by error and links an example case', async () => {
    const screen = await render(ErrorGroupsPanel, {
      props: {
        caseHref: ({ caseId, taskId }) => `#/case/${taskId}/${caseId}`,
        tasks: [{ cases: [caseOf('a', 'errored', 'Remote sent 429 response'), caseOf('b', 'errored', 'Remote sent 429 response'), caseOf('c', 'passed')] }],
      },
    })

    await expect.element(screen.getByTestId('error-groups')).toHaveTextContent('2 cases left out of the score')
    await expect.element(screen.getByTestId('error-group')).toHaveTextContent('APICallError')
    await expect.element(screen.getByRole('link', { name: 'e.g. a' })).toHaveAttribute('href', '#/case/task/a')
  })

  /**
   * @example
   * expect(screen.getByTestId('error-groups')).toHaveTextContent('1 个用例未计入分数')
   */
  it('describes the groups in the viewer\'s language, keeping the error as reported', async () => {
    i18n.global.locale.value = 'zh-Hans'
    const screen = await render(ErrorGroupsPanel, { props: { caseHref: () => '#', tasks: [{ cases: [caseOf('a', 'errored', 'Remote sent 429 response')] }] } })

    await expect.element(screen.getByTestId('error-groups')).toHaveTextContent('没有结果')
    await expect.element(screen.getByTestId('error-groups')).toHaveTextContent('1 个用例未计入分数，按错误分组')
    await expect.element(screen.getByTestId('error-group')).toHaveTextContent('Remote sent 429 response')
    await expect.element(screen.getByRole('link', { name: '例如 a' })).toBeVisible()
  })

  /**
   * @example
   * every case has a result -> the panel renders nothing.
   */
  it('renders nothing while every case has a result', async () => {
    const screen = await render(ErrorGroupsPanel, { props: { caseHref: () => '#', tasks: [{ cases: [caseOf('a', 'failed')] }] } })

    expect(screen.container.querySelector('[data-testid="error-groups"]')).toBeNull()
  })
})
