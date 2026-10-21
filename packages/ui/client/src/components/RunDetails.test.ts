import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'

import RunDetails from './RunDetails.vue'

import { i18n } from '../i18n'

describe('runDetails', () => {
  /**
   * @example
   * expect(screen.getByText('Report root')).toBeVisible()
   */
  it('keeps the raw run identifiers behind the "Run details" info button', async () => {
    const screen = await render(RunDetails, { props: { reportPath: 'default-workspace/osworld/exp/attempt-1/run-1', reportRoot: '/data/.vieval/reports', runId: 'run-1' } })

    expect(screen.getByTestId('run-details').query()).toBeNull()

    await screen.getByRole('button', { name: 'Run details' }).click()

    await expect.element(screen.getByText('Report root')).toBeVisible()
    await expect.element(screen.getByText('/data/.vieval/reports')).toBeVisible()
    await expect.element(screen.getByText('default-workspace/osworld/exp/attempt-1/run-1')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copy' }).elements()).toHaveLength(3)
  })

  /**
   * @example
   * expect(screen.getByText('Report path').query()).toBeNull()
   */
  it('leaves out identifiers a run without a report does not have', async () => {
    const screen = await render(RunDetails, { props: { reportPath: null, reportRoot: null, runId: 'run-2' } })

    await screen.getByRole('button', { name: 'Run details' }).click()

    await expect.element(screen.getByText('run-2')).toBeVisible()
    expect(screen.getByText('Report path').query()).toBeNull()
  })

  /**
   * @example
   * expect(screen.getByRole('button', { name: '详情' })).toBeVisible()
   */
  it('names the identifiers in the viewer\'s language', async () => {
    i18n.global.locale.value = 'zh-Hans'
    const screen = await render(RunDetails, { props: { reportPath: null, reportRoot: '/data/.vieval/reports', runId: 'run-3' } })

    await screen.getByRole('button', { name: '详情' }).click()

    await expect.element(screen.getByText('报告根目录')).toBeVisible()
    expect(screen.getByRole('button', { name: '复制' }).elements()).toHaveLength(2)
  })
})
