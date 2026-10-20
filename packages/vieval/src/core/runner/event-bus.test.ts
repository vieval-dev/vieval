import type { RunEventEnvelope } from '../../events'

import { defineEventa } from '@moeru/eventa'
import { describe, expect, it } from 'vitest'

import { caseStarted, runStarted } from '../../events'
import { createRunEventBus } from './event-bus'

const identity = { attemptId: 'attempt-1', experimentId: 'experiment-1', runId: 'run-1', workspaceId: 'workspace-1' }

/**
 * @example
 * describe('createRunEventBus', () => {})
 */
describe('createRunEventBus', () => {
  /**
   * @example
   * it('stamps run identity, scope ids, and a monotonic seq on every envelope', async () => {})
   */
  it('stamps run identity, scope ids, and a monotonic seq on every envelope', async () => {
    const bus = createRunEventBus(identity)
    const envelopes: RunEventEnvelope[] = []
    bus.onAny(envelope => envelopes.push(envelope))

    await bus.emit(runStarted, { totalTasks: 1 })
    await bus.scope({ projectId: 'project-1' }).scope({ taskId: 'task-1' }).scope({ caseId: '0:case' }).emit(caseStarted, { index: 0, name: 'case', total: 1 })

    /**
     * @example
     * expect(envelopes.map(({ time: _time, ...envelope }) => envelope)).toEqual([...])
     */
    expect(envelopes.map(({ time: _time, ...envelope }) => envelope)).toEqual([
      { ...identity, caseId: undefined, data: { totalTasks: 1 }, event: 'run.started', projectId: undefined, schemaVersion: 3, seq: 1, taskId: undefined },
      { ...identity, caseId: '0:case', data: { index: 0, name: 'case', total: 1 }, event: 'case.started', projectId: 'project-1', schemaVersion: 3, seq: 2, taskId: 'task-1' },
    ])
  })

  /**
   * @example
   * it('delivers to event listeners in subscription order before catch-all listeners', async () => {})
   */
  it('delivers to event listeners in subscription order before catch-all listeners', async () => {
    const bus = createRunEventBus(identity)
    const calls: string[] = []
    bus.onAny(() => calls.push('any'))
    bus.on(runStarted, () => calls.push('first'))
    bus.on(runStarted, () => calls.push('second'))
    bus.on(caseStarted, () => calls.push('other-event'))

    await bus.emit(runStarted, { totalTasks: 0 })

    /**
     * @example
     * expect(calls).toEqual(['first', 'second', 'any'])
     */
    expect(calls).toEqual(['first', 'second', 'any'])
  })

  /**
   * @example
   * it('resolves emit and keeps notifying other listeners when one listener throws', async () => {})
   */
  it('resolves emit and keeps notifying other listeners when one listener throws', async () => {
    // ROOT CAUSE:
    //
    // Eventa catches each listener error but rejects the promise returned by `emit` when any listener threw.
    // Emitters such as the DSL do not await `emit`, so the rejection would be unhandled and end the process.
    //
    // We fixed this by catching that promise inside the bus, so `emit` always resolves.
    const bus = createRunEventBus(identity)
    const calls: string[] = []
    bus.on(runStarted, () => {
      throw new Error('subscriber failed')
    })
    bus.on(runStarted, () => calls.push('next'))

    /**
     * @example
     * await expect(bus.emit(runStarted, { totalTasks: 0 })).resolves.toBeUndefined()
     */
    await expect(bus.emit(runStarted, { totalTasks: 0 })).resolves.toBeUndefined()
    expect(calls).toEqual(['next'])
  })

  /**
   * @example
   * it('waits for async listeners before resolving emit', async () => {})
   */
  it('waits for async listeners before resolving emit', async () => {
    const bus = createRunEventBus(identity)
    let settled = false
    bus.on(runStarted, async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      settled = true
    })

    await bus.emit(runStarted, { totalTasks: 0 })

    /**
     * @example
     * expect(settled).toBe(true)
     */
    expect(settled).toBe(true)
  })

  /**
   * @example
   * it('delivers events defined by plugins with plain defineEventa', async () => {})
   */
  it('delivers events defined by plugins with plain defineEventa', async () => {
    const pluginEvent = defineEventa<{ step: number }>('plugin.step-finished')
    const bus = createRunEventBus(identity)
    const steps: number[] = []
    bus.on(pluginEvent, ({ data }) => steps.push(data.step))

    await bus.emit(pluginEvent, { step: 3 })

    /**
     * @example
     * expect(steps).toEqual([3])
     */
    expect(steps).toEqual([3])
  })
})
