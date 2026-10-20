import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'

import ObjectTree from './ObjectTree.vue'

import { i18n } from '../i18n'

describe('objectTree', () => {
  /**
   * @example
   * await screen.getByRole('button', { name: 'Expand' }).click()
   */
  it('opens the first levels and expands deeper ones on demand', async () => {
    const screen = await render(ObjectTree, { props: { expandDepth: 1, value: { run: { model: 'gpt-5.5', vm: { cpus: 4 } } } } })
    await expect.element(screen.getByText('run:')).toBeVisible()
    expect(screen.container.textContent).not.toContain('gpt-5.5')
    await screen.getByRole('button', { name: 'Expand' }).first().click()
    await expect.element(screen.getByText('"gpt-5.5"')).toBeVisible()
  })

  /**
   * @example
   * expect(screen.getByText('show 200 more of 300')).toBeVisible()
   */
  it('pages long arrays', async () => {
    const screen = await render(ObjectTree, { props: { expandDepth: 1, value: Array.from({ length: 500 }, (_, index) => index) } })
    await expect.element(screen.getByText('show 200 more of 300')).toBeVisible()
  })

  /**
   * @example
   * i18n.global.locale.value = 'zh-Hans'
   * expect(screen.getByText('再显示 200 项，剩余 300 项')).toBeVisible()
   */
  it('names the tree controls in the language picked for the viewer', async () => {
    i18n.global.locale.value = 'zh-Hans'
    const screen = await render(ObjectTree, { props: { expandDepth: 1, value: [{ model: 'gpt-5.5' }, ...Array.from({ length: 499 }, (_, index) => index)] } })
    await expect.element(screen.getByText('再显示 200 项，剩余 300 项')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: '展开' }).first()).toBeVisible()
    await expect.element(screen.getByText('{1 个键}')).toBeVisible()
  })
})
