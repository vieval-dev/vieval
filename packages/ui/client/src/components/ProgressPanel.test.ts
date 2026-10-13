import type { RunSnapshot } from '../../../src/shared/contract'

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'

import ProgressPanel from './ProgressPanel.vue'

/** Progress of the live OSWorld run (`run-1791747103580-dd3a8517`) as the API reported it at seq 930. */
const snapshot = {
  current: {
    lastEvent: { event: 'metric.recorded', seq: 930, time: '2026-10-11T20:32:29.574Z' },
    running: [{ caseId: '65:libreoffice_calc%2F535364ea', elapsedMs: 60_000, name: 'libreoffice_calc/535364ea', retryIndex: 0, roundIndex: 0, startedAt: '2026-10-11T20:31:29.574Z', taskDisplayName: 'osworld [model=gpt-5.5, repeat=1]', taskId: 't' }],
  },
  eventCounts: {},
  identity: { attemptId: 'a', experimentId: 'e', runId: 'run-1791747103580-dd3a8517', workspaceId: 'w' },
  parseErrors: 0,
  progress: { basis: 'cases', cases: { completed: 58, estimatedTotal: 345, knownTotal: 345, running: 8 }, elapsedMs: 3_805_930, estimatedTotalMs: 22_638_722, etaMs: 18_832_792, history: [], lowerBound: false, ratio: 58 / 345, tasks: { completed: 0, total: 1 } },
  projects: [],
  runKey: 'run-1791747103580-dd3a8517',
  seq: 930,
  seqGaps: 0,
  source: 'live-tail',
  state: 'running',
  tasks: [],
} satisfies RunSnapshot

describe('progressPanel', () => {
  /**
   * @example
   * expect(screen.getByTestId('progress-eta')).toHaveTextContent('5h 13m')
   */
  it('shows progress, ETA, and the current position of a running run', async () => {
    const screen = await render(ProgressPanel, { props: { connection: 'open', receivedAt: Date.now(), snapshot } })
    await expect.element(screen.getByTestId('progress-percent')).toHaveTextContent('16.8%')
    await expect.element(screen.getByTestId('progress-cases')).toHaveTextContent('58 / 345')
    await expect.element(screen.getByRole('progressbar', { name: 'Run progress' })).toHaveAttribute('aria-valuenow', '17')
    await expect.element(screen.getByTestId('progress-eta')).toHaveTextContent('5h 13m')
    await expect.element(screen.getByTestId('live-indicator')).toHaveTextContent('live')
    await expect.element(screen.getByText('libreoffice_calc/535364ea')).toBeVisible()
  })

  /**
   * @example
   * expect(screen.getByTestId('progress-eta')).toHaveTextContent('≥')
   */
  it('marks the ETA as a lower bound once auto attempts were seen', async () => {
    const screen = await render(ProgressPanel, { props: { connection: 'open', receivedAt: Date.now(), snapshot: { ...snapshot, progress: { ...snapshot.progress, lowerBound: true } } } })
    await expect.element(screen.getByTestId('progress-eta')).toHaveTextContent('≥ 5h 13m')
  })
})
