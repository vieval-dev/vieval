import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'

import StateView from './StateView.vue'

import { ApiError } from '../api'

describe('stateView', () => {
  /**
   * @example
   * expect(screen.emitted('retry')).toHaveLength(1)
   */
  it('shows a readable error with a retry action instead of the content', async () => {
    const screen = await render(StateView, { props: { error: new ApiError(0, 'Cannot reach the viewer server.') }, slots: { default: 'content' } })
    await expect.element(screen.getByText('Viewer server unreachable')).toBeVisible()
    await screen.getByRole('button', { name: 'Retry' }).click()
    expect(screen.emitted('retry')).toHaveLength(1)
    expect(screen.container.textContent).not.toContain('content')
  })

  /**
   * @example
   * expect(screen.getByText('No runs found')).toBeVisible()
   */
  it('shows loading, then empty, then the content', async () => {
    const screen = await render(StateView, { props: { empty: false, emptyText: 'No runs found', loading: true }, slots: { default: 'content' } })
    await expect.element(screen.getByText('Loading…')).toBeVisible()
    await screen.rerender({ empty: true, loading: false })
    await expect.element(screen.getByText('No runs found')).toBeVisible()
    await screen.rerender({ empty: false })
    await expect.element(screen.getByText('content')).toBeVisible()
  })
})
