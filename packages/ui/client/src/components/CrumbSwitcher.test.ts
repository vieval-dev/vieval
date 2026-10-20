import type { SwitcherOption } from '../switcher'

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'

import CrumbSwitcher from './CrumbSwitcher.vue'

/** Experiments of one project as the breadcrumb of an experiment page offers them. */
const options: SwitcherOption[] = [
  { detail: '10 attempt(s)', href: '#/?experiment=matrix-run-model-gpt-5.5-repeat-1&project=p&workspace=w', id: 'matrix-run-model-gpt-5.5-repeat-1', label: 'model gpt-5.5 · repeat 1', score: 0.438, scoreLabel: 'Pass', state: 'ended' },
  { chips: [{ axis: 'model', values: 'gpt-5.5' }], detail: '1 attempt(s)', href: '#/?experiment=auv-c759d695&project=p&workspace=w', id: 'auv-c759d695', label: 'auv-c759d695', score: 0.496, scoreLabel: 'Pass', state: 'ended' },
  { detail: '1 attempt(s)', href: '#/?experiment=matrix-run-model-gpt-5.5-repeat-1--run-model-gpt-5.5-repeat-3&project=p&workspace=w', id: 'matrix-run-model-gpt-5.5-repeat-1--run-model-gpt-5.5-repeat-3', label: 'model gpt-5.5 · repeat 1–3', score: 1, scoreLabel: 'Pass', state: 'unsupported' },
]

describe('crumbSwitcher', () => {
  /**
   * @example
   * expect(page.getByTestId('switch-option')).toHaveLength(1)
   */
  it('filters siblings by label and id, and Enter opens the highlighted one', async () => {
    const screen = await render(CrumbSwitcher, { props: { current: 'matrix-run-model-gpt-5.5-repeat-1', label: 'model gpt-5.5 · repeat 1', level: 'experiment', options } })

    await screen.getByTestId('switch-experiment').click()
    await expect.element(page.getByText('Switch experiment')).toBeVisible()
    await expect.poll(() => page.getByTestId('switch-option').all()).toHaveLength(3)

    // `repeat-3` only occurs in the id of the third experiment; its label says "repeat 1–3".
    await page.getByTestId('switch-search').fill('repeat-3')
    await expect.poll(() => page.getByTestId('switch-option').all()).toHaveLength(1)
    await expect.element(page.getByTestId('switch-option')).toHaveTextContent('model gpt-5.5 · repeat 1–3')

    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(screen.emitted('select')?.[0]?.[0]).toMatchObject({ id: 'matrix-run-model-gpt-5.5-repeat-1--run-model-gpt-5.5-repeat-3' })
    expect(location.hash).toBe(options[2]!.href)
  })

  /**
   * @example
   * expect(page.getByText('Nothing matches “nope”')).toBeVisible()
   */
  it('says when nothing matches, and checks the current item', async () => {
    const screen = await render(CrumbSwitcher, { props: { current: 'auv-c759d695', label: 'auv-c759d695', level: 'experiment', options } })

    await screen.getByTestId('switch-experiment').click()
    await expect.element(page.getByRole('option', { name: /auv-c759d695/ })).toHaveAttribute('aria-selected', 'true')

    // ROOT CAUSE:
    //
    // The check of the current option was in the DOM but measured 0 × 0: presetIcons gives icons a width and a
    // height but no `display`, and an inline `<span>` ignores both outside a flex container (here an absolutely
    // positioned indicator). The empty gutter for the check was all that showed.
    //
    // We fixed this by `extraProperties: { display: 'inline-block' }` for presetIcons in `uno.config.ts`.
    const check = page.getByRole('option', { name: /auv-c759d695/ }).element().querySelector('.i-mingcute-check-line')!
    expect(check.getBoundingClientRect().width).toBeGreaterThan(0)

    await page.getByTestId('switch-search').fill('nope')
    await expect.element(page.getByText('Nothing matches “nope”')).toBeVisible()
  })
})
