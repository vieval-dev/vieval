import { describe, expect, it } from 'vitest'

import { createSchedulerRuntime } from './runtime'

describe('createSchedulerRuntime', () => {
  it('isolates project concurrency per project instance', async () => {
    const started: string[] = []
    const releases = new Map<string, () => void>()

    const runtime = createSchedulerRuntime({
      concurrency: {
        project: 1,
      },
    })

    const runs = [
      { caseId: 'alpha-1', projectName: 'alpha' },
      { caseId: 'alpha-2', projectName: 'alpha' },
      { caseId: 'beta-1', projectName: 'beta' },
    ].map(({ caseId, projectName }) =>
      runtime.runCase(
        {
          experimentId: 'baseline',
          scope: 'case',
          workspaceId: 'ws',
          projectName,
          attemptIndex: 0,
          caseId,
        },
        async () => {
          started.push(caseId)
          await new Promise<void>(resolve => releases.set(caseId, resolve))
        },
      ),
    )

    expect(started).toEqual([
      'alpha-1',
      'beta-1',
    ])

    releases.get('alpha-1')?.()
    await waitForStartedCount(started, 3)

    expect(started).toEqual([
      'alpha-1',
      'beta-1',
      'alpha-2',
    ])

    const runCompletion = Promise.all(runs)
    await drainMappedReleases(releases, runCompletion)
    await runCompletion
  })

  it('limits concurrent case execution to the configured scope cap', async () => {
    let active = 0
    let peak = 0
    const releases: Array<() => void> = []
    let startedBeforeRelease = 0

    const runtime = createSchedulerRuntime({
      concurrency: {
        case: 2,
      },
    })

    const runs = [0, 1, 2, 3].map(index =>
      runtime.runCase(
        {
          experimentId: 'baseline',
          scope: 'case',
          workspaceId: 'ws',
          attemptIndex: 0,
          caseId: `case-${index}`,
        },
        async () => {
          active += 1
          peak = Math.max(peak, active)
          startedBeforeRelease += 1
          await new Promise<void>(resolve => releases.push(resolve))
          active -= 1
        },
      ),
    )

    expect(startedBeforeRelease).toBe(2)
    expect(peak).toBeLessThanOrEqual(2)
    expect(releases).toHaveLength(2)

    await Promise.resolve()

    expect(startedBeforeRelease).toBe(2)

    const runCompletion = Promise.all(runs)
    await drainQueuedReleases(releases, runCompletion)

    await runCompletion
  })

  it('isolates scoped concurrency across experiment lineages', async () => {
    const started: string[] = []
    const releases = new Map<string, () => void>()

    const runtime = createSchedulerRuntime({
      concurrency: {
        attempt: 1,
      },
    })

    const runs = [
      { experimentId: 'baseline', runId: 'baseline-1' },
      { experimentId: 'candidate', runId: 'candidate-1' },
    ].map(({ experimentId, runId }) =>
      runtime.runCase(
        {
          experimentId,
          scope: 'case',
          workspaceId: 'ws',
          projectName: 'project-a',
          taskId: 'task-a',
          attemptIndex: 0,
          caseId: runId,
        },
        async () => {
          started.push(runId)
          await new Promise<void>(resolve => releases.set(runId, resolve))
        },
      ),
    )

    expect(started).toEqual([
      'baseline-1',
      'candidate-1',
    ])

    const runCompletion = Promise.all(runs)
    await drainMappedReleases(releases, runCompletion)
    await runCompletion
  })

  it('runs acquire middleware in root-to-leaf order and release middleware in reverse order', async () => {
    const events: string[] = []
    const runtime = createSchedulerRuntime({
      middleware: [
        {
          async onAcquire(context, next) {
            events.push(`root:acquire:${context.scope}`)
            await next()
          },
          async onRelease(context, next) {
            events.push(`root:release:${context.scope}`)
            await next()
          },
        },
        {
          async onAcquire(context, next) {
            events.push(`middle:acquire:${context.scope}`)
            await next()
          },
          async onRelease(context, next) {
            events.push(`middle:release:${context.scope}`)
            await next()
          },
        },
        {
          async onAcquire(context, next) {
            events.push(`leaf:acquire:${context.scope}`)
            await next()
          },
          async onRelease(context, next) {
            events.push(`leaf:release:${context.scope}`)
            await next()
          },
        },
      ],
    })

    await runtime.runCase(
      {
        experimentId: 'baseline',
        scope: 'case',
        workspaceId: 'ws',
        attemptIndex: 0,
        caseId: 'case-1',
      },
      async () => {
        events.push('work')
      },
    )

    expect(events).toEqual([
      'root:acquire:case',
      'middle:acquire:case',
      'leaf:acquire:case',
      'work',
      'leaf:release:case',
      'middle:release:case',
      'root:release:case',
    ])
  })

  it('throws a scheduler-owned error when acquire middleware short-circuits work', async () => {
    const events: string[] = []
    const runtime = createSchedulerRuntime({
      middleware: [
        {
          async onAcquire(context) {
            events.push(`root:acquire:${context.scope}`)
          },
          async onRelease(context, next) {
            events.push(`root:release:${context.scope}`)
            await next()
          },
        },
        {
          async onAcquire(context, next) {
            events.push(`leaf:acquire:${context.scope}`)
            await next()
          },
          async onRelease(context, next) {
            events.push(`leaf:release:${context.scope}`)
            await next()
          },
        },
      ],
    })

    await expect(
      runtime.runCase(
        {
          experimentId: 'baseline',
          scope: 'case',
          workspaceId: 'ws',
          attemptIndex: 0,
          caseId: 'case-1',
        },
        async () => {
          events.push('work')
          return 'unreachable'
        },
      ),
    ).rejects.toThrowError('Scheduler middleware short-circuited execution.')

    expect(events).toEqual([
      'root:acquire:case',
      'root:release:case',
    ])
  })

  it('only unwinds release middleware for the acquire chain that was entered', async () => {
    const events: string[] = []
    const runtime = createSchedulerRuntime({
      middleware: [
        {
          async onAcquire(context, next) {
            events.push(`root:acquire:${context.scope}`)
            await next()
          },
          async onRelease(context, next) {
            events.push(`root:release:${context.scope}`)
            await next()
          },
        },
        {
          async onAcquire(context) {
            events.push(`middle:acquire:${context.scope}`)
          },
          async onRelease(context, next) {
            events.push(`middle:release:${context.scope}`)
            await next()
          },
        },
        {
          async onAcquire(context, next) {
            events.push(`leaf:acquire:${context.scope}`)
            await next()
          },
          async onRelease(context, next) {
            events.push(`leaf:release:${context.scope}`)
            await next()
          },
        },
      ],
    })

    await expect(
      runtime.runCase(
        {
          experimentId: 'baseline',
          scope: 'case',
          workspaceId: 'ws',
          attemptIndex: 0,
          caseId: 'case-1',
        },
        async () => {
          events.push('work')
        },
      ),
    ).rejects.toThrowError('Scheduler middleware short-circuited execution.')

    expect(events).toEqual([
      'root:acquire:case',
      'middle:acquire:case',
      'middle:release:case',
      'root:release:case',
    ])
  })

  it('runs release middleware when work throws and preserves the original error', async () => {
    const events: string[] = []
    const runtime = createSchedulerRuntime({
      middleware: [
        {
          async onAcquire(context, next) {
            events.push(`root:acquire:${context.scope}`)
            await next()
          },
          async onRelease(context, next) {
            events.push(`root:release:${context.scope}`)
            await next()
          },
        },
        {
          async onAcquire(context, next) {
            events.push(`leaf:acquire:${context.scope}`)
            await next()
          },
          async onRelease(context, next) {
            events.push(`leaf:release:${context.scope}`)
            await next()
          },
        },
      ],
    })

    const failure = new Error('scheduler-work-failed')

    await expect(
      runtime.runCase(
        {
          experimentId: 'baseline',
          scope: 'case',
          workspaceId: 'ws',
          attemptIndex: 0,
          caseId: 'case-1',
        },
        async () => {
          events.push('work')
          throw failure
        },
      ),
    ).rejects.toBe(failure)

    expect(events).toEqual([
      'root:acquire:case',
      'leaf:acquire:case',
      'work',
      'leaf:release:case',
      'root:release:case',
    ])
  })

  it('runs outer release middleware when an inner acquire throws and preserves the original error', async () => {
    const events: string[] = []
    const failure = new Error('scheduler-acquire-failed')
    const runtime = createSchedulerRuntime({
      middleware: [
        {
          async onAcquire(context, next) {
            events.push(`root:acquire:${context.scope}`)
            await next()
          },
          async onRelease(context, next) {
            events.push(`root:release:${context.scope}`)
            await next()
          },
        },
        {
          async onAcquire(context) {
            events.push(`leaf:acquire:${context.scope}`)
            throw failure
          },
          async onRelease(context, next) {
            events.push(`leaf:release:${context.scope}`)
            await next()
          },
        },
      ],
    })

    await expect(
      runtime.runCase(
        {
          experimentId: 'baseline',
          scope: 'case',
          workspaceId: 'ws',
          attemptIndex: 0,
          caseId: 'case-1',
        },
        async () => {
          events.push('work')
        },
      ),
    ).rejects.toBe(failure)

    expect(events).toEqual([
      'root:acquire:case',
      'leaf:acquire:case',
      'root:release:case',
    ])
  })

  it('throws a scheduler-owned error for invalid concurrency caps', () => {
    expect(() => {
      createSchedulerRuntime({
        concurrency: {
          case: 0,
        },
      })
    }).toThrowError('Invalid scheduler concurrency for "case": 0')

    expect(() => {
      createSchedulerRuntime({
        concurrency: {
          project: Number.POSITIVE_INFINITY,
        },
      })
    }).toThrowError('Invalid scheduler concurrency for "project": Infinity')

    expect(() => {
      createSchedulerRuntime({
        concurrency: {
          task: -1,
        },
      })
    }).toThrowError('Invalid scheduler concurrency for "task": -1')

    expect(() => {
      createSchedulerRuntime({
        concurrency: {
          attempt: 1.5,
        },
      })
    }).toThrowError('Invalid scheduler concurrency for "attempt": 1.5')
  })
})

async function drainQueuedReleases(
  releases: Array<() => void>,
  runCompletion: Promise<unknown>,
): Promise<void> {
  for (;;) {
    releases.splice(0).forEach(resolve => resolve())

    const isComplete = await Promise.race([
      runCompletion.then(() => true),
      new Promise<false>(resolve => setTimeout(resolve, 0, false)),
    ])

    if (isComplete) {
      return
    }
  }
}

async function waitForStartedCount(started: string[], count: number): Promise<void> {
  while (started.length < count) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

async function drainMappedReleases(
  releases: Map<string, () => void>,
  runCompletion: Promise<unknown>,
): Promise<void> {
  for (;;) {
    const pendingReleases = [...releases.values()]
    releases.clear()
    pendingReleases.forEach(resolve => resolve())

    const isComplete = await Promise.race([
      runCompletion.then(() => true),
      new Promise<false>(resolve => setTimeout(resolve, 0, false)),
    ])

    if (isComplete) {
      return
    }
  }
}
