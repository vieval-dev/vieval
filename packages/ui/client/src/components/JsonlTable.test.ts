import type { JsonlPage } from '../../../src/shared/contract'

import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'

import JsonlTable from './JsonlTable.vue'

/** A JSONL file of `total` rows, served in pages like `/artifacts/jsonl`. */
function createLoader(total: number) {
  return vi.fn(async (offset: number, limit: number): Promise<JsonlPage> => ({
    limit,
    offset,
    partialTail: false,
    rows: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, index) => ({ id: `row-${offset + index}`, record: { type: 'event' }, value: offset + index })),
    totalLines: total,
  }))
}

describe('jsonlTable', () => {
  /**
   * @example
   * expect(domRows).toBeLessThan(100) // for 50 000 lines
   */
  it('renders only a window of a 50 000-line file and fetches pages as it scrolls', async () => {
    const load = createLoader(50_000)
    const screen = await render(JsonlTable, { props: { load } })

    await expect.element(screen.getByText('row-0')).toBeVisible()
    const table = screen.container.querySelector<HTMLElement>('[data-testid="jsonl-table"]')!
    expect(table.dataset.totalLines).toBe('50000')
    expect(Number(table.dataset.domRows)).toBeLessThan(100)
    // Nested objects become columns (`record.type`).
    await expect.element(screen.getByText('record.type')).toBeVisible()

    const scroller = table.querySelector<HTMLElement>('.overflow-auto')!
    scroller.scrollTop = 26 * 30_000
    await expect.element(screen.getByText('row-30000')).toBeVisible()
    expect(load).toHaveBeenCalledWith(30_000 - (30_000 % 200), 200)
    expect(Number(table.dataset.renderedStart)).toBeGreaterThan(29_000)
  })

  /**
   * @example
   * expect(screen.getByText('Empty JSONL file')).toBeVisible()
   */
  it('shows the empty state for an empty file', async () => {
    const screen = await render(JsonlTable, { props: { load: createLoader(0) } })
    await expect.element(screen.getByText('Empty JSONL file')).toBeVisible()
  })
})
