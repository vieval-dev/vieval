import type { HeadlineResult, ScoreDefinition } from '../../../src/shared/contract'

import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'

import HeadlineScore from './HeadlineScore.vue'

const pass = { mean: 0.875, n: 119, name: 'pass', sum: 104.125, total: 121, unscored: { grader_failed: 2 } }
const definitions: ScoreDefinition[] = [{ description: 'Written back correctly and read naturally.', label: { 'en': 'Pass', 'zh-Hans': '通过' }, name: 'pass', primary: true }]
/** A run whose primary score is `pass`, with 4 of 125 cases errored and 2 the judge could not grade. */
const result: HeadlineResult = {
  completion: { mean: 0.968, n: 121, name: 'completion', sum: 121, total: 125, unscored: { errored: 4 } },
  headline: { kind: 'score', score: pass },
}

describe('headlineScore', () => {
  /**
   * @example
   * expect(screen.getByTestId('headline-label')).toHaveTextContent('Pass')
   */
  it('shows the value with the label of the primary score, the completion rate, and the unscored cases', async () => {
    const screen = await render(HeadlineScore, { props: { definitions, result } })

    await expect.element(screen.getByTestId('headline-value')).toHaveTextContent('87.5%')
    await expect.element(screen.getByTestId('headline-label')).toHaveTextContent('Pass')
    await expect.element(screen.getByTestId('headline-completion')).toHaveTextContent('completed 96.8% (4 errored)')
    await expect.element(screen.getByTestId('headline-unscored')).toHaveTextContent('2 unscored')
    await expect.element(screen.getByTestId('headline-unscored')).toHaveAttribute('title', '2 grader failed')
  })

  /**
   * @example
   * expect(onErrors).toHaveBeenCalledOnce()
   */
  it('leads from a completion rate below 100% to the cases without a result', async () => {
    const onErrors = vi.fn()
    const screen = await render(HeadlineScore, { props: { definitions, onErrors, result } })

    await screen.getByRole('button', { name: /completed 96.8%/ }).click()
    expect(onErrors).toHaveBeenCalledOnce()
  })

  /**
   * @example
   * expect(screen.getByTestId('headline-label')).toHaveTextContent('Passed cases')
   */
  it('reads a run without scores by its passed cases, and a list row hides a full completion rate', async () => {
    const screen = await render(HeadlineScore, {
      props: {
        definitions: [],
        result: { completion: { mean: 1, n: 10, name: 'completion', sum: 10, total: 10, unscored: {} }, headline: { kind: 'passed-cases', score: { mean: 0.6, n: 10, name: 'passed', sum: 6, total: 10, unscored: {} } } },
        size: 'sm',
      },
    })

    await expect.element(screen.getByTestId('headline-value')).toHaveTextContent('60.0%')
    await expect.element(screen.getByTestId('headline-label')).toHaveTextContent('Passed cases')
    expect(screen.container.querySelector('[data-testid="headline-completion"]')).toBeNull()
  })

  /**
   * @example
   * expect(screen.getByTestId('headline-tasks')).toHaveTextContent('osworld [en]')
   */
  it('lists each task\'s primary score under the completion rate when the tasks name different primary scores', async () => {
    const screen = await render(HeadlineScore, {
      props: {
        definitions: [...definitions, { label: 'Success', name: 'osworld.success', primary: true }],
        result: {
          completion: result.completion,
          headline: { kind: 'per-task', tasks: [{ score: pass, taskId: 'tts' }, { score: { mean: 0.4, n: 5, name: 'osworld.success', sum: 2, total: 5, unscored: {} }, taskId: 'osworld' }] },
        },
        taskLabel: (taskId: string) => `${taskId} [en]`,
      },
    })

    await expect.element(screen.getByTestId('headline-value')).toHaveTextContent('96.8%')
    await expect.element(screen.getByTestId('headline-label')).toHaveTextContent('completed')
    await expect.element(screen.getByTestId('headline-tasks')).toHaveTextContent(/tts \[en\]\s*Pass\s*87\.5%/)
    await expect.element(screen.getByTestId('headline-tasks')).toHaveTextContent(/osworld \[en\]\s*Success\s*40\.0%/)
  })
})
