import type { CaseDetail } from '../../../src/shared/contract'

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'

import InferencePanel from './InferencePanel.vue'

const agent = { id: 'openai', model: 'gpt-6.1-sol' }
const judge = { id: 'anthropic', model: 'judge-1' }

function call(seq: number, provider: typeof agent, usage: Record<string, number>): CaseDetail['inference'] {
  return [
    { data: { modality: 'chat', provider }, event: 'inference.requested', seq, time: '2026-10-13T12:13:08.178Z' },
    { data: { metering: { dimensions: usage, latency_ms: 2000 }, metrics: {}, modality: 'chat', provider, toolCalls: [] }, event: 'inference.responded', seq: seq + 1, time: '2026-10-13T12:13:10.178Z' },
  ]
}

describe('inferencePanel', () => {
  /**
   * @example
   * expect(screen.getByTestId('inference-total')).toHaveTextContent('165')
   */
  it('shows the token totals of a case that used one model', async () => {
    const screen = await render(InferencePanel, { props: { events: [...call(1, agent, { input_tokens: 100, output_tokens: 10 }), ...call(3, agent, { input_tokens: 50, output_tokens: 5 })] } })
    await expect.element(screen.getByTestId('inference-calls')).toHaveTextContent('2')
    await expect.element(screen.getByTestId('inference-input')).toHaveTextContent('150')
    await expect.element(screen.getByTestId('inference-total')).toHaveTextContent('165')
    expect(screen.getByTestId('inference-models').query()).toBeNull()
  })

  /**
   * @example
   * expect(screen.getByTestId('inference-total')).toHaveTextContent('165')
   */
  it('shows tokens per model and their sum when a case used several models', async () => {
    const screen = await render(InferencePanel, { props: { events: [...call(1, agent, { input_tokens: 100, output_tokens: 10 }), ...call(3, judge, { input_tokens: 50, output_tokens: 5 })] } })
    await expect.element(screen.getByTestId('inference-calls')).toHaveTextContent('2')
    await expect.element(screen.getByTestId('inference-total')).toHaveTextContent('165')
    await expect.element(screen.getByTestId('inference-models-total')).toHaveTextContent('165')
    await expect.element(screen.getByTestId('inference-models')).toHaveTextContent('gpt-6.1-sol')
    await expect.element(screen.getByTestId('inference-models')).toHaveTextContent('judge-1')
    await expect.element(screen.getByTestId('inference-call-table')).toHaveTextContent('judge-1')
  })
})
