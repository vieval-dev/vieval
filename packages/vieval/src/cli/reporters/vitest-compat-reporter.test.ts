import { describe, expect, it } from 'vitest'

import { createRunEventBus } from '../../core/runner/event-bus'
import { caseEnded, caseStarted, projectEnded, projectStarted, taskEnded, taskQueued } from '../../events'
import { subscribeVitestCompatReporters } from './vitest-compat-reporter'

function createTestBus() {
  return createRunEventBus({ attemptId: 'attempt-test', experimentId: 'experiment-test', runId: 'run-test', workspaceId: 'workspace-test' })
}

/**
 * @example
 * describe('subscribeVitestCompatReporters', () => {})
 */
describe('subscribeVitestCompatReporters', () => {
  /**
   * @example
   * it('forwards the project lifecycle events to vitest-style reporter hooks', async () => {})
   */
  it('forwards the project lifecycle events to vitest-style reporter hooks', async () => {
    const events: string[] = []
    const bus = createTestBus()
    // Source permalink:
    // `https://github.com/vitest-dev/vitest/blob/b865b4d83d1e7874607ba1b2d84b9e2d135ecd33/test/core/test/imports.test.ts#L63-L73`
    // Vitest validates `data:` dynamic import, so we use the same pattern for a file-free reporter module fixture.
    await subscribeVitestCompatReporters({
      bus,
      projectName: 'bridge-project',
      references: [
        ['data:text/javascript,export default class Reporter { onTestRunStart(){ globalThis.__bridgeEvents.push("run:start") } onTestModuleQueued(module){ globalThis.__bridgeEvents.push("module:queued:" + module.id) } onTestCaseReady(test){ globalThis.__bridgeEvents.push("case:ready:" + test.id) } onTestCaseResult(test){ globalThis.__bridgeEvents.push("case:result:" + test.id + ":" + test.state) } onTestModuleEnd(module){ globalThis.__bridgeEvents.push("module:end:" + module.id) } onTestRunEnd(_modules,_errors,state){ globalThis.__bridgeEvents.push("run:end:" + state) } }', undefined],
      ],
    })

    Object.assign(globalThis, {
      __bridgeEvents: events,
    })

    const project = bus.scope({ projectId: 'bridge-project' })
    const task = project.scope({ taskId: 'task-1' })
    await task.emit(taskQueued, { displayName: 'task' })
    await project.emit(projectStarted, { taskCount: 1 })
    await task.scope({ caseId: 'case-1' }).emit(caseStarted, { index: 0, name: 'case', total: 1 })
    await task.scope({ caseId: 'case-1' }).emit(caseEnded, { index: 0, name: 'case', state: 'passed', total: 1 })
    await task.emit(taskEnded, { state: 'passed' })
    await project.emit(projectEnded, { failed: false })

    /**
     * @example
     * expect(events).toEqual(['module:queued:task-1', 'run:start', ...])
     */
    expect(events).toEqual([
      'module:queued:task-1',
      'run:start',
      'case:ready:case-1',
      'case:result:case-1:passed',
      'module:end:task-1',
      'run:end:passed',
    ])
  })

  /**
   * @example
   * it('accepts inline reporter objects and tuple shorthand, and ignores other projects', async () => {})
   */
  it('accepts inline reporter objects and tuple shorthand, and ignores other projects', async () => {
    const events: string[] = []
    const bus = createTestBus()
    // Source permalinks:
    // `https://github.com/vitest-dev/vitest/blob/b865b4d83d1e7874607ba1b2d84b9e2d135ecd33/test/cli/test/reporters/reporter-error.test.ts#L14-L28`
    // `https://github.com/vitest-dev/vitest/blob/b865b4d83d1e7874607ba1b2d84b9e2d135ecd33/test/cli/test/reporters/console.test.ts#L66-L77`
    // Vitest accepts inline reporter objects in test config, and this test mirrors that behavior.
    await subscribeVitestCompatReporters({
      bus,
      projectName: 'bridge-project',
      references: [
        {
          onTestModuleQueued(module) {
            events.push(`inline:queued:${module.id}`)
          },
        },
        [{
          onTestRunStart(specs) {
            events.push(`inline:run-start:${specs.length}`)
          },
        }],
      ],
    })

    await bus.scope({ projectId: 'other-project', taskId: 'task-other' }).emit(taskQueued, { displayName: 'other' })
    await bus.scope({ projectId: 'bridge-project', taskId: 'task-1' }).emit(taskQueued, { displayName: 'task' })
    await bus.scope({ projectId: 'bridge-project' }).emit(projectStarted, { taskCount: 1 })

    /**
     * @example
     * expect(events).toEqual(['inline:queued:task-1', 'inline:run-start:1'])
     */
    expect(events).toEqual([
      'inline:queued:task-1',
      'inline:run-start:1',
    ])
  })
})
