import { describe, expect, it } from 'vitest'

import { createVievalVitestCompatReporterBridge } from './vitest-compat-reporter'

describe('createVievalVitestCompatReporterBridge', () => {
  it('forwards lifecycle events to vitest-style reporter hooks', async () => {
    const events: string[] = []
    // Source permalink:
    // `https://github.com/vitest-dev/vitest/blob/b865b4d83d1e7874607ba1b2d84b9e2d135ecd33/test/core/test/imports.test.ts#L63-L73`
    // Vitest validates `data:` dynamic import, so we use the same pattern for a file-free reporter module fixture.
    const bridge = await createVievalVitestCompatReporterBridge({
      projectName: 'bridge-project',
      references: [
        ['data:text/javascript,export default class Reporter { onTestRunStart(){ globalThis.__bridgeEvents.push("run:start") } onTestModuleQueued(module){ globalThis.__bridgeEvents.push("module:queued:" + module.id) } onTestCaseReady(test){ globalThis.__bridgeEvents.push("case:ready:" + test.id) } onTestCaseResult(test){ globalThis.__bridgeEvents.push("case:result:" + test.id + ":" + test.state) } onTestModuleEnd(module){ globalThis.__bridgeEvents.push("module:end:" + module.id) } onTestRunEnd(_modules,_errors,state){ globalThis.__bridgeEvents.push("run:end:" + state) } }', undefined],
      ],
    })

    expect(bridge).not.toBeNull()

    Object.assign(globalThis, {
      __bridgeEvents: events,
    })

    await bridge!.onRunStart()
    await bridge!.onTaskQueued({ taskId: 'task-1' })
    await bridge!.onCaseStart({ caseId: 'case-1', taskId: 'task-1' })
    await bridge!.onCaseEnd({ caseId: 'case-1', state: 'passed', taskId: 'task-1' })
    await bridge!.onTaskEnd({ state: 'passed', taskId: 'task-1' })
    await bridge!.onRunEnd({ failed: false })

    expect(events).toEqual([
      'run:start',
      'module:queued:task-1',
      'case:ready:case-1',
      'case:result:case-1:passed',
      'module:end:task-1',
      'run:end:passed',
    ])
  })

  it('accepts inline reporter objects and tuple shorthand', async () => {
    const events: string[] = []
    // Source permalinks:
    // `https://github.com/vitest-dev/vitest/blob/b865b4d83d1e7874607ba1b2d84b9e2d135ecd33/test/cli/test/reporters/reporter-error.test.ts#L14-L28`
    // `https://github.com/vitest-dev/vitest/blob/b865b4d83d1e7874607ba1b2d84b9e2d135ecd33/test/cli/test/reporters/console.test.ts#L66-L77`
    // Vitest accepts inline reporter objects in test config, and this test mirrors that behavior.
    const bridge = await createVievalVitestCompatReporterBridge({
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

    expect(bridge).not.toBeNull()

    await bridge!.onTaskQueued({ taskId: 'task-1' })
    await bridge!.onRunStart()

    expect(events).toEqual([
      'inline:queued:task-1',
      'inline:run-start:1',
    ])
  })
})
